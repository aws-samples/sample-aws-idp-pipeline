import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const connectHandler: APIGatewayProxyWebsocketHandlerV2 = async (
  event,
) => {
  // 전체 requestContext 로깅하여 어떤 정보가 있는지 확인
  console.log(
    'WebSocket connected - full event',
    JSON.stringify(event, null, 2),
  );

  return { statusCode: 200, body: 'Connected' };
};
