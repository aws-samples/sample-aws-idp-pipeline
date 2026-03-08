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
Strands Agent (Claude Opus 4.6)
  ├─ 1. Understand intent
  ├─ 2. Create execution plan
  ├─ 3. Load skill → call tools → collect results
  └─ 4. Generate final response with citations
```

---

## Skill System

The agent operates in **skill** units. Skills are markdown files defined in `.skills/{name}/SKILL.md` that the agent reads and follows before performing tasks.

| Skill | Purpose | Tools Used |
|---|---|---|
| **search** | Document search + web search strategy | Search MCP, Graph MCP, DuckDuckGo |
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
  │   └─ Graph MCP (graph_search) → entity connection traversal
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
| `overview` | List project documents |

### Graph MCP

| Tool | Description |
|---|---|
| `graph_search` | Entity graph traversal based on qa_ids, discovers related pages |
| `link_documents` | Create document-to-document links |
| `unlink_documents` | Remove document-to-document links |

### Document MCP

| Tool | Description |
|---|---|
| `extract_text` | Extract text from PDF/DOCX/PPTX |
| `extract_tables` | Extract tables from documents |
| `create_document` | Create PDF/DOCX/PPTX |
| `edit_document` | Edit existing documents |

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
