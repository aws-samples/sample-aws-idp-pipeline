import { invokeLanceDB } from '../lib/clients.js';
import { rerankResults } from '../lib/rerank.js';
import type { SearchInput, HybridResult } from '../types.js';

export interface RerankOutput {
  results: Array<{
    document_id: string;
    segment_id: string;
    qa_id: string;
    content: string;
    score: number;
  }>;
}

export const handler = async (event: SearchInput): Promise<RerankOutput> => {
  const { project_id, query, document_id, limit = 10, language } = event;

  const result = await invokeLanceDB('hybrid_search', {
    project_id,
    query,
    limit,
    document_id,
    language,
  });

  const results = (result.results ?? []) as HybridResult[];

  if (results.length === 0) {
    return { results: [] };
  }

  const reranked = await rerankResults(query, results, limit);

  return {
    results: reranked.map((r) => ({
      document_id: r.document_id,
      segment_id: r.segment_id,
      qa_id: r.qa_id,
      content: r.content,
      score: r.rerankScore,
    })),
  };
};
