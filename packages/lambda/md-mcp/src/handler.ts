import { handler as saveMarkdown } from './save_markdown.js';
import { handler as loadMarkdown } from './load_markdown.js';
import { handler as editMarkdown } from './edit_markdown.js';
import type {
  SaveMarkdownInput,
  LoadMarkdownInput,
  EditMarkdownInput,
} from './models.js';

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
    case 'save_markdown':
      return saveMarkdown(event as SaveMarkdownInput);
    case 'load_markdown':
      return loadMarkdown(event as LoadMarkdownInput);
    case 'edit_markdown':
      return editMarkdown(event as EditMarkdownInput);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
