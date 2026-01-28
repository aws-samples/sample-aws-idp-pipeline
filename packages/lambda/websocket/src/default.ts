import type { APIGatewayProxyHandler } from 'aws-lambda';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

interface SubscribeMessage {
  action: 'subscribe' | 'unsubscribe';
  projectId: string;
}

export const defaultHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId } = event.requestContext;
  const body = event.body;

  console.log('WebSocket message', { connectionId, body });

  if (!connectionId || !body) {
    return { statusCode: 200, body: 'OK' };
  }

  try {
    const message = JSON.parse(body) as SubscribeMessage;

    if (message.action === 'subscribe' && message.projectId) {
      await valkey.sadd(KEYS.project(message.projectId), connectionId);
      await valkey.sadd(KEYS.connProjects(connectionId), message.projectId);
      console.log('Subscribed to project', {
        connectionId,
        projectId: message.projectId,
      });
    } else if (message.action === 'unsubscribe' && message.projectId) {
      await valkey.srem(KEYS.project(message.projectId), connectionId);
      await valkey.srem(KEYS.connProjects(connectionId), message.projectId);
      console.log('Unsubscribed from project', {
        connectionId,
        projectId: message.projectId,
      });
    }
  } catch {
    // Not a JSON message or not a subscribe/unsubscribe action
  }

  return { statusCode: 200, body: 'OK' };
};
