import { describe, it, expect } from 'vitest';
import { handler } from './handler';

function makeContext(toolName: string) {
  return {
    clientContext: {
      custom: {
        bedrockAgentCoreToolName: toolName,
      },
    },
  };
}

describe('search-mcp handler', () => {
  it('summarize', async () => {
    const event = {
      project_id: 'proj_aVxKdc8_nj1glgP3-phf1',
      query: '프로토타이핑',
      language: 'ko',
      limit: 5,
    };

    const result = await handler(event, makeContext('summarize'));

    console.log(JSON.stringify(result, null, 2));
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('sources');
  });

  it('rerank', async () => {
    const event = {
      project_id: 'proj_aVxKdc8_nj1glgP3-phf1',
      query: '프로토타이핑',
      language: 'ko',
      limit: 5,
    };

    const result = await handler(event, makeContext('rerank'));

    console.log(JSON.stringify(result, null, 2));
    expect(result).toHaveProperty('results');
  });

  it('overview', async () => {
    const event = {
      project_id: 'proj_aVxKdc8_nj1glgP3-phf1',
    };

    const result = await handler(event, makeContext('overview'));

    console.log(JSON.stringify(result, null, 2));
    expect(result).toHaveProperty('documents');
  });
});
