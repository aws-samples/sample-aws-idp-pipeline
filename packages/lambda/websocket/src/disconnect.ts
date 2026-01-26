import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const disconnectHandler: APIGatewayProxyWebsocketHandlerV2 =
  async () => {
    return { statusCode: 200, body: 'Disconnected' };
  };
