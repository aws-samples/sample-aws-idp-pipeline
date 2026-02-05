import { Stack, StackProps } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  ArtifactProcess,
  MessageProcess,
  WebsocketBroker,
  SSM_KEYS,
} from ':idp-v2/common-constructs';

export class WorkerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpcId = StringParameter.valueFromLookup(this, SSM_KEYS.VPC_ID);
    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId });

    const sessionStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
    );

    const sessionStorageBucket = Bucket.fromBucketName(
      this,
      'SessionStorageBucket',
      sessionStorageBucketName,
    );

    const elasticacheEndpoint = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.ELASTICACHE_ENDPOINT,
    );

    const websocketCallbackUrl = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_CALLBACK_URL,
    );

    const websocketApiId = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_API_ID,
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

    new MessageProcess(this, 'MessageProcess', {
      bucket: sessionStorageBucket,
      vpc,
      websocketMessageQueue,
    });

    new WebsocketBroker(this, 'WebsocketBroker', {
      vpc,
      elasticacheEndpoint,
      websocketCallbackUrl,
      websocketApiId,
      websocketMessageQueue,
    });

    // Artifact Process - saves artifact metadata to DynamoDB on S3 upload
    const agentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );

    const agentStorageBucket = Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    const backendTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );

    const backendTable = Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    new ArtifactProcess(this, 'ArtifactProcess', {
      bucket: agentStorageBucket,
      table: backendTable,
      vpc,
      websocketMessageQueue,
    });
  }
}
