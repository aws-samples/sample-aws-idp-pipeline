import {
  ApiGatewayManagementApiClient,
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
  await client.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: data,
    }),
  );
}
