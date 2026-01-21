import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { AwsClient } from 'aws4fetch';

const ssmClient = new SSMClient();

let cachedBackendUrl: string | null = null;
let cachedAwsClient: AwsClient | null = null;

async function getBackendUrl(): Promise<string> {
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

function getAwsClient(): AwsClient {
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

interface RerankInput {
  project_id: string;
  query: string;
  document_id?: string;
  limit?: number;
  candidate_limit?: number;
}

interface RerankResult {
  workflow_id: string;
  segment_id: string;
  segment_index: number;
  content: string;
  keywords: string;
  rerank_score: number;
}

export const handler = async (event: RerankInput): Promise<RerankResult[]> => {
  const {
    project_id,
    query,
    document_id,
    limit = 3,
    candidate_limit = 10,
  } = event;

  const backendUrl = (await getBackendUrl()).replace(/\/$/, '');

  const params = new URLSearchParams({
    query,
    limit: String(limit),
    candidate_limit: String(candidate_limit),
  });

  if (document_id) {
    params.append('document_id', document_id);
  }

  const url = `${backendUrl}/projects/${project_id}/search/rerank?${params}`;
  console.log('Request URL:', url);
  const client = getAwsClient();
  const response = await client.fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();
    console.log('Error response:', errorBody);
    throw new Error(
      `Backend request failed: ${response.status} ${response.statusText} - ${errorBody}`,
    );
  }

  const data = (await response.json()) as { results: RerankResult[] };
  return data.results;
};
