import type { HybridResult } from './types';

export function buildPrompt(query: string, results: HybridResult[]): string {
  const searchResultsText = results
    .map(
      (r, i) =>
        `[${i + 1}] document_id: ${r.document_id}, segment_id: ${r.segment_id}\n${r.content}`,
    )
    .join('\n\n');

  return `You are an assistant that organizes document search results.

<query>
${query}
</query>

<search_results>
${searchResultsText}
</search_results>

Organize the information related to the query based on the search results above.

Rules:
1. Preserve the original document's expressions and content as much as possible. Do not interpret or infer arbitrarily.
2. Exclude search results that are not related to the query.
3. If related information is found from multiple documents, organize them by source.
4. Always specify the source (document_id, segment_id) for each piece of information.
5. If no related information is found, respond with "No related information found."
6. Respond in the same language as the document content.

Output format:
[Source: document_id=xxx, segment_id=yyy]
(Information based on original content)

[Source: document_id=xxx, segment_id=yyy]
(Information based on original content)`;
}
