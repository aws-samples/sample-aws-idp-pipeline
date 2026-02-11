import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

export const bedrockClient = new BedrockRuntimeClient();

const lambdaClient = new LambdaClient();

export async function invokeLanceDB(
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const command = new InvokeCommand({
    FunctionName: process.env.LANCEDB_FUNCTION_ARN,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({ action, params }),
  });

  const response = await lambdaClient.send(command);

  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : 'Unknown error';
    throw new Error(`LanceDB Lambda error: ${errorPayload}`);
  }

  const payload = response.Payload
    ? JSON.parse(new TextDecoder().decode(response.Payload))
    : {};

  if (payload.statusCode !== 200) {
    throw new Error(payload.error ?? 'LanceDB Lambda error');
  }

  return payload;
}
