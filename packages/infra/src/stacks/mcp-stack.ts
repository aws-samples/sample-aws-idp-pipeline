import { Stack, StackProps } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SearchMcp, ArtifactMcp, SSM_KEYS } from ':idp-v2/common-constructs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as path from 'path';

export class McpStack extends Stack {
  public readonly searchMcp: SearchMcp;
  public readonly artifactMcp: ArtifactMcp;
  public readonly gateway: agentcore.Gateway;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const backendTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

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
    this.artifactMcp = new ArtifactMcp(this, 'ArtifactMcp', {
      backendTable,
      storageBucket: agentStorageBucket,
    });

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

    this.gateway.addLambdaTarget('SearchTarget', {
      gatewayTargetName: 'search-documents',
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

    this.gateway.addLambdaTarget('SaveArtifactTarget', {
      gatewayTargetName: 'save-artifact',
      description:
        'Save an artifact (file) to a project. Use this tool when you need to save generated content like images, documents, or data files.',
      lambdaFunction: this.artifactMcp.saveFunction,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(
          process.cwd(),
          '../../packages/lambda/artifact-mcp/save_artifact.json',
        ),
      ),
    });

    this.gateway.addLambdaTarget('LoadArtifactTarget', {
      gatewayTargetName: 'load-artifact',
      description:
        'Load an artifact (file) from a project. Use this tool when you need to retrieve previously saved content.',
      lambdaFunction: this.artifactMcp.loadFunction,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(
          process.cwd(),
          '../../packages/lambda/artifact-mcp/load_artifact.json',
        ),
      ),
    });
  }
}
