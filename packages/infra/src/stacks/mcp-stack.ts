import { Stack, StackProps } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  SearchMcp,
  ImageMcp,
  QaMcp,
  SSM_KEYS,
} from ':idp-v2/common-constructs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as path from 'path';

export class McpStack extends Stack {
  public readonly searchMcp: SearchMcp;
  public readonly qaMcp: QaMcp;
  public readonly imageMcp?: ImageMcp;
  public readonly gateway: agentcore.Gateway;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const agentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );
    const agentStorageBucket = Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    this.searchMcp = new SearchMcp(this, 'SearchMcp');

    this.gateway = new agentcore.Gateway(this, 'McpGateway', {
      gatewayName: 'idp-mcp-gateway',
      description: 'IDP MCP Gateway',
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
      protocolConfiguration: new agentcore.McpProtocolConfiguration({
        instructions: 'Use this gateway to search documents in IDP projects',
        searchType: agentcore.McpGatewaySearchType.SEMANTIC,
        supportedVersions: [
          agentcore.MCPProtocolVersion.MCP_2025_03_26,
          agentcore.MCPProtocolVersion.MCP_2025_06_18,
        ],
      }),
    });

    const searchTarget = this.gateway.addLambdaTarget('SearchTarget', {
      gatewayTargetName: 'search',
      description:
        'Search documents in a project to find relevant information. Use this tool when the user asks questions about documents, wants to find specific information, or needs context from their uploaded files.',
      lambdaFunction: this.searchMcp.function,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(
          process.cwd(),
          '../../packages/lambda/search-mcp/schema.json',
        ),
      ),
    });
    this.searchMcp.function.grantInvoke(this.gateway.role);
    searchTarget.node.addDependency(this.gateway.role);

    this.qaMcp = new QaMcp(this, 'QaMcp');

    const qaTarget = this.gateway.addLambdaTarget('QaMcpTarget', {
      gatewayTargetName: 'qa',
      description:
        'QA analysis tool: Get document segment info and add new QA analysis to document segments. Use when the user asks for additional analysis or deeper examination of specific document pages.',
      lambdaFunction: this.qaMcp.function,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(process.cwd(), '../../packages/lambda/qa-mcp/schema.json'),
      ),
    });
    this.qaMcp.function.grantInvoke(this.gateway.role);
    qaTarget.node.addDependency(this.gateway.role);

    // ImageMcp is optional - enable with context: enableImageMcp=true in cdk.json
    if (this.node.tryGetContext('enableImageMcp')) {
      this.imageMcp = new ImageMcp(this, 'ImageMcp', {
        storageBucket: agentStorageBucket,
      });

      const imageTarget = this.gateway.addLambdaTarget('ImageMcpTarget', {
        gatewayTargetName: 'image',
        description:
          'Image search tool: Search for images on Unsplash and optionally save to S3. Use this tool when the user needs images for presentations or documents.',
        lambdaFunction: this.imageMcp.function,
        toolSchema: agentcore.ToolSchema.fromLocalAsset(
          path.resolve(
            process.cwd(),
            '../../packages/lambda/image-mcp/schema.json',
          ),
        ),
      });

      // Workaround: CDK timing issue - explicitly grant and add dependency
      this.imageMcp.function.grantInvoke(this.gateway.role);
      imageTarget.node.addDependency(this.gateway.role);
    }
  }
}
