import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export interface ArtifactsMessage {
  action: 'artifacts';
  data: {
    event: 'created';
    artifact_id: string;
    filename: string;
    created_at: string;
  };
}

const sqsClient = new SQSClient();

export async function sendWebsocketMessage(
  username: string,
  message: ArtifactsMessage,
  project_id: string,
): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.WEBSOCKET_MESSAGE_QUEUE_URL,
      MessageBody: JSON.stringify({ username, message, project_id }),
    }),
  );
}
