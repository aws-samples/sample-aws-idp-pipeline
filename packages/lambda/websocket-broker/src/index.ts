import type { SQSHandler } from 'aws-lambda';
import { valkey } from './valkey.js';
import { sendToConnection } from './websocket.js';

async function getAllConnectionIds(): Promise<string[]> {
  const connectionIds: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await valkey.scan(
      cursor,
      'MATCH',
      'ws:conn:*',
      'COUNT',
      100,
    );
    cursor = nextCursor;

    for (const key of keys) {
      const connectionId = key.replace('ws:conn:', '');
      connectionIds.push(connectionId);
    }
  } while (cursor !== '0');

  return connectionIds;
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const { username, message, projectId } = JSON.parse(record.body);

    // sessions created 이벤트 시 캐시 무효화
    if (
      message?.action === 'sessions' &&
      message?.data?.event === 'created' &&
      username &&
      projectId
    ) {
      const cacheKey = `session_list:${username}:${projectId}`;
      await valkey.del(cacheKey);
    }

    const connectionIds = username
      ? await valkey.smembers(`ws:username:${username}`)
      : await getAllConnectionIds();

    await Promise.all(
      connectionIds.map((id) => sendToConnection(id, JSON.stringify(message))),
    );
  }
};
