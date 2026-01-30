import { Stack, StackProps } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  SearchMcp,
  MdMcp,
  PdfMcp,
  DocxMcp,
  SSM_KEYS,
} from ':idp-v2/common-constructs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as path from 'path';

export class McpStack extends Stack {
  public readonly searchMcp: SearchMcp;
  public readonly mdMcp: MdMcp;
  public readonly pdfMcp: PdfMcp;
  public readonly docxMcp: DocxMcp;
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

    const websocketMessageQueueArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_MESSAGE_QUEUE_ARN,
    );
    const websocketMessageQueue = Queue.fromQueueArn(
      this,
      'WebsocketMessageQueue',
      websocketMessageQueueArn,
    );

    this.searchMcp = new SearchMcp(this, 'SearchMcp');
    this.mdMcp = new MdMcp(this, 'MdMcp', {
      backendTable,
      storageBucket: agentStorageBucket,
      websocketMessageQueue,
    });
    this.pdfMcp = new PdfMcp(this, 'PdfMcp', {
      backendTable,
      storageBucket: agentStorageBucket,
      websocketMessageQueue,
    });
    this.docxMcp = new DocxMcp(this, 'DocxMcp', {
      backendTable,
      storageBucket: agentStorageBucket,
      websocketMessageQueue,
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

    const searchTarget = this.gateway.addLambdaTarget('SearchTarget', {
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
    this.searchMcp.function.grantInvoke(this.gateway.role);
    searchTarget.node.addDependency(this.gateway.role);

    const mdTarget = this.gateway.addLambdaTarget('MdMcpTarget', {
      gatewayTargetName: 'markdown',
      description:
        'Markdown processing tools: save, load, and edit markdown files. Use these tools when working with markdown documents.',
      lambdaFunction: this.mdMcp.function,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(process.cwd(), '../../packages/lambda/md-mcp/schema.json'),
      ),
    });

    // Workaround: CDK timing issue - explicitly grant and add dependency
    this.mdMcp.function.grantInvoke(this.gateway.role);
    mdTarget.node.addDependency(this.gateway.role);

    const pdfTarget = this.gateway.addLambdaTarget('PdfMcpTarget', {
      gatewayTargetName: 'pdf',
      description:
        'PDF processing tools: extract text, extract tables, and create PDFs. Use these tools when working with PDF documents.',
      lambdaFunction: this.pdfMcp.function,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(
          process.cwd(),
          '../../packages/lambda/pdf-mcp/schema.json',
        ),
      ),
    });

    // Workaround: CDK timing issue - explicitly grant and add dependency
    this.pdfMcp.function.grantInvoke(this.gateway.role);
    pdfTarget.node.addDependency(this.gateway.role);

    const docxTarget = this.gateway.addLambdaTarget('DocxMcpTarget', {
      gatewayTargetName: 'docx',
      description:
        'DOCX processing tools: extract text, extract tables, and create Word documents. Use these tools when working with DOCX documents.',
      lambdaFunction: this.docxMcp.function,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(
        path.resolve(
          process.cwd(),
          '../../packages/lambda/docx-mcp/schema.json',
        ),
      ),
    });

    // Workaround: CDK timing issue - explicitly grant and add dependency
    this.docxMcp.function.grantInvoke(this.gateway.role);
    docxTarget.node.addDependency(this.gateway.role);
  }
}
