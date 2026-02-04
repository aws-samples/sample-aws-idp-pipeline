import {
  Backend,
  Frontend,
  RuntimeConfig,
  UserIdentity,
  SSM_KEYS,
} from ':idp-v2/common-constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpcId = StringParameter.valueFromLookup(this, SSM_KEYS.VPC_ID);
    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId });

    const documentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    const documentStorageBucket = Bucket.fromBucketName(
      this,
      'DocumentStorageBucket',
      documentStorageBucketName,
    );

    RuntimeConfig.ensure(this).config.documentStorageBucketName =
      documentStorageBucketName;

    const agentRuntimeArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_RUNTIME_ARN,
    );
    RuntimeConfig.ensure(this).config.agentRuntimeArn = agentRuntimeArn;

    const researchAgentRuntimeArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.RESEARCH_AGENT_RUNTIME_ARN,
    );
    RuntimeConfig.ensure(this).config.researchAgentRuntimeArn =
      researchAgentRuntimeArn;

    const bidiAgentRuntimeArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BIDI_AGENT_RUNTIME_ARN,
    );
    RuntimeConfig.ensure(this).config.bidiAgentRuntimeArn = bidiAgentRuntimeArn;

    const agentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );
    const agentStorageBucket = Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    const websocketCallbackUrl = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_CALLBACK_URL,
    );
    RuntimeConfig.ensure(this).config.websocketUrl = websocketCallbackUrl;

    const userIdentity = new UserIdentity(this, 'UserIdentity');

    // Add post-confirmation trigger to save user data to DynamoDB
    const backendTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = TableV2.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );
    userIdentity.addPostAuthenticationTrigger(backendTable);

    const backend = new Backend(this, 'Backend', { vpc });

    const frontend = new Frontend(this, 'Frontend');

    new StringParameter(this, 'BackendUrlParam', {
      parameterName: SSM_KEYS.BACKEND_URL,
      stringValue: backend.api.url ?? '',
      description: 'Backend API URL',
    });

    // Grant SearchMcp Lambda access to Backend API
    const searchMcpRoleArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.SEARCH_MCP_ROLE_ARN,
    );
    const searchMcpRole = Role.fromRoleArn(
      this,
      'SearchMcpRole',
      searchMcpRoleArn,
    );
    backend.grantInvokeAccess(searchMcpRole);

    backend.restrictCorsTo(frontend);
    backend.grantInvokeAccess(userIdentity.identityPool.authenticatedRole);
    documentStorageBucket.grantReadWrite(
      userIdentity.identityPool.authenticatedRole,
    );

    // Grant Bedrock Agentcore invoke permission
    userIdentity.identityPool.authenticatedRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
          'bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`,
        ],
      }),
    );

    // Grant agent storage bucket read access for artifacts
    agentStorageBucket.grantRead(userIdentity.identityPool.authenticatedRole);

    // Grant WebSocket API manage connections permission
    const websocketApiId = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_API_ID,
    );

    userIdentity.identityPool.authenticatedRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['execute-api:Invoke', 'execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${websocketApiId}/*`,
        ],
      }),
    );

    // Grant WebSocket connect Lambda access to Cognito AdminGetUser
    const websocketConnectRoleArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_CONNECT_ROLE_ARN,
    );
    const websocketConnectRole = Role.fromRoleArn(
      this,
      'WebSocketConnectRole',
      websocketConnectRoleArn,
      { mutable: true },
    );
    userIdentity.userPool.grant(
      websocketConnectRole,
      'cognito-idp:AdminGetUser',
    );
  }
}
