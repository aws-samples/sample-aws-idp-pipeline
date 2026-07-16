---
title: "IDP Agent"
description: "The main agent for document search, analysis, and artifact generation"
---

## Overview

The IDP Agent is the main agent that searches and analyzes documents and generates artifacts through conversation with users. It operates using Strands SDK's ReAct pattern, combining MCP tools and Code Interpreter for complex tasks.

```
User question
  │
  ▼
AgentCore Runtime (HTTP streaming)
  │
  ▼
Strands Agent (Claude Opus 4.8, default)
  ├─ 1. Understand intent
  ├─ 2. Create execution plan
  ├─ 3. Load skill → call tools → collect results
  └─ 4. Generate final response with citations
```

### Model Selection

Users can pick the model and reasoning effort per turn from the chat composer.

- The selectable models are loaded at runtime from a catalog defined in an SSM parameter (`/idp-v2/chat/models`). Adding/removing a model is done by editing the parameter — no redeploy needed.
- The agent validates the requested `model_id` against the catalog allowlist (the frontend selector is not a security boundary). A model that is not allowed falls back to the default.
- The reasoning effort (low/medium/high) is passed as `output_config.effort` only when the resolved model supports it.
- Changing the model starts a new conversation, so responses from different models don't mix within one session.

---

## Skill System

The agent operates in **skill** units. Skills are markdown files defined in `.skills/{name}/SKILL.md` that the agent reads and follows before performing tasks.

| Skill | Purpose | Tools Used |
|---|---|---|
| **search** | Document search + web search strategy | Search MCP (summarize, graph_traverse, graph_keyword), AgentCore Web Search |
| **dataset** | Structured data (Excel/CSV) Text2SQL querying | Data MCP (search_datasets, describe_dataset, run_sql) |
| **docx** | Word document creation/editing | Code Interpreter (python-docx) |
| **xlsx** | Excel spreadsheet creation/editing | Code Interpreter (openpyxl) |
| **pptx** | PowerPoint creation/editing | Code Interpreter (python-pptx) |
| **diagram** | Structural diagram generation | Code Interpreter (Mermaid) |
| **chart** | Data visualization chart generation | Code Interpreter (Matplotlib) |
| **qa-analysis** | QA analysis management | QA MCP |
| **markdown** | Markdown document generation | MD MCP |

### Execution Flow

```
User: "Summarize the V-101 valve analysis results in Word"
  │
  ├─ [1] Load search skill → document search
  │   ├─ Search MCP (summarize) → vector + FTS search
  │   └─ Search MCP (graph_traverse) → entity connection traversal
  │
  ├─ [2] Load docx skill → Word document creation
  │   └─ Code Interpreter → write document with python-docx → S3 upload
  │
  └─ [3] Final response with citations
      → [document_id:doc_xxxxx](s3_uri)
      → [artifact_id:art_xxxxx](filename.docx)
```

---

## MCP Tools

MCP tools accessed through the AgentCore Gateway.

### Search MCP

| Tool | Description |
|---|---|
| `summarize` | Hybrid search (vector + FTS) → Haiku summarization, returns qa_ids |
| `graph_traverse` | Entity graph traversal based on qa_ids, discovers related pages |
| `graph_keyword` | Keyword similarity search via LanceDB graph keywords + Neptune traversal |
| `overview` | List project documents |

### Document MCP

| Tool | Description |
|---|---|
| `extract_text` | Extract text from PDF/DOCX/PPTX |
| `extract_tables` | Extract tables from documents |
| `create_document` | Create PDF/DOCX/PPTX |
| `edit_document` | Edit existing documents |

### Data MCP (Structured Data Text2SQL)

Queries Parquet datasets converted from Excel/CSV using SQL. Used for structured data that needs exact aggregation, filtering, or sorting.

| Tool | Description |
|---|---|
| `search_datasets` | Hybrid search over the project's datasets by name/description |
| `describe_dataset` | Retrieve a dataset's schema, samples, and query examples (reference doc) |
| `run_sql` | Run read-only SQL against a Parquet dataset via DuckDB |

### Other MCPs

| MCP | Tool | Description |
|---|---|---|
| Image MCP | `analyze_image` | Image analysis |
| QA MCP | `get_document_segments` | Retrieve document segments |
| QA MCP | `add_document_qa` | Add QA analysis |
| MD MCP | `load_markdown` | Load markdown |
| MD MCP | `save_markdown` | Save markdown |
| MD MCP | `edit_markdown` | Edit markdown |

---

## Local Tools

Tools that run directly in the agent process, not through the Gateway.

| Tool | Description |
|---|---|
| `render_chart` | Render an inline chart card in the reply (hbar / compare / timeline / donut / stacked / scatter). Uses only real values from a prior tool result |
| `ask_user` | Show a structured question card (single / multi / free-text). The user's choice is posted back as the next message and picked up on the following turn |
| `generate_image` | AI image generation |
| `code_interpreter` | Isolated Python sandbox execution (see below) |

Results from `render_chart` and `ask_user` are rendered by the frontend as dedicated UI cards instead of plain text.

---

## Code Interpreter

AgentCore Code Interpreter provides an isolated Python sandbox environment. AWS SDK is pre-configured, enabling S3 uploads.

Used when the agent generates artifacts (documents, charts, diagrams).

```
Code Interpreter
  ├─ python-docx, openpyxl, python-pptx  (document generation)
  ├─ matplotlib                           (charts)
  ├─ mermaid-py                           (diagrams)
  └─ boto3                                (S3 upload)
       → s3://{bucket}/{user_id}/{project_id}/artifacts/{artifact_id}/
```

---

## Multi-language Support

The project's language setting is fetched from DynamoDB and injected into the system prompt. The agent responds in that language.
