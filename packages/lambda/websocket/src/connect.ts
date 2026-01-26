import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const connectHandler: APIGatewayProxyWebsocketHandlerV2 = async (
  event,
) => {
  const { connectionId, identity } = event.requestContext;

  console.log('WebSocket connected', {
    connectionId,
    identity,
  });

  return { statusCode: 200, body: 'Connected' };
};
