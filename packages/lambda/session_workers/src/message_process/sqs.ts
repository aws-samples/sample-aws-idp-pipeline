import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export interface SessionsMessage {
  action: 'sessions';
  data: {
    event: 'created' | 'updated' | 'deleted';
    sessionId: string;
    sessionName: string;
    timestamp: string;
  };
}

const sqsClient = new SQSClient();

export async function sendWebsocketMessage(
  username: string,
  message: SessionsMessage,
  projectId?: string,
): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.WEBSOCKET_MESSAGE_QUEUE_URL,
      MessageBody: JSON.stringify({ username, message, projectId }),
    }),
  );
}
