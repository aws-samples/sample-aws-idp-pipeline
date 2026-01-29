import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from './clients';
import { buildPrompt } from './prompt';
import type { HybridResult, SearchAnswer } from './types';

const MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

export async function summarizeWithHaiku(
  query: string,
  results: HybridResult[],
): Promise<SearchAnswer> {
  const prompt = buildPrompt(query, results);

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: {
      maxTokens: 2048,
    },
  });

  const response = await bedrockClient.send(command);
  const answer = response.output?.message?.content?.[0]?.text ?? '';

  const sources = results.map((r) => ({
    document_id: r.document_id,
    segment_id: r.segment_id,
  }));

  return { answer, sources };
}
