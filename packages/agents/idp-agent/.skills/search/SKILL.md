---
name: search
description: "Search strategy guide for finding information from any source."
whenToUse: "Use for any user question that requires information lookup — document content questions, factual queries, explanations, summaries, comparisons, or web search requests. When in doubt, activate this skill."
---

# Search Skill

## Core Rule

Always perform document search first. Web search is only a supplementary fallback after document search returns insufficient results.

## Search Strategy

### Step 1: Document Search (Required)
- For every query, start by searching uploaded documents using `search___summarize`.
- Use clear, specific search queries. If one query doesn't return results, try alternative keywords or phrasings before giving up.
- When the user's question is broad, break it into multiple focused search queries.

### Step 2: Graph Search for Related QA Pairs
- After `search___summarize` returns results, call `graph___graph_search` with the same query AND the `qa_ids` from the search results.
- Extract `qa_ids` from the `sources` array in the search result (each source has a `qa_id` field).
- Graph search traverses entity connections to find related QA pairs that keyword/vector search may have missed (e.g., searching "Big River" finds QA pairs about "Pipeline" connected via shared entities).
- Even if document search returned good results, graph search may reveal additional related QA pairs from other documents.

### Step 3: Evaluate Results
- Combine results from both document search and graph search.
- If results are sufficient: answer based on those results with citations. Do not proceed to web search.
- If both searches return no results or irrelevant results: inform the user that the information was not found in their documents, then proceed to web search as a supplement.

### Step 4: Web Search (Fallback Only)
- Only use web search after document search has been performed and returned insufficient results.
- Use `search` (DuckDuckGo) for web queries when documents don't have the answer.
- Use `fetch_content` to retrieve full page content from promising search results.
- Clearly distinguish between information from the user's documents vs. the web.

## Web Search Guidelines

When performing web searches:
1. Search with max_results of 10 to get diverse sources
2. Call `fetch_content` on at least 3 different URLs
3. If a website returns an error (403, timeout, etc.), try another URL until you have successfully fetched 3+ pages
4. Synthesize information from all fetched sources before responding
5. Always cite the sources you used with their URLs

## Search Tools

- `search___summarize`: Search uploaded documents. Use this first for any query.
- `graph___graph_search`: Find related QA pairs via knowledge graph traversal. Use after `search___summarize`. Pass `qa_ids` from search results as starting points.
- `graph___link_documents`: Link two documents with a RELATED_TO relationship. Requires `project_id`, `document_id_1`, `document_id_2`. Optional: `reason`, `label`.
- `graph___unlink_documents`: Remove the RELATED_TO relationship between two documents. Requires `project_id`, `document_id_1`, `document_id_2`.
- `search`: Web search via DuckDuckGo. Only use as fallback after document search.
- `fetch_content`: Fetch full content from a web URL. Use after web search to get detailed information.

## Citations

- When citing document search results, reference the source document name and relevant section.
- When citing web sources, include the URL.
- Use inline citations naturally within the text, not just a list at the end.

## What NOT to Do

- Do not fabricate information or citations that don't exist in search results.
