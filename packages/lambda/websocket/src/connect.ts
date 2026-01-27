import type { APIGatewayProxyHandler } from 'aws-lambda';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

export const connectHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId, identity } = event.requestContext;

  const userSub = identity?.cognitoAuthenticationProvider?.split(':').pop();

  if (connectionId && userSub) {
    await valkey.set(KEYS.conn(connectionId), userSub);
    await valkey.sadd(KEYS.user(userSub), connectionId);
  }

  console.log('WebSocket connected', {
    connectionId,
    userSub,
  });

  return { statusCode: 200, body: 'Connected' };
};
