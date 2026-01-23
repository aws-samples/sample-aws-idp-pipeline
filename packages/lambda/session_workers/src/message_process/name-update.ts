import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { MessageKeyInfo } from '../parse-session-s3-key';
import { generateSessionName } from './generate-session-name';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!redis && process.env.ELASTICACHE_ENDPOINT) {
    redis = new Redis({
      host: process.env.ELASTICACHE_ENDPOINT,
      port: 6379,
      tls: {},
    });
  }
  return redis;
}

export async function handleNameUpdate(
  s3Client: S3Client,
  bucket: string,
  key: string,
  keyInfo: MessageKeyInfo,
): Promise<void> {
  const sessionJsonKey = `sessions/${keyInfo.userId}/${keyInfo.projectId}/${keyInfo.sessionId}/session.json`;

  const sessionResponse = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: sessionJsonKey }),
  );
  const sessionBody = await sessionResponse.Body?.transformToString();

  if (!sessionBody) {
    console.error(`Empty session.json for ${sessionJsonKey}`);
    return;
  }

  const sessionData = JSON.parse(sessionBody);

  const sessionName = await generateSessionName(s3Client, bucket, key);
  if (!sessionName) {
    console.error(`Failed to generate session name for ${key}`);
    return;
  }

  sessionData.session_name = sessionName;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: sessionJsonKey,
      Body: JSON.stringify(sessionData),
      ContentType: 'application/json',
    }),
  );

  const redisClient = getRedis();
  if (redisClient) {
    const cacheKey = `session_list:${keyInfo.userId}:${keyInfo.projectId}`;
    await redisClient.del(cacheKey);
  }

  console.log(`Updated session_name for ${sessionJsonKey}`);
}
