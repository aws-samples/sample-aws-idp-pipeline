import { Stack, StackProps } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SessionNameUpdate, SSM_KEYS } from ':idp-v2/common-constructs';

export class WorkerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpcId = StringParameter.valueFromLookup(this, SSM_KEYS.VPC_ID);
    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId });

    const sessionStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
    );

    const sessionStorageBucket: IBucket = Bucket.fromBucketName(
      this,
      'SessionStorageBucket',
      sessionStorageBucketName,
    );

    const elasticacheEndpoint = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.ELASTICACHE_ENDPOINT,
    );

    new SessionNameUpdate(this, 'SessionNameUpdate', {
      bucket: sessionStorageBucket,
      vpc,
      elasticacheEndpoint,
    });
  }
}
