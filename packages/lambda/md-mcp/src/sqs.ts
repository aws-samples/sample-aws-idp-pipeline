import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export interface ArtifactsMessage {
  action: 'artifacts';
  data: {
    event: 'created' | 'updated' | 'deleted';
    artifactId: string;
    artifactFileName: string;
    timestamp: string;
  };
}

const sqsClient = new SQSClient();

export async function sendWebsocketMessage(
  username: string,
  message: ArtifactsMessage,
): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.WEBSOCKET_MESSAGE_QUEUE_URL,
      MessageBody: JSON.stringify({ username, message }),
    }),
  );
}
