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

    // Get LanceDB lock table from SSM
    const lancedbLockTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_LOCK_TABLE_NAME,
    );

    const lancedbLockTable = Table.fromTableName(
      this,
      'LancedbLockTable',
      lancedbLockTableName,
    );

    // Get LanceDB Express bucket name from SSM
    const lancedbExpressBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_EXPRESS_BUCKET_NAME,
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

    const idpAgent = new IdpAgent(this, 'IdpAgent', {
      agentPath: path.resolve(process.cwd(), '../../packages/agents/idp-agent'),
      agentName: 'idp_agent',
      sessionStorageBucket,
      lancedbLockTable,
      lancedbExpressBucketName,
      backendTable,
      gateway,
    });

    const bidiAgent = new IdpAgent(this, 'BidiAgent', {
      agentPath: path.resolve(
        process.cwd(),
        '../../packages/agents/bidi-agent',
      ),
      agentName: 'bidi_agent',
      sessionStorageBucket,
      lancedbLockTable,
      lancedbExpressBucketName,
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

    new StringParameter(this, 'BidiAgentRuntimeArnParam', {
      parameterName: SSM_KEYS.BIDI_AGENT_RUNTIME_ARN,
      stringValue: bidiAgent.runtime.agentRuntimeArn,
      description: 'ARN of the Bidi Agent Runtime',
    });
  }
}
