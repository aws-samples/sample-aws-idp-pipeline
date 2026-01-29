import { getBackendUrl, getAwsClient } from './clients';
import { summarizeWithHaiku } from './summarize';
import type { SearchInput, HybridResult, SearchAnswer } from './types';

export const handler = async (event: SearchInput): Promise<SearchAnswer> => {
  const { project_id, query, document_id, limit = 10 } = event;

  const backendUrl = (await getBackendUrl()).replace(/\/$/, '');

  const params = new URLSearchParams({
    query,
    limit: String(limit),
  });

  if (document_id) {
    params.append('document_id', document_id);
  }

  const url = `${backendUrl}/projects/${project_id}/search/hybrid?${params}`;
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

  const data = (await response.json()) as { results: HybridResult[] };

  if (data.results.length === 0) {
    return {
      answer: '관련 정보를 찾을 수 없습니다.',
      sources: [],
    };
  }

  return summarizeWithHaiku(query, data.results);
};
