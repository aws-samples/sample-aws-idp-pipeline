import { Names, RemovalPolicy, aws_s3express } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface S3DirectoryBucketProps {
  readonly bucketPrefix: string;
  readonly availabilityZoneId: string;
}

export class S3DirectoryBucket extends Construct {
  public readonly bucket: aws_s3express.CfnDirectoryBucket;
  public readonly bucketName: string;
  public readonly bucketArn: string;

  constructor(scope: Construct, id: string, props: S3DirectoryBucketProps) {
    super(scope, id);

    const { bucketPrefix, availabilityZoneId } = props;

    const hash = Names.uniqueId(this).slice(-8).toLowerCase();
    this.bucketName = `${bucketPrefix}-${hash}--${availabilityZoneId}--x-s3`;

    this.bucket = new aws_s3express.CfnDirectoryBucket(
      this,
      'DirectoryBucket',
      {
        bucketName: this.bucketName,
        dataRedundancy: 'SingleAvailabilityZone',
        locationName: availabilityZoneId,
      },
    );

    this.bucket.applyRemovalPolicy(RemovalPolicy.DESTROY);

    this.bucketArn = `arn:aws:s3express:*:*:bucket/${this.bucketName}`;
  }
}
