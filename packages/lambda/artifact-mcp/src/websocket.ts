import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

export interface ArtifactsMessage {
  action: 'artifacts';
  data: {
    event: 'created' | 'updated' | 'deleted';
    artifactId: string;
    artifactFileName: string;
    timestamp: string;
  };
}

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_CALLBACK_URL,
});

export async function sendToConnection(
  connectionId: string,
  data: string,
): Promise<void> {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: data,
      }),
    );
  } catch (error) {
    if (error instanceof GoneException) {
      return;
    }
    throw error;
  }
}
