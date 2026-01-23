import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';
import Redis from 'ioredis';
import { parseSessionS3Key } from './parse-session-s3-key';
import { generateSessionName } from './generate-session-name';

const s3Client = new S3Client();

const redis = process.env.ELASTICACHE_ENDPOINT
  ? new Redis({ host: process.env.ELASTICACHE_ENDPOINT, port: 6379, tls: {} })
  : null;

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    const keyInfo = parseSessionS3Key(key);
    if (!keyInfo) {
      console.error(`Failed to parse key: ${key}`);
      continue;
    }

    // Extract session_id from key
    // sessions/{user_id}/{project_id}/{session_id}/agents/...
    const sessionIdMatch = key.match(/\/(session_[^/]+)\//);
    if (!sessionIdMatch) {
      console.error(`Failed to extract session_id from key: ${key}`);
      continue;
    }
    const sessionId = sessionIdMatch[1];

    const sessionJsonKey = `sessions/${keyInfo.userId}/${keyInfo.projectId}/${sessionId}/session.json`;

    // Get session.json
    const getSessionCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: sessionJsonKey,
    });

    const sessionResponse = await s3Client.send(getSessionCommand);
    const sessionBody = await sessionResponse.Body?.transformToString();

    if (!sessionBody) {
      console.error(`Empty session.json for ${sessionJsonKey}`);
      continue;
    }

    const sessionData = JSON.parse(sessionBody);

    const sessionName = await generateSessionName(s3Client, bucket, key);
    if (!sessionName) {
      console.error(`Failed to generate session name for ${key}`);
      continue;
    }

    sessionData.session_name = sessionName;

    // Update session.json
    const putSessionCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: sessionJsonKey,
      Body: JSON.stringify(sessionData),
      ContentType: 'application/json',
    });

    await s3Client.send(putSessionCommand);

    if (redis) {
      const cacheKey = `session_list:${keyInfo.userId}:${keyInfo.projectId}`;
      await redis.del(cacheKey);
    }

    console.log(`Updated session_name for ${sessionJsonKey}`);
  }
};
