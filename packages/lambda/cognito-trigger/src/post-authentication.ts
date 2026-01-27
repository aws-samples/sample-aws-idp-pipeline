import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { PostAuthenticationTriggerEvent } from "aws-lambda";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: PostAuthenticationTriggerEvent
): Promise<PostAuthenticationTriggerEvent> => {
  const { sub, email, given_name, family_name } = event.request.userAttributes;
  const username = event.userName;

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USERSUB#${sub}`,
          SK: "META",
          data: {
            username,
            email,
            given_name,
            family_name,
            created_at: new Date().toISOString(),
          },
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (error) {
    if ((error as Error).name !== "ConditionalCheckFailedException") {
      throw error;
    }
    // 이미 존재하면 무시 (매 로그인마다 실행되므로 중복 방지)
  }

  return event;
};
