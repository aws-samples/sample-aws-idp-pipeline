import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({});

function parseCognitoAuthProvider(provider: string | undefined) {
  if (!provider) return null;

  // Format: "cognito-idp.{region}.amazonaws.com/{userPoolId},cognito-idp.{region}.amazonaws.com/{userPoolId}:CognitoSignIn:{userSub}"
  const parts = provider.split(':');
  const userPoolPart = parts[0].split('/');
  const userPoolId = userPoolPart[1];
  const userSub = parts[parts.length - 1];

  return { userPoolId, userSub };
}

export const connectHandler: APIGatewayProxyWebsocketHandlerV2 = async (
  event,
) => {
  const { connectionId, identity } = event.requestContext;

  console.log('WebSocket connected', {
    connectionId,
    cognitoIdentityId: identity?.cognitoIdentityId,
  });

  // Cognito User Pool에서 사용자 정보 조회
  const parsed = parseCognitoAuthProvider(identity?.cognitoAuthenticationProvider);
  if (parsed) {
    const command = new AdminGetUserCommand({
      UserPoolId: parsed.userPoolId,
      Username: parsed.userSub,
    });

    const user = await cognitoClient.send(command);
    const username = user.Username;

    console.log('User info', {
      connectionId,
      username,
    });
  }

  return { statusCode: 200, body: 'Connected' };
};
