import { Names, RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, CorsRule, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3BucketProps {
  readonly bucketPrefix: string;
  readonly cors?: CorsRule[];
  readonly versioned?: boolean;
}

export class S3Bucket extends Construct {
  public readonly bucket: IBucket;
  public readonly logBucket: IBucket;

  constructor(scope: Construct, id: string, props: S3BucketProps) {
    super(scope, id);

    const { bucketPrefix } = props;

    this.logBucket = new Bucket(this, `${bucketPrefix}-LogBucket`, {
      bucketName: `${bucketPrefix}-logs-${Names.uniqueId(this)}`.toLowerCase(),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    this.bucket = new Bucket(this, `${bucketPrefix}-Bucket`, {
      bucketName: `${bucketPrefix}-${Names.uniqueId(this)}`.toLowerCase(),
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
