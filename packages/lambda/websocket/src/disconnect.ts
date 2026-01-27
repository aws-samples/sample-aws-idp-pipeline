import type { APIGatewayProxyHandler } from 'aws-lambda';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

export const disconnectHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId } = event.requestContext;

  if (connectionId) {
    const value = await valkey.get(KEYS.conn(connectionId));
    await valkey.del(KEYS.conn(connectionId));

    if (value) {
      const [, username] = value.split(':');
      await valkey.srem(KEYS.username(username), connectionId);
    }
  }

  console.log('WebSocket disconnected', { connectionId });

  return { statusCode: 200, body: 'Disconnected' };
};
