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

    const agentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );
    const agentStorageBucket = Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    const userIdentity = new UserIdentity(this, 'UserIdentity');

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
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`,
        ],
      }),
    );

    // Grant agent storage bucket read access for artifacts
    agentStorageBucket.grantRead(userIdentity.identityPool.authenticatedRole);
  }
}
