import type { APIGatewayProxyHandler } from 'aws-lambda';

export const defaultHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId } = event.requestContext;
  const body = event.body;

  console.log('WebSocket message', { connectionId, body });

  return { statusCode: 200, body: 'OK' };
};
