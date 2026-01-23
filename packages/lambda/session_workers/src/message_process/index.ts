import { S3Client } from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';
import { parseSessionS3Key } from '../parse-session-s3-key';
import { handleNameUpdate } from './name-update';

const s3Client = new S3Client();

export const handler = async (event: S3Event): Promise<void> => {
  console.log(JSON.stringify(event));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    if (!/\/message_\d+\.json$/.test(key)) {
      continue;
    }

    const keyInfo = parseSessionS3Key(key);
    if (!keyInfo) {
      console.error(`Failed to parse key: ${key}`);
      continue;
    }

    if (key.endsWith('message_1.json')) {
      await handleNameUpdate(s3Client, bucket, key, keyInfo);
    }

    // TODO: attachment upload 처리
  }
};
