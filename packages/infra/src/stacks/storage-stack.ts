import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { S3Bucket, SSM_KEYS } from ':idp-v2/common-constructs';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';

export class StorageStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // LanceDB Storage Bucket
    const lancedbStorage = new S3Bucket(this, 'LancedbStorage', {
      bucketPrefix: 'lancedb-storage',
    });

    new StringParameter(this, 'LancedbStorageBucketNameParam', {
      parameterName: SSM_KEYS.LANCEDB_STORAGE_BUCKET_NAME,
      stringValue: lancedbStorage.bucket.bucketName,
    });

    // LanceDB Lock Table
    const lancedbLockTable = new TableV2(this, 'LancedbLockTable', {
      partitionKey: { name: 'base_uri', type: AttributeType.STRING },
      sortKey: { name: 'version', type: AttributeType.NUMBER },
      billing: Billing.onDemand(),
    });

    new StringParameter(this, 'LancedbLockTableNameParam', {
      parameterName: SSM_KEYS.LANCEDB_LOCK_TABLE_NAME,
      stringValue: lancedbLockTable.tableName,
    });

    // Document Storage Bucket
    const documentStorage = new S3Bucket(this, 'DocumentStorage', {
      bucketPrefix: 'document-storage',
    });

    new StringParameter(this, 'DocumentStorageBucketNameParam', {
      parameterName: SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
      stringValue: documentStorage.bucket.bucketName,
    });
  }
}
