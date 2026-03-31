import { handler as summarize } from './actions/search_summarize.js';
import type { SearchInput, OverviewInput } from './types.js';

interface LambdaContext {
  clientContext?: {
    custom?: {
      bedrockAgentCoreToolName?: string;
    };
  };
}

export const handler = async (event: unknown, context: LambdaContext) => {
  const toolName =
    context.clientContext?.custom?.bedrockAgentCoreToolName ?? '';
  const action = toolName.includes('___')
    ? toolName.split('___').pop()
    : toolName;

  switch (action) {
    case 'summarize':
      return summarize(event as SearchInput);
    case 'rerank': {
      const { handler: rerank } = await import('./actions/search_rerank.js');
      return rerank(event as SearchInput);
    }
    case 'overview': {
      const { handler: overview } = await import('./actions/overview.js');
      return overview(event as OverviewInput);
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
