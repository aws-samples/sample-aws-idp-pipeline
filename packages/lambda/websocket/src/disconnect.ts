import type { APIGatewayProxyHandler } from 'aws-lambda';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

export const disconnectHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId } = event.requestContext;

  if (connectionId) {
    // Clean up user connection
    const value = await valkey.get(KEYS.conn(connectionId));
    await valkey.del(KEYS.conn(connectionId));

    if (value) {
      const [, username] = value.split(':');
      await valkey.srem(KEYS.username(username), connectionId);
    }

    // Clean up project subscriptions
    const projectIds = await valkey.smembers(KEYS.connProjects(connectionId));
    for (const projectId of projectIds) {
      await valkey.srem(KEYS.project(projectId), connectionId);
    }
    await valkey.del(KEYS.connProjects(connectionId));
  }

  console.log('WebSocket disconnected', { connectionId });

  return { statusCode: 200, body: 'Disconnected' };
};
