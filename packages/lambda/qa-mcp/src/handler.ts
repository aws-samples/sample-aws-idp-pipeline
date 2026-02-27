import { handler as getSegments } from './get-segments.js';
import { handler as addQa } from './add-qa.js';
import type { GetSegmentsInput, AddQaInput } from './types.js';

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
    case 'get_document_segments':
      return getSegments(event as GetSegmentsInput);
    case 'add_document_qa':
      return addQa(event as AddQaInput);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
