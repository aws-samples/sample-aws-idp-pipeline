import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { MessageKeyInfo } from '../parse-session-s3-key';
import { generateSessionName } from './generate-session-name';
import { sendWebsocketMessage, SessionsMessage } from './sqs.js';

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

  const agentFolder = keyInfo.agentId;
  if (agentFolder.startsWith('agent_')) {
    sessionData.agent_id = agentFolder.slice('agent_'.length);
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: sessionJsonKey,
      Body: JSON.stringify(sessionData),
      ContentType: 'application/json',
    }),
  );

  // Send WebSocket notification via SQS
  const message: SessionsMessage = {
    action: 'sessions',
    data: {
      event: 'created',
      sessionId: keyInfo.sessionId,
      sessionName,
      timestamp: new Date().toISOString(),
    },
  };
  await sendWebsocketMessage(keyInfo.userId, message, keyInfo.projectId);

  console.log(`Updated session_name for ${sessionJsonKey}`);
}
