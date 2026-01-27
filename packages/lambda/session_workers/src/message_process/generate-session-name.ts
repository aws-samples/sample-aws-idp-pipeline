import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parseMessageS3Key } from '../parse-session-s3-key.js';
import { getConnectionIdsByUsername } from './valkey.js';
import { sendToConnection } from './websocket.js';

const bedrockClient = new BedrockRuntimeClient();

interface MessageContent {
  text?: string;
}

interface MessageData {
  message: {
    role: string;
    content: MessageContent[];
  };
  message_id: number;
  redact_message: unknown;
  created_at: string;
  updated_at: string;
}

function extractTextFromMessage(messageData: MessageData): string {
  const content = messageData.message?.content ?? [];
  return content
    .filter((item) => item.text)
    .map((item) => item.text as string)
    .join('\n');
}

export async function generateSessionName(
  s3Client: S3Client,
  bucket: string,
  messageKey: string,
): Promise<string | null> {
  const keyInfo = parseMessageS3Key(messageKey);
  if (!keyInfo) {
    return null;
  }

  const { userId, sessionId } = keyInfo;
  const message0Key = messageKey.replace('message_1.json', 'message_0.json');

  const [userResponse, assistantResponse] = await Promise.all([
    s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: message0Key })),
    s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: messageKey })),
  ]);

  const userBody = await userResponse.Body?.transformToString();
  const assistantBody = await assistantResponse.Body?.transformToString();

  if (!userBody || !assistantBody) {
    return null;
  }

  const userData: MessageData = JSON.parse(userBody);
  const assistantData: MessageData = JSON.parse(assistantBody);

  const userText = extractTextFromMessage(userData).slice(0, 500);
  const assistantText = extractTextFromMessage(assistantData).slice(0, 500);

  const prompt = [
    'Generate a natural and descriptive session title based on the following conversation.',
    'The title should be 3-6 words that capture the essence or goal of the conversation.',
    'Make it sound like a natural conversation topic, not just keywords.',
    'Detect the language used in the conversation and write the title in that same language.',
    'Output only the title, nothing else.',
    '',
    `User: ${userText}`,
    '',
    `Assistant: ${assistantText}`,
  ].join('\n');

  const command = new ConverseCommand({
    modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: {
      maxTokens: 50,
    },
  });

  const response = await bedrockClient.send(command);
  const sessionName = response.output?.message?.content?.[0]?.text?.trim();

  if (!sessionName) {
    return null;
  }

  const connectionIds = await getConnectionIdsByUsername(userId);
  const message = JSON.stringify({
    action: 'sessions',
    data: {
      event: 'created',
      sessionId,
      sessionName,
      timestamp: new Date().toISOString(),
    },
  });
  await Promise.all(
    connectionIds.map((connectionId) =>
      sendToConnection(connectionId, message),
    ),
  );

  return sessionName;
}
