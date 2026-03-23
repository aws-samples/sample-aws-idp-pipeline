---
title: "Vector Database"
description: "Serverless Vector Storage and Multilingual Hybrid Search"
---

## Overview

This project uses [LanceDB](https://lancedb.com/) as the vector database instead of Amazon OpenSearch Service. LanceDB is an open-source, serverless vector database that stores data directly on S3, eliminating the need for dedicated cluster infrastructure. Combined with [Lindera](https://github.com/lindera/lindera) and [ICU4X](https://github.com/unicode-org/icu4x) for multilingual tokenization, it enables hybrid search (vector + full-text) across documents in multiple languages.

### Multi-language Search Support

| Language | Semantic Search (Vector) | Full-Text Search (FTS) | Search Mode |
|----------|:---:|:---:|-------------|
| **Korean** | O | O | Hybrid (Vector + FTS) |
| **Japanese** | O | O | Hybrid (Vector + FTS) |
| **Chinese** | O | O | Hybrid (Vector + FTS) |
| **English and others** | O | O | Hybrid (Vector + FTS) |

Lindera provides dictionary-based tokenization for CJK languages (Korean, Japanese, Chinese), while ICU4X handles word segmentation for other languages. This enables accurate FTS keyword extraction across all supported languages.

### Why LanceDB for PoC?

This project is a **PoC/prototype**, and cost efficiency is a key factor.

| Factor | OpenSearch Service | LanceDB (S3) |
|--------|-------------------|---------------|
| Infrastructure | Dedicated cluster (minimum 2-3 nodes) | No cluster needed (serverless) |
| Idle cost | Charges even when unused | S3 storage only |
| Setup complexity | Domain config, VPC, access policies | S3 bucket + DynamoDB lock table |
| Scaling | Node scaling required | Scales with S3 automatically |
| Estimated monthly cost (PoC) | $200-500+ (t3.medium x2 minimum) | $1-10 (S3 + DDB on-demand) |

:::note
OpenSearch provides richer features (dashboards, k-NN plugin, fine-grained access control) suitable for production workloads. See [Migration to OpenSearch](#migration-to-opensearch) for a transition guide.
:::

---

## Architecture

```
Write Path:
  Analysis Finalizer → SQS (Write Queue) → LanceDB Writer Lambda
    → LanceDB Service Lambda (Rust)
        ├─ Toka Lambda (Rust): keyword extraction (Lindera / ICU4X)
        ├─ Bedrock Nova: vector embedding (1024d)
        └─ LanceDB: store to S3 Express One Zone

Read Path:
  MCP Search Tool Lambda
    → LanceDB Service Lambda (Rust): hybrid search (vector + FTS)
    → Bedrock Claude Haiku: summarize search results

Delete Path:
  Backend API (project deletion)
    → LanceDB Service Lambda: drop_table
```

### Storage Architecture

```
S3 Express One Zone (Directory Bucket)
  └─ idp-v2/
      ├─ {project_id_1}/     ← one LanceDB table per project
      │   ├─ data/
      │   └─ indices/
      └─ {project_id_2}/
          ├─ data/
          └─ indices/

DynamoDB (Lock Table)
  PK: base_uri  |  SK: version
  └─ Manages concurrent access to LanceDB tables
```

---

## Components

### 1. LanceDB Service Lambda (Rust)

The core vector DB service. Implemented in Rust using `cargo-lambda-cdk` for optimized memory usage and cold start performance.

| Item | Value |
|------|-------|
| Function Name | `idp-v2-lance-service` |
| Runtime | Rust (cargo-lambda-cdk) |
| Architecture | ARM64 |
| Memory | 1024 MB |
| Timeout | 5 min |

**Supported Actions:**

| Action | Description |
|--------|-------------|
| `add_record` | Add a QA record (keyword extraction + embedding + store) |
| `delete_record` | Delete by QA ID or segment ID |
| `get_segments` | Retrieve all segments for a workflow |
| `get_by_segment_ids` | Retrieve content by segment ID list (used by Graph MCP) |
| `hybrid_search` | Hybrid search (vector + FTS, `query_type='hybrid'`) |
| `list_tables` | List all project tables |
| `count` | Count records in a project table |
| `delete_by_workflow` | Delete all records for a workflow |
| `drop_table` | Drop an entire project table |

**Why Rust Lambda:**

Rust provides significantly lower memory usage and faster cold starts compared to the previous Docker Python Lambda approach, which is critical for a serverless vector DB service that may scale to zero.

### 2. Toka Lambda (Rust)

A multilingual tokenizer service used by LanceDB Service for FTS keyword extraction.

| Item | Value |
|------|-------|
| Function Name | `idp-v2-toka` |
| Runtime | Rust (cargo-lambda-cdk) |
| Architecture | ARM64 |
| Memory | 1024 MB |
| Tokenizers | Lindera (CJK dictionary-based), ICU4X (Unicode word segmentation) |

### 3. LanceDB Writer Lambda

An SQS consumer that receives write requests from the analysis pipeline and delegates to the LanceDB Service.

| Item | Value |
|------|-------|
| Function Name | `idp-v2-lancedb-writer` |
| Runtime | Python 3.14 |
| Memory | 256 MB |
| Timeout | 5 min |
| Trigger | SQS (`idp-v2-lancedb-write-queue`) |
| Concurrency | 1 (sequential processing) |

Concurrency is set to 1 to prevent concurrent write conflicts on LanceDB tables.

### 4. MCP Search Tool

The Agent's MCP tool invokes the LanceDB Service Lambda directly to perform document retrieval during AI chat.

```
User Query → Bedrock Agent Core → MCP Gateway
  → Search Tool Lambda → LanceDB Service Lambda (hybrid_search)
    → Bedrock Claude Haiku: summarize search results → Response
```

| Item | Value |
|------|-------|
| Stack | McpStack |
| Runtime | Node.js 22.x (ARM64) |
| Timeout | 30s |
| Environment | `LANCEDB_FUNCTION_ARN` (via SSM) |

---

## Data Schema

Each QA analysis result is stored as a record. Since a single segment (page) can have multiple QAs, **records are created per QA unit**:

```python
class DocumentRecord(LanceModel):
    workflow_id: str            # Workflow ID
    document_id: str            # Document ID
    segment_id: str             # "{workflow_id}_{segment_index:04d}"
    qa_id: str                  # "{workflow_id}_{segment_index:04d}_{qa_index:02d}"
    segment_index: int          # Segment page/chapter number
    qa_index: int               # QA number (starting from 0)
    question: str               # AI-generated question
    content: str                # content_combined (SourceField for embedding)
    vector: Vector(1024)        # Bedrock Nova embedding (VectorField)
    keywords: str               # Tokenized keywords (FTS indexed)
    file_uri: str               # Original file S3 URI
    file_type: str              # MIME type
    image_uri: Optional[str]    # Segment image S3 URI
    created_at: datetime        # Timestamp
```

- **One table per project**: Table name = `project_id`
- **Per-QA storage**: Multiple QAs per segment are stored as independent records (uniquely identified by `qa_id`)
- **`content`**: Merged text from all preprocessing (OCR + BDA + PDF text + AI analysis)
- **`vector`**: Auto-generated by LanceDB's embedding function (Bedrock Nova, 1024 dimensions)
- **`keywords`**: Lindera/ICU4X-extracted tokens for FTS index. Lindera handles CJK languages with dictionary-based tokenization, ICU4X handles other languages with Unicode word segmentation

---

## Toka: Multilingual Tokenizer

Toka is a Rust-based multilingual tokenizer Lambda that combines [Lindera](https://github.com/lindera/lindera) and [ICU4X](https://github.com/unicode-org/icu4x) for accurate keyword extraction across languages.

### Why a Custom Tokenizer?

LanceDB's built-in FTS tokenizer does not support CJK languages well. CJK languages (Korean, Japanese, Chinese) are agglutinative or lack word boundaries, so simple space-based tokenization is insufficient. For example:

```
Korean input:  "인공지능 기반 문서 분석 시스템을 구축했습니다."
Toka output:   ["인공지능", "기반", "분석", "시스템", "구축", "했", "."]

Japanese input: "文書分析システムを構築しました"
Toka output:    ["文書", "分析", "システム", "構築", "し"]
```

### Tokenizer Selection

| Language | Tokenizer | Method |
|----------|-----------|--------|
| Korean | Lindera (lindera-ko-dic) | Dictionary-based morphological analysis |
| Japanese | Lindera (lindera-ipadic) | Dictionary-based morphological analysis |
| Chinese | Lindera (lindera-cc-cedict) | Dictionary-based segmentation |
| Others | ICU4X | Unicode word segmentation |

---

## Hybrid Search Flow

All searches are processed by the LanceDB Service Lambda. It uses LanceDB's native `query_type='hybrid'` to combine vector search and full-text search.

```
Search Query: "문서 분석 결과 조회"
  │
  ├─ [1] Toka keyword extraction (via LanceDB Service Lambda)
  │     → ["문서", "분석", "결과", "조회"]
  │
  ├─ [2] LanceDB native hybrid search
  │     → table.search(query=keywords, query_type='hybrid')
  │     → Vector search (Nova embedding) + FTS auto-merged
  │     → Top-K results with _relevance_score
  │
  └─ [3] Result summarization (MCP Search Tool Lambda)
        → Bedrock Claude Haiku generates answer from search results
```

---

## Infrastructure (CDK)

### S3 Express One Zone

```typescript
// StorageStack
const expressStorage = new CfnDirectoryBucket(this, 'LanceDbExpressStorage', {
  bucketName: `idp-v2-lancedb--use1-az4--x-s3`,
  dataRedundancy: 'SingleAvailabilityZone',
  locationName: 'use1-az4',
});
```

S3 Express One Zone provides single-digit millisecond latency, optimized for frequent read/write patterns like vector search operations.

### DynamoDB Lock Table

```typescript
// StorageStack
const lockTable = new Table(this, 'LanceDbLockTable', {
  partitionKey: { name: 'base_uri', type: AttributeType.STRING },
  sortKey: { name: 'version', type: AttributeType.NUMBER },
  billingMode: BillingMode.PAY_PER_REQUEST,
});
```

Manages distributed locking when multiple Lambda functions access the same dataset concurrently.

### SSM Parameters

| Key | Description |
|-----|-------------|
| `/idp-v2/lancedb/lock/table-name` | DynamoDB lock table name |
| `/idp-v2/lancedb/express/bucket-name` | S3 Express bucket name |
| `/idp-v2/lancedb/express/az-id` | S3 Express availability zone ID |
| `/idp-v2/lancedb/function-arn` | LanceDB Service Lambda function ARN |

---

## Component Dependency Map

The following diagram shows all components that depend on LanceDB:

```mermaid
graph TB
    subgraph Write["Write Path"]
        Writer["LanceDB Writer"]
        QA["QA Regenerator"]
    end

    subgraph Read["Read Path"]
        MCP["MCP Search Tool<br/>(Agent)"]
    end

    subgraph Delete["Delete Path"]
        Backend["Backend API<br/>(Project Deletion)"]
    end

    subgraph Core["Core Service"]
        Service["LanceDB Service<br/>(Rust Lambda)"]
        Toka["Toka<br/>(Rust Lambda)"]
    end

    subgraph Storage["Storage Layer"]
        S3["S3 Express One Zone"]
        DDB["DynamoDB Lock Table"]
    end

    Writer -->|invoke| Service
    QA -->|invoke| Service
    MCP -->|invoke<br/>hybrid_search| Service
    Backend -->|invoke<br/>drop_table| Service

    Service --> S3 & DDB
    Service -->|invoke| Toka

    style Storage fill:#fff3e0,stroke:#ff9900
    style Core fill:#e8f5e9,stroke:#2ea043
    style Write fill:#fce4ec,stroke:#e91e63
    style Read fill:#e3f2fd,stroke:#1976d2
    style Delete fill:#f3e5f5,stroke:#7b1fa2
```

| Component | Stack | Access Type | Description |
|-----------|-------|-------------|-------------|
| **LanceDB Service** | LanceServiceStack | Read/Write | Core DB service (Rust Lambda) |
| **Toka** | LanceServiceStack | Tokenization | Multilingual tokenizer (Rust Lambda) |
| **LanceDB Writer** | WorkflowStack | Write (via Service) | SQS consumer, delegates to Service |
| **Analysis Finalizer** | WorkflowStack | Write (via SQS/Service) | Sends segments to write queue, deletes on reanalysis |
| **QA Regenerator** | WorkflowStack | Write (via Service) | Updates Q&A segments |
| **MCP Search Tool** | McpStack | Read (direct Service invoke) | Agent tool for document retrieval |
| **Backend API** | ApplicationStack | Delete (via Service) | Invokes `drop_table` on project deletion |

---

## Migration to OpenSearch

If migrating to Amazon OpenSearch Service for production, the following components need modification:

### Components to Replace

| Component | Current (LanceDB) | Target (OpenSearch) | Scope |
|-----------|-------------------|---------------------|-------|
| **LanceDB Service Lambda** | Rust Lambda + LanceDB | OpenSearch client (CRUD + search) | Replace entirely |
| **LanceDB Writer Lambda** | SQS → invoke LanceDB Service | SQS → write to OpenSearch index | Replace invoke target |
| **MCP Search Tool** | Lambda invoke → LanceDB Service | Lambda invoke → OpenSearch search | Replace invoke target |
| **StorageStack** | S3 Express + DDB lock table | OpenSearch domain (VPC) | Replace resources |

### Components Unchanged

| Component | Reason |
|-----------|--------|
| **Analysis Finalizer** | Only sends messages to SQS (queue interface unchanged) |
| **Frontend** | No direct DB access |
| **Step Functions Workflow** | No direct LanceDB dependency |

### Migration Strategy

```
Phase 1: Replace Storage Layer
  - Create OpenSearch domain in VPC
  - Replace StorageStack resources (remove S3 Express + DDB lock)
  - Configure Nori analyzer for Korean tokenization (replaces Toka/Lindera)

Phase 2: Replace Write Path
  - Modify LanceDB Service → OpenSearch indexing service
  - Update document schema (OpenSearch index mapping)
  - Add OpenSearch neural ingest pipeline for embeddings

Phase 3: Replace Read Path
  - Update MCP Search Tool Lambda invoke target to OpenSearch search service
  - Remove Toka dependency (Nori handles Korean tokenization)

Phase 4: Remove LanceDB Dependencies
  - Remove Rust Lambda functions (LanceDB Service, Toka)
  - Remove S3 Express bucket and DDB lock table
```

### Key Considerations

| Item | Notes |
|------|-------|
| Korean tokenization | OpenSearch includes [Nori analyzer](https://opensearch.org/docs/latest/analyzers/language-analyzers/#korean-nori) for Korean. Toka/Lindera can be removed. |
| Vector search | OpenSearch k-NN plugin (HNSW/IVF) replaces LanceDB vector search |
| Embedding | OpenSearch neural search can auto-embed via ingest pipelines, or use pre-computed embeddings |
| Cost | OpenSearch requires a running cluster. Minimum 2-node cluster for HA. |
| SQS interface | The SQS write queue pattern can be preserved, only the consumer logic changes |
