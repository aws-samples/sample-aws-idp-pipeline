import {
  BedrockAgentRuntimeClient,
  RerankCommand,
  RerankSource,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { HybridResult } from '../types.js';

const client = new BedrockAgentRuntimeClient({});

const MODEL_ID = process.env.RERANK_MODEL_ID ?? 'cohere.rerank-v3-5:0';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

function toModelArn(modelId: string): string {
  if (modelId.startsWith('arn:')) return modelId;
  return `arn:aws:bedrock:${REGION}::foundation-model/${modelId}`;
}

export interface RerankResult extends HybridResult {
  rerankScore: number;
}

export async function rerankResults(
  query: string,
  results: HybridResult[],
  topN?: number,
): Promise<RerankResult[]> {
  const sources: RerankSource[] = results.map((r) => ({
    type: 'INLINE' as const,
    inlineDocumentSource: {
      type: 'TEXT' as const,
      textDocument: {
        text: r.content,
      },
    },
  }));

  const command = new RerankCommand({
    queries: [{ type: 'TEXT' as const, textQuery: { text: query } }],
    sources,
    rerankingConfiguration: {
      type: 'BEDROCK_RERANKING_MODEL' as const,
      bedrockRerankingConfiguration: {
        modelConfiguration: {
          modelArn: toModelArn(MODEL_ID),
        },
        numberOfResults: topN ?? results.length,
      },
    },
  });

  const response = await client.send(command);

  return (response.results ?? [])
    .map((r) => ({
      ...results[r.index ?? 0],
      rerankScore: r.relevanceScore ?? 0,
    }))
    .sort((a, b) => b.rerankScore - a.rerankScore);
}
