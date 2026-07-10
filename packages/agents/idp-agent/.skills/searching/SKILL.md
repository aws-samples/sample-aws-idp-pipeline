---
name: searching
description: "Search for information across unstructured documents (hybrid search, knowledge graph) AND structured datasets (Text2SQL over spreadsheet tables). Use when the user asks questions, requests information lookup, needs explanations, summaries, comparisons, or exact numbers/aggregations/rankings from uploaded documents or datasets. Any user question requiring information lookup. When in doubt, use this skill."
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

**`WebSearch`**
Managed web search (AgentCore). Returns ranked results with source URLs, titles, and publication dates. Use only when the documents and datasets are insufficient. Always cite source URLs.

## Structured datasets (Text2SQL)

Some projects also contain **structured datasets** (spreadsheets converted to queryable tables) alongside unstructured documents. For questions needing exact numbers, aggregation, filtering, ranking, or counting ("how many", "top N", "average", "list all X where ..."), query these instead of (or in addition to) document search.

**`data___search_datasets`**
Hybrid-search the project's dataset catalog for datasets relevant to a query (returns top matches with name + description + table_name). Call this FIRST with a description of the data you need to discover which dataset(s) can answer the question. Projects may have many datasets, so search rather than list.

**`data___describe_dataset`**
Return a dataset's reference document (columns, types, enum values, query patterns, caveats) plus its `table_name`. Call this BEFORE writing SQL — it is the source of truth for column names. Columns are normalized to snake_case (e.g. `primary_type`, `sp_atk`), so no double-quoting is needed.

**`data___run_sql`**
Run a read-only DuckDB query.
- Single dataset: pass `dataset_uri`; the table is named `data` (`FROM data`).
- JOIN across datasets (e.g. multiple sheets, or two related tables): pass `dataset_uris` (a list) and reference each by its `table_name` from `describe_dataset`/`search_datasets` (e.g. `FROM t_aaa a JOIN t_bbb b ON a.code = b.code`). Include EVERY dataset your SQL touches in `dataset_uris`.

Workflow: `search_datasets` → `describe_dataset` (for each relevant dataset) → `run_sql`. Base the answer on query results and show the SQL used.

**Joining datasets**: when a question needs data combined across tables/sheets, `describe_dataset` each one to learn its columns and `table_name`, find the shared key, then issue one `run_sql` with `dataset_uris` listing all of them. Prefer a single JOIN query over stitching separate results by hand.

## Combinations

- `search___summarize` alone — quick answer from documents
- `search___summarize` → `search___graph_traverse` — deeper search with related pages
- `search___graph_keyword` alone — explore a concept across documents
- `search___summarize` + `search___graph_keyword` — comprehensive search
- `search___summarize` → `search___graph_traverse` + `search___graph_keyword` — maximum coverage
- `data___search_datasets` → `data___describe_dataset` → `data___run_sql` — exact answers from structured data
- Cross question (spans both): document search to identify the entity → `data___run_sql` with the name/keywords found → synthesize both
- Any of the above + `WebSearch` — when documents and datasets are not enough

Document/dataset search first. Web search last.

## Citations

Use inline citations naturally within the text. For document results, reference the source document and section. For web results, include the URL.

Do not fabricate information or citations that don't exist in search results.
