import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const disconnectHandler: APIGatewayProxyWebsocketHandlerV2 = async (
  event,
) => {
  const { connectionId, identity } = event.requestContext;

  console.log('WebSocket disconnected', {
    connectionId,
    identity,
  });

  return { statusCode: 200, body: 'Disconnected' };
};
