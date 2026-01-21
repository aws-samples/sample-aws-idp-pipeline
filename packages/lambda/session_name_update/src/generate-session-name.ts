import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

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
    'Generate a short session name based on the following conversation.',
    'The session name should be no more than 20 characters and concisely express the main topic of the conversation.',
    'Detect the language used in the conversation and write the session name in that same language.',
    'Output only the session name.',
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

  return sessionName ?? null;
}
