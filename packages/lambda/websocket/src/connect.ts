import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function getUsernameFromSub(
  userSub: string,
): Promise<string | undefined> {
  // 캐시에서 먼저 조회
  const cached = await valkey.get(KEYS.userSub(userSub));
  if (cached) {
    return cached;
  }

  // 캐시에 없으면 DynamoDB에서 조회
  const { Item } = await ddbClient.send(
    new GetCommand({
      TableName: process.env.BACKEND_TABLE_NAME,
      Key: { PK: `USRSUB#${userSub}`, SK: 'META' },
    }),
  );

  const username = Item?.data?.username as string | undefined;

  // 캐시에 저장
  if (username) {
    await valkey.set(KEYS.userSub(userSub), username);
  }

  return username;
}

export const connectHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId, identity } = event.requestContext;

  const userSub = identity?.cognitoAuthenticationProvider?.split(':').pop();

  if (connectionId && userSub) {
    const username = await getUsernameFromSub(userSub);

    if (username) {
      await valkey.set(KEYS.conn(connectionId), `${userSub}:${username}`);
      await valkey.sadd(KEYS.username(username), connectionId);
    }

    console.log('WebSocket connected', {
      connectionId,
      userSub,
      username,
    });
  }

  return { statusCode: 200, body: 'Connected' };
};
