import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import {
  S3Bucket,
  S3DirectoryBucket,
  SSM_KEYS,
} from ':idp-v2/common-constructs';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { HttpMethods } from 'aws-cdk-lib/aws-s3';

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
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [
            HttpMethods.GET,
            HttpMethods.PUT,
            HttpMethods.POST,
            HttpMethods.HEAD,
          ],
          allowedHeaders: ['*'],
          exposedHeaders: [
            'ETag',
            'Content-Type',
            'Content-Length',
            'Accept-Ranges',
          ],
        },
      ],
    });

    new StringParameter(this, 'DocumentStorageBucketNameParam', {
      parameterName: SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
      stringValue: documentStorage.bucket.bucketName,
    });

    // Session Storage Bucket (for agent conversation history)
    const sessionStorage = new S3Bucket(this, 'SessionStorage', {
      bucketPrefix: 'session-storage',
    });

    new StringParameter(this, 'SessionStorageBucketNameParam', {
      parameterName: SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
      stringValue: sessionStorage.bucket.bucketName,
    });

    // Agent Storage Bucket (for custom agent prompts)
    // Structure: /{user_id}/{project_id}/agents/{agent_name}.md
    const agentStorage = new S3Bucket(this, 'AgentStorage', {
      bucketPrefix: 'agent-storage',
    });

    new StringParameter(this, 'AgentStorageBucketNameParam', {
      parameterName: SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
      stringValue: agentStorage.bucket.bucketName,
    });

    // Model Artifacts Bucket (for ML models like PaddleOCR)
    const modelArtifacts = new S3Bucket(this, 'ModelArtifacts', {
      bucketPrefix: 'model-artifacts',
    });

    new StringParameter(this, 'ModelArtifactsBucketNameParam', {
      parameterName: SSM_KEYS.MODEL_ARTIFACTS_BUCKET_NAME,
      stringValue: modelArtifacts.bucket.bucketName,
    });

    // Backend Table (One Table Design)
    const backendTable = new TableV2(this, 'BackendTable', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
        },
      ],
    });

    new StringParameter(this, 'BackendTableNameParam', {
      parameterName: SSM_KEYS.BACKEND_TABLE_NAME,
      stringValue: backendTable.tableName,
    });

    // Express One Zone Storage Bucket
    const expressStorage = new S3DirectoryBucket(this, 'ExpressStorage', {
      bucketPrefix: 'lancedb-ex',
      availabilityZoneId: 'use1-az4',
    });

    new StringParameter(this, 'LancedbExpressBucketNameParam', {
      parameterName: SSM_KEYS.LANCEDB_EXPRESS_BUCKET_NAME,
      stringValue: expressStorage.bucketName,
    });

    new StringParameter(this, 'LancedbExpressAzIdParam', {
      parameterName: SSM_KEYS.LANCEDB_EXPRESS_AZ_ID,
      stringValue: 'use1-az4',
    });
  }
}
