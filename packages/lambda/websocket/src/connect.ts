import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const connectHandler: APIGatewayProxyWebsocketHandlerV2 = async () => {
  return { statusCode: 200, body: 'Connected' };
};
