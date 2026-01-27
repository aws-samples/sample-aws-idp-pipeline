import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';

export interface SessionsMessage {
  action: 'sessions';
  data: {
    event: 'created' | 'updated' | 'deleted';
    sessionId: string;
    sessionName: string;
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
      console.log(`Connection ${connectionId} is gone`);
      return;
    }
    throw error;
  }
}
