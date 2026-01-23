import { S3Client } from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';
import { parseMessageS3Key } from '../parse-session-s3-key';
import { handleAttachmentUpload } from './attachment-upload';
import { handleNameUpdate } from './name-update';

const s3Client = new S3Client();

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    if (!/\/message_\d+\.json$/.test(key)) {
      continue;
    }

    const keyInfo = parseMessageS3Key(key);
    if (!keyInfo) {
      console.error(`Failed to parse key: ${key}`);
      continue;
    }

    await handleAttachmentUpload(s3Client, bucket, key, keyInfo);

    if (key.endsWith('message_1.json')) {
      await handleNameUpdate(s3Client, bucket, key, keyInfo);
    }
  }
};
