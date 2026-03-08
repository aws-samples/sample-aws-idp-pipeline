---
title: "DynamoDB"
description: "Workflow state management with One Table Design"
---

## Overview

DynamoDB is used for **workflow state management**, not for search. It applies the **One Table Design** pattern to manage all state for projects, documents, workflows, segments, and processing steps in a single table.

---

## Table Configuration

| Item | Value |
|---|---|
| **Billing** | On-Demand |
| **Partition Key** | `PK` (String) |
| **Sort Key** | `SK` (String) |
| **GSI1** | `GSI1PK` / `GSI1SK` |
| **GSI2** | `GSI2PK` / `GSI2SK` |
| **Stream** | NEW_AND_OLD_IMAGES |

---

## Data Structure

### Project (PROJ#)

```
PK: PROJ#{project_id}
SK: META
```

| Field | Description |
|---|---|
| `data.name` | Project name |
| `data.language` | Language (default: en) |
| `data.document_prompt` | Custom prompt for document analysis |
| `data.ocr_model` | OCR model (default: pp-ocrv5) |

### Project-Document Link (PROJ# / DOC#)

```
PK: PROJ#{project_id}
SK: DOC#{document_id}
```

Query documents belonging to a project with `begins_with(SK, 'DOC#')`.

### Project-Workflow Link (PROJ# / WF#)

```
PK: PROJ#{project_id}
SK: WF#{workflow_id}
```

| Field | Description |
|---|---|
| `data.file_name` | File name |
| `data.status` | Workflow status |

### Workflow Metadata (DOC# or WEB#)

```
PK: DOC#{document_id}  (or WEB#{document_id})
SK: WF#{workflow_id}
```

| Field | Description |
|---|---|
| `data.project_id` | Parent project |
| `data.file_uri` | S3 path |
| `data.file_name` | File name |
| `data.file_type` | MIME type |
| `data.execution_arn` | Step Functions execution ARN |
| `data.status` | pending / in_progress / completed / failed |
| `data.total_segments` | Total segment count |
| `data.preprocess` | Per-stage preprocessing status (ocr, bda, transcribe, webcrawler) |

### Workflow Steps (WF# / STEP)

```
PK: WF#{workflow_id}
SK: STEP
GSI1PK: STEP#ANALYSIS_STATUS
GSI1SK: pending | in_progress | completed | failed
```

Tracks the status of each processing step in a workflow. GSI1 enables fast lookup of currently running analyses.

| Step | Description |
|---|---|
| `segment_prep` | Segment preparation |
| `bda_processor` | Bedrock Document Analysis |
| `format_parser` | Format parsing |
| `paddleocr_processor` | PaddleOCR processing |
| `transcribe` | Audio transcription |
| `webcrawler` | Web crawling |
| `segment_builder` | Segment construction |
| `segment_analyzer` | AI analysis (Claude) |
| `graph_builder` | Graph construction |
| `document_summarizer` | Document summarization |

Each step has `status`, `label`, `started_at`, `ended_at`, and `error` attributes.

### Segments (WF# / SEG#)

```
PK: WF#{workflow_id}
SK: SEG#{segment_index:04d}    ← 0001, 0002, ...
```

| Field | Description |
|---|---|
| `data.segment_index` | Segment index |
| `data.s3_key` | S3 path (segment data) |
| `data.image_uri` | Image URI |
| `data.image_analysis` | Image analysis results array |

---

## Access Patterns

| Query | Index | Key Condition |
|---|---|---|
| Project document list | Primary | `PK=PROJ#{proj_id}`, `SK begins_with DOC#` |
| Project workflow list | Primary | `PK=PROJ#{proj_id}`, `SK begins_with WF#` |
| Workflow metadata | Primary | `PK=DOC#{doc_id}`, `SK=WF#{wf_id}` |
| Step progress | Primary | `PK=WF#{wf_id}`, `SK=STEP` |
| Segment list | Primary | `PK=WF#{wf_id}`, `SK begins_with SEG#` |
| Specific segment | Primary | `PK=WF#{wf_id}`, `SK=SEG#{index}` |
| In-progress analysis | GSI1 | `GSI1PK=STEP#ANALYSIS_STATUS`, `GSI1SK=in_progress` |

---

## Design Principles

### Why One Table Design

- **Single transaction**: Workflow metadata and step status are created atomically via `batch_write`
- **Efficient queries**: All documents/workflows for a project retrieved with a single query
- **Cost reduction**: Minimized operational complexity with a single table

### Role Division with S3

DynamoDB stores only **state and metadata**, while **actual data** (segment content, analysis results) is stored in S3.

```
DynamoDB                          S3
  ├─ Workflow status               ├─ Segment raw data
  ├─ Step progress                 ├─ Analysis results (JSON)
  ├─ Segment metadata (s3_key)     ├─ Entity extraction results
  └─ WebSocket connections         └─ Document summaries
```

Due to the Step Functions payload limit (256KB), DynamoDB serves as intermediate storage. Documents with 3000+ pages can be processed by passing only segment indices through the workflow.
