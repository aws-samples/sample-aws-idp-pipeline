import { Stack, StackProps } from 'aws-cdk-lib';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SessionNameUpdate, SSM_KEYS } from ':idp-v2/common-constructs';

export class WorkerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const sessionStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
    );

    const sessionStorageBucket: IBucket = Bucket.fromBucketName(
      this,
      'SessionStorageBucket',
      sessionStorageBucketName,
    );

    new SessionNameUpdate(this, 'SessionNameUpdate', {
      bucket: sessionStorageBucket,
    });
  }
}
