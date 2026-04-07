---
name: searching
description: "Search documents and knowledge graph for information. Combines hybrid search, graph traversal, and keyword graph lookup. Use when user asks questions, requests information lookup, needs explanations, summaries, or comparisons from uploaded documents. Any user question requiring information lookup. When in doubt, use this skill."
---

# Search Skill

Do NOT mention internal search strategy or tool selection reasoning to the user. Just search and answer.

## Available Search Methods

You have these search methods. Use your judgment to pick the right combination for each query.

**`search___summarize`**
Hybrid search (vector + keyword) on uploaded documents. Returns matching content with sources.

**`search___graph_traverse`**
Follows entity connections from search results to discover additional related pages. Requires `qa_ids` from `search___summarize` results.

**`search___graph_keyword`**
Finds pages by keyword similarity in the knowledge graph. Useful when a specific concept or term is the focus.

**`search` + `fetch_content`**
Web search via DuckDuckGo. Use only when document search is insufficient. Fetch 3+ URLs. Clearly distinguish document vs. web sources.

## Combinations

- `search___summarize` alone — quick answer from documents
- `search___summarize` → `search___graph_traverse` — deeper search with related pages
- `search___graph_keyword` alone — explore a concept across documents
- `search___summarize` + `search___graph_keyword` — comprehensive search
- `search___summarize` → `search___graph_traverse` + `search___graph_keyword` — maximum coverage
- Any of the above + web search — when documents are not enough

Document search first. Web search last.

## Citations

Use inline citations naturally within the text. For document results, reference the source document and section. For web results, include the URL.

Do not fabricate information or citations that don't exist in search results.
