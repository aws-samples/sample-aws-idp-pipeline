import { invokeLanceDB } from './clients';
import { summarizeWithHaiku } from './summarize';
import type { SearchInput, HybridResult, SearchAnswer } from './types';

export const handler = async (event: SearchInput): Promise<SearchAnswer> => {
  const { project_id, query, document_id, limit = 10 } = event;

  const result = await invokeLanceDB('hybrid_search', {
    project_id,
    query,
    limit,
    document_id,
  });

  const results = (result.results ?? []) as HybridResult[];

  if (results.length === 0) {
    return {
      answer: '관련 정보를 찾을 수 없습니다.',
      sources: [],
    };
  }

  return summarizeWithHaiku(query, results);
};
