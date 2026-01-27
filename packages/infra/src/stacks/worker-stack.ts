import { Stack, StackProps } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { MessageProcess, SSM_KEYS } from ':idp-v2/common-constructs';

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

    new MessageProcess(this, 'MessageProcess', {
      bucket: sessionStorageBucket,
      vpc,
      elasticacheEndpoint,
      websocketCallbackUrl,
      websocketApiId,
    });
  }
}
