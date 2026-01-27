import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { KEYS } from './keys.js';
import { valkey } from './valkey.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const connectHandler: APIGatewayProxyHandler = async (event) => {
  const { connectionId, identity } = event.requestContext;

  const userSub = identity?.cognitoAuthenticationProvider?.split(':').pop();

  if (connectionId && userSub) {
    const { Item } = await ddbClient.send(
      new GetCommand({
        TableName: process.env.BACKEND_TABLE_NAME,
        Key: { PK: `USRSUB#${userSub}`, SK: 'META' },
      }),
    );

    const username = Item?.data?.username as string | undefined;

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
