import { S3Event } from 'aws-lambda';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { parseArtifactS3Key } from './parse-artifact-key';
import { sendWebsocketMessage } from './sqs';

const s3Client = new S3Client({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    // Only process files in artifacts/ path
    if (!key.includes('/artifacts/')) {
      continue;
    }

    const keyInfo = parseArtifactS3Key(key);
    if (!keyInfo) {
      console.log(`Failed to parse artifact key: ${key}`);
      continue;
    }

    // Get file metadata from S3
    const headResponse = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const now = new Date().toISOString();
    const contentType = headResponse.ContentType ?? 'application/octet-stream';
    const fileSize = headResponse.ContentLength ?? 0;

    // Save metadata to DynamoDB
    await ddbClient.send(
      new PutCommand({
        TableName: process.env.BACKEND_TABLE_NAME,
        Item: {
          PK: `ART#${keyInfo.artifactId}`,
          SK: 'META',
          artifact_id: keyInfo.artifactId,
          created_at: now,
          data: {
            content_type: contentType,
            filename: keyInfo.filename,
            file_size: fileSize,
            project_id: keyInfo.projectId,
            s3_bucket: bucket,
            s3_key: key,
            user_id: keyInfo.userId,
          },
          GSI1PK: `USR#${keyInfo.userId}#ART`,
          GSI1SK: now,
          GSI2PK: `USR#${keyInfo.userId}#PROJ#${keyInfo.projectId}#ART`,
          GSI2SK: now,
        },
      }),
    );

    console.log(`Saved artifact metadata: ${keyInfo.artifactId}`);

    // Send websocket message
    await sendWebsocketMessage(
      keyInfo.userId,
      {
        action: 'artifacts',
        data: {
          event: 'created',
          artifact_id: keyInfo.artifactId,
          filename: keyInfo.filename,
          created_at: now,
        },
      },
      keyInfo.projectId,
    );

    console.log(`Sent websocket message for artifact: ${keyInfo.artifactId}`);
  }
};
