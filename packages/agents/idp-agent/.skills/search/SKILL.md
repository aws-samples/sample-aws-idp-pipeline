---
name: search
description: Document and web search strategy guide. Use this when users ask questions about documents or need to search for information.
---

# Search Skill

## Search Strategy (MANDATORY)

Follow this search priority strictly:

### Step 1: Document Search
- When the user asks about a specific document (by name or ID), what documents are uploaded, or wants a summary/overview of documents, use `search___overview` first.
- For factual questions that require searching document content, use `search___summarize`.
- Use clear, specific search queries. If one query doesn't return results, try alternative keywords or phrasings before giving up.
- When the user's question is broad, break it into multiple focused search queries.

### Step 2: Evaluate Results
- If document search returns relevant results: answer based on those results with citations.
- If document search returns no results or irrelevant results: inform the user that the information was not found in their documents, then offer to search the web.
- If the user explicitly asks for web information or the question is clearly about general/current knowledge (e.g., today's date, weather, news): proceed directly to web search.

### Step 3: Web Search (Fallback)
- Use `search` (DuckDuckGo) for web queries when documents don't have the answer.
- Use `fetch_content` to retrieve full page content from promising search results.
- Clearly distinguish between information from the user's documents vs. the web.

## Web Search Guidelines (MANDATORY)

When performing web searches, you MUST follow these rules strictly:
1. Search with max_results of 10 to get diverse sources
2. You MUST call fetch_content on AT LEAST 3 different URLs - this is a hard requirement, not optional
3. If a website returns an error (403, timeout, etc.), try another URL until you have successfully fetched 3+ pages
4. Do NOT stop after fetching only 1-2 websites - always continue until you have 3+ successful fetches
5. Synthesize information from all fetched sources before responding
6. Always cite the sources you used with their URLs

## Search Tools

- `search___summarize`: Search uploaded documents. Use this FIRST for any factual query.
- `search___overview`: Get an overview of all documents in a project. Use when the user asks what documents are uploaded, what a specific document is about, or wants a summary of their documents.
- `search`: Web search via DuckDuckGo. Use as fallback when documents lack the answer.
- `fetch_content`: Fetch full content from a web URL. Use after web search to get detailed information.

## Citations

- When citing document search results, reference the source document name and relevant section.
- When citing web sources, include the URL.
- Use inline citations naturally within the text, not just a list at the end.

## What NOT to Do

- Do NOT make up information or citations that don't exist in search results.
- Do NOT skip document search and go straight to web search (unless the question is clearly about general/current knowledge).
