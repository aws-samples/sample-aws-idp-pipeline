import { Construct } from 'constructs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
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
  backendTable: ITable;
  gateway?: Gateway;
  bedrockModelId?: string;
  agentStorageBucket?: IBucket;
  websocketMessageQueue?: IQueue;
}

export class IdpAgent extends Construct {
  public readonly runtime: Runtime;

  constructor(scope: Construct, id: string, props: IdpAgentProps) {
    super(scope, id);

    const {
      agentPath,
      agentName,
      sessionStorageBucket,
      backendTable,
      gateway,
      bedrockModelId,
      agentStorageBucket,
      websocketMessageQueue,
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
        BACKEND_TABLE_NAME: backendTable.tableName,
        ...(gateway?.gatewayUrl && { MCP_GATEWAY_URL: gateway.gatewayUrl }),
        ...(bedrockModelId && { BEDROCK_MODEL_ID: bedrockModelId }),
        ...(agentStorageBucket && {
          AGENT_STORAGE_BUCKET_NAME: agentStorageBucket.bucketName,
        }),
        ...(websocketMessageQueue && {
          WEBSOCKET_MESSAGE_QUEUE_URL: websocketMessageQueue.queueUrl,
        }),
      },
    });

    if (gateway) {
      gateway.grantInvoke(this.runtime.role);
    }

    // Grant S3 read/write access for session storage
    sessionStorageBucket.grantReadWrite(this.runtime.role);

    // Grant S3 read/write access for agent storage (artifacts)
    if (agentStorageBucket) {
      agentStorageBucket.grantReadWrite(this.runtime.role);
    }

    // Grant SQS send message for websocket notifications
    if (websocketMessageQueue) {
      websocketMessageQueue.grantSendMessages(this.runtime.role);
    }

    // Grant DynamoDB read/write access for backend table
    backendTable.grantReadWriteData(this.runtime.role);

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
