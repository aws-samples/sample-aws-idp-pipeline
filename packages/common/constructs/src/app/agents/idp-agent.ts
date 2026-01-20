import { Construct } from 'constructs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import {
  AgentRuntimeArtifact,
  Gateway,
  ProtocolType,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';

export interface IdpAgentProps {
  agentPath: string;
  agentName: string;
  sessionStorageBucket: IBucket;
  lancedbLockTable: ITable;
  lancedbExpressBucketName: string;
  backendTable: ITable;
  gateway?: Gateway;
  bedrockModelId?: string;
}

export class IdpAgent extends Construct {
  public readonly runtime: Runtime;

  constructor(scope: Construct, id: string, props: IdpAgentProps) {
    super(scope, id);

    const {
      agentPath,
      agentName,
      sessionStorageBucket,
      lancedbLockTable,
      lancedbExpressBucketName,
      backendTable,
      gateway,
      bedrockModelId,
    } = props;

    const dockerImage = AgentRuntimeArtifact.fromAsset(agentPath, {
      platform: Platform.LINUX_ARM64,
    });

    this.runtime = new Runtime(this, 'Runtime', {
      runtimeName: agentName,
      protocolConfiguration: ProtocolType.HTTP,
      agentRuntimeArtifact: dockerImage,
      environmentVariables: {
        SESSION_STORAGE_BUCKET_NAME: sessionStorageBucket.bucketName,
        LANCEDB_LOCK_TABLE_NAME: lancedbLockTable.tableName,
        LANCEDB_EXPRESS_BUCKET_NAME: lancedbExpressBucketName,
        BACKEND_TABLE_NAME: backendTable.tableName,
        ...(gateway?.gatewayUrl && { MCP_GATEWAY_URL: gateway.gatewayUrl }),
        ...(bedrockModelId && { BEDROCK_MODEL_ID: bedrockModelId }),
      },
    });

    if (gateway) {
      gateway.grantInvoke(this.runtime.role);
    }

    // Grant S3 read/write access for session storage
    sessionStorageBucket.grantReadWrite(this.runtime.role);

    // Grant DynamoDB read/write access for LanceDB lock table
    lancedbLockTable.grantReadWriteData(this.runtime.role);

    // Grant DynamoDB read/write access for backend table
    backendTable.grantReadWriteData(this.runtime.role);

    // Grant S3 Express access for LanceDB storage
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3express:*'],
        resources: ['*'],
      }),
    );

    // Add Bedrock model invocation permissions
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Rerank',
        ],
        resources: ['*'],
      }),
    );
  }
}
