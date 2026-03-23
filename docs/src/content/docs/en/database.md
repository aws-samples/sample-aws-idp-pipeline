---
title: "Database Overview"
description: "Why we combine vector search and graph traversal, and the search architecture"
---

## Background

This project analyzes documents **page by page**. Each page is separated into independent segments, processed through AI analysis, and the results are stored as vector embeddings. With this structure, there are problems that vector search alone cannot solve.

### Disconnected Pages

Imagine a 100-page engineering drawing. If a single drawing spans 2 pages, vector search treats each page independently. Searching for "Valve V-101 specifications" might return page 42, but the continuation on page 43 could be missed because its content differs enough to drop below the similarity threshold.

```
With vector search only:

Search: "Valve V-101 specifications"
  → Page 42 (V-101 drawing part 1) ✓ Found
  → Page 43 (V-101 drawing part 2) ✗ Missed — different content
  → Page 78 (V-101 maintenance record) ✗ Missed — low similarity
```

This is manageable with a few dozen documents, but with hundreds or thousands of documents, vector similarity alone cannot reliably find all related pages.

### Limitations of Graph-Only Search

We also considered searching with only a graph database. By extracting entities (V-101, valve, maintenance, etc.) and relationships, we could discover all related pages by following entity connections.

```
With graph only:

Search: "Valve V-101 specifications"
  → Entity "V-101" traversal
    → Page 42 (MENTIONED_IN) ✓
    → Page 43 (MENTIONED_IN) ✓
    → Page 78 (RELATES_TO → "maintenance" → MENTIONED_IN) ✓
```

Connected pages are found well, but there were issues:
- **No semantic search**: Weak against natural language queries like "valve specs" that don't match exact entity names
- **Depends on extraction quality**: If the LLM misses an entity, the graph has no connection
- **No FTS**: Graph databases don't support full-text search

### Vector + Graph Combined

We combine the strengths of both approaches:

```
Combined search:

[Step 1] Vector search (LanceDB)
  Search: "Valve V-101 specifications"
  → Page 42 (score: 0.92) ✓
  → Page 15 (score: 0.71) ✓  ← Found via semantic similarity

[Step 2] Graph traversal (Neptune)
  Starting point: QA IDs from page 42 → Entity "V-101" traversal
  → Page 43 (V-101 → MENTIONED_IN) ✓  ← Continuation page discovered
  → Page 78 (V-101 → RELATES_TO → "maintenance" → MENTIONED_IN) ✓
  → Page 42 excluded (deduplication)
```

Vector search finds semantically related pages, and graph traversal follows entity connections to supplement pages that vector search missed.

---

## Search Architecture

The agent uses both databases sequentially via MCP tools.

```
User question: "Tell me about Valve V-101 specs and maintenance history"
  │
  ▼
[1] MCP Search Tool (summarize)
  │  → LanceDB hybrid_search (vector + FTS)
  │  → Haiku summarization
  │  → Result: Page 42, Page 15 (with qa_ids)
  │
  ▼
[2] MCP Graph Tool (graph_search)
  │  → Input: qa_ids (QA IDs from vector search)
  │  → Neptune: QA ID → Analysis → Entity → RELATES_TO → Entity → Analysis → Segment
  │  → LanceDB: Fetch content for discovered segments (get_by_segment_ids)
  │  → Haiku summarization
  │  → Result: Page 43, Page 78 (pages not in vector search)
  │
  ▼
[3] Agent synthesizes both results into final response
```

### The Key Link: Entity

The key that connects both databases is the **Entity**. Related pages are discovered through Analysis nodes that share the same entity.

- **QA ID** (`{workflow_id}_{segment_index}_{qa_index}`): An identifier for the analysis result of each document segment
- **LanceDB**: Stores QA analysis results with `qa_id`, returns `qa_id` in search results
- **Neptune**: Uses the same `qa_id` as Analysis node `id`, with Entities connected via `MENTIONED_IN`

```
LanceDB (qa_id: wf_abc_0042_00)
  ↕ Same ID
Neptune (Analysis {id: wf_abc_0042_00})
  ── MENTIONED_IN → Entity ("V-101", EQUIPMENT) ← MENTIONED_IN ── Analysis {id: wf_abc_0078_00}
                                                                      ↕ Same ID
                                                                    LanceDB (qa_id: wf_abc_0078_00)
```

The same entity "V-101" is mentioned in multiple Analysis nodes, so related pages are discovered simply by sharing the same entity.

---

## Role Division

| | LanceDB (Vector DB) | Neptune (Graph DB) |
|---|---|---|
| **Stores** | QA analysis text + vector embeddings | Entities, relationships, document structure |
| **Search method** | Hybrid (vector + FTS) | Graph traversal (openCypher) |
| **Strength** | Natural language queries, semantic similarity | Entity connections, relationship traversal |
| **Weakness** | Cannot recognize cross-page connections | No semantic search, no FTS |
| **Search order** | Step 1 (starting point) | Step 2 (expansion) |
| **Storage** | S3 Express One Zone | Neptune Serverless (VPC) |
| **Cost model** | S3 pricing only (serverless) | NCU-based (min 1, max 2.5) |

---

## Data Flow

When a document is uploaded, data is built into both databases simultaneously.

```
Step Functions Workflow
  │
  ├─ Map (parallel per segment, max 30)
  │   ├─ SegmentAnalyzer: AI analysis (Claude Sonnet 4.5)
  │   └─ AnalysisFinalizer:
  │       ├─ SQS → LanceDB Writer → LanceDB Service
  │       │   → Keyword extraction (Toka) + Vector embedding (Nova) + Store
  │       └─ Entity/relationship extraction (Strands Agent) → Save to S3
  │
  ├─ GraphBuilder:
  │   └─ Collect entities from S3 → Deduplicate → GraphService → Store in Neptune
  │
  └─ DocumentSummarizer: Generate document summary
```

Vector embedding and entity extraction run in parallel per segment within AnalysisFinalizer, enabling efficient processing of large documents. GraphBuilder runs after the Map completes to collect all entities, deduplicate them, and store them in Neptune.

---

## Sub-pages

- [Vector Database](/vectordb) — LanceDB, S3 Express One Zone, Lindera/ICU4X multilingual tokenization, hybrid search
- [Graph Database](/graphdb) — Neptune DB Serverless, openCypher, entity extraction, graph traversal
- [DynamoDB](/dynamodb) — One Table Design, workflow state management, segment metadata
