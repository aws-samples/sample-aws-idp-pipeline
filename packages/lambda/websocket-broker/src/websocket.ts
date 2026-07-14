import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_CALLBACK_URL,
});

/**
 * Valkey에서 죽은(GoneException) 커넥션의 흔적을 제거한다. disconnect 핸들러와
 * 동일한 정리 로직으로, API Gateway가 disconnect 이벤트를 흘린 경우에도 stale
 * 커넥션이 무한 누적되지 않도록 방어한다.
 */
async function removeStaleConnection(connectionId: string): Promise<void> {
  const value = await valkey.get(KEYS.conn(connectionId));
  await valkey.del(KEYS.conn(connectionId));

  if (value) {
    const [, username] = value.split(':');
    await valkey.srem(KEYS.username(username), connectionId);
  }

  const projectIds = await valkey.smembers(KEYS.connProjects(connectionId));
  for (const projectId of projectIds) {
    await valkey.srem(KEYS.project(projectId), connectionId);
  }
  await valkey.del(KEYS.connProjects(connectionId));
}

export async function sendToConnection(
  connectionId: string,
  data: string,
): Promise<void> {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: data,
      }),
    );
  } catch (error) {
    if (error instanceof GoneException) {
      console.log(`Connection ${connectionId} is gone, cleaning up`);
      await removeStaleConnection(connectionId);
      return;
    }
    throw error;
  }
}
