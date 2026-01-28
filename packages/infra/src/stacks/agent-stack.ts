import { Stack, StackProps } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { Gateway, Runtime } from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { IdpAgent, SSM_KEYS } from ':idp-v2/common-constructs';

export interface AgentStackProps extends StackProps {
  gateway: Gateway;
}

export class AgentStack extends Stack {
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const { gateway } = props;

    // Get session storage bucket name from SSM
    const sessionStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
    );

    const sessionStorageBucket = Bucket.fromBucketName(
      this,
      'SessionStorageBucket',
      sessionStorageBucketName,
    );

    // Get backend table from SSM
    const backendTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );

    const backendTable = Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    // Get agent storage bucket from SSM
    const agentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );

    const agentStorageBucket = Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    const idpAgent = new IdpAgent(this, 'IdpAgent', {
      agentPath: path.resolve(process.cwd(), '../../packages/agents/idp-agent'),
      agentName: 'idp_agent',
      sessionStorageBucket,
      backendTable,
      gateway,
      bedrockModelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      agentStorageBucket,
    });

    const researchAgent = new IdpAgent(this, 'ResearchAgent', {
      agentPath: path.resolve(
        process.cwd(),
        '../../packages/agents/research-agent',
      ),
      agentName: 'research_agent',
      sessionStorageBucket,
      backendTable,
      gateway,
    });

    this.agentCoreRuntime = idpAgent.runtime;

    // Store Agent Runtime ARN in SSM for cross-stack reference
    new StringParameter(this, 'AgentRuntimeArnParam', {
      parameterName: SSM_KEYS.AGENT_RUNTIME_ARN,
      stringValue: this.agentCoreRuntime.agentRuntimeArn,
      description: 'ARN of the IDP Agent Runtime',
    });

    new StringParameter(this, 'ResearchAgentRuntimeArnParam', {
      parameterName: SSM_KEYS.RESEARCH_AGENT_RUNTIME_ARN,
      stringValue: researchAgent.runtime.agentRuntimeArn,
      description: 'ARN of the Research Agent Runtime',
    });
  }
}
