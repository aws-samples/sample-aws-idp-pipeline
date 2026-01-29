import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { AwsClient } from 'aws4fetch';

export const ssmClient = new SSMClient();
export const bedrockClient = new BedrockRuntimeClient();

let cachedBackendUrl: string | null = null;
let cachedAwsClient: AwsClient | null = null;

export async function getBackendUrl(): Promise<string> {
  if (cachedBackendUrl) {
    return cachedBackendUrl;
  }

  const command = new GetParameterCommand({
    Name: process.env.BACKEND_URL_SSM_KEY,
  });
  const response = await ssmClient.send(command);
  cachedBackendUrl = response.Parameter?.Value ?? '';
  return cachedBackendUrl;
}

export function getAwsClient(): AwsClient {
  if (cachedAwsClient) {
    return cachedAwsClient;
  }

  cachedAwsClient = new AwsClient({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    sessionToken: process.env.AWS_SESSION_TOKEN ?? '',
    region: process.env.AWS_REGION,
    service: 'execute-api',
  });
  return cachedAwsClient;
}
