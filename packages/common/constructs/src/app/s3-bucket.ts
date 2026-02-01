import { Aws, RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, CorsRule, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3BucketProps {
  readonly bucketPrefix: string;
  readonly cors?: CorsRule[];
  readonly versioned?: boolean;
  /**
   * Explicit bucket name prefix. Final name: `idp-v2-{bucketName}-{account}`.
   * If omitted, CDK auto-generates the name.
   */
  readonly bucketName?: string;
}

export class S3Bucket extends Construct {
  public readonly bucket: IBucket;
  public readonly logBucket: IBucket;

  constructor(scope: Construct, id: string, props: S3BucketProps) {
    super(scope, id);

    const { bucketPrefix } = props;
    const baseName = props.bucketName
      ? `idp-v2-${props.bucketName}-${Aws.ACCOUNT_ID}`
      : undefined;

    this.logBucket = new Bucket(this, `${bucketPrefix}-LogBucket`, {
      bucketName: baseName ? `${baseName}-logs` : undefined,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    this.bucket = new Bucket(this, `${bucketPrefix}-Bucket`, {
      bucketName: baseName ?? undefined,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      serverAccessLogsBucket: this.logBucket,
      serverAccessLogsPrefix: 'access-logs/',
      cors: props.cors,
      versioned: props.versioned,
    });
  }
}
