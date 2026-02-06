import { handler as searchImage } from './search_image.js';
import type { SearchImageInput } from './search_image.js';

interface LambdaContext {
  clientContext?: {
    custom?: {
      bedrockAgentCoreToolName?: string;
    };
  };
}

export const handler = async (event: unknown, context: LambdaContext) => {
  const toolName = context.clientContext?.custom?.bedrockAgentCoreToolName ?? '';
  const action = toolName.includes('___') ? toolName.split('___').pop() : toolName;

  switch (action) {
    case 'search_image':
      return searchImage(event as SearchImageInput);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
