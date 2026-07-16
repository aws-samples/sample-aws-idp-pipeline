## 0.2.6 (2026-07-16)

### 🚀 Features

- **Text2SQL structured-data pipeline**: upload Excel/CSV as datasets (validate → Parquet → reference doc → DATASET#), queried from chat via Data MCP (`search_datasets` / `describe_dataset` / `run_sql`) with per-project catalog search ([18c1a90](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/18c1a90))
- **chat**: per-turn model selector (Sonnet 5 / Opus 4.8 / Sonnet 4.6) with reasoning control and SSM-backed catalog; inline chart cards (`render_chart`: hbar/compare/timeline/donut/stacked/scatter); question cards (`ask_user`); typewriter streaming and stop-response ([181e1bd](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/181e1bd))
- upgrade default agent models to Sonnet 5 and Opus 4.8 ([afac1ee](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/afac1ee))
- replace DuckDuckGo with AgentCore Web Search across agents ([6ca7729](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/6ca7729))
- add chat cancellation and harden UI resource cleanup ([b3234f2](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/b3234f2))

### 🩹 Fixes

- prevent SQL injection in chat history query ([7bac67d](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/7bac67d))
- websocket reconnect and cleanup ([#342](https://github.com/aws-samples/sample-aws-idp-pipeline/pull/342))
- **auth**: use light color scheme for managed login so heading and field labels stay visible ([237a106](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/237a106))
- **frontend:** import fromCognitoIdentityPool from credential-provider-cognito-identity to fix Vite esbuild 'fromTokenFile' export error ([#331](https://github.com/aws-samples/sample-aws-idp-pipeline/pull/331))
- **infra:** apply prettier formatting to workflow-stack ([f825576](https://github.com/aws-samples/sample-aws-idp-pipeline/commit/f825576))

### ❤️ Thank You

- 윤창헌
- ChangHun Yoon
- Keita
- yunwoong
- Zoumana Keita @keitazoumana

## 0.2.5 (2026-04-14)

### Agent

- Replace custom skills system with Strands built-in `AgentSkills` plugin (#278)
- Upgrade `strands-agents` to 1.34.1
- Add `SyntaxCheckHook` — pre-flight `compile()` check on `code_interpreter` calls, cancels with clean error on `SyntaxError` before reaching the AgentCore sandbox (#287)
- Remove `!pip install` directives from `docx`/`pptx`/`xlsx`/`chart` SKILL.md files; rely on AgentCore Code Interpreter pre-installed libraries (#282)

### Bug Fixes

- Fix `/chat/projects/{id}/sessions/{id}` 500 error: change `ChatMessage.created_at`/`updated_at` to `datetime` to match DuckDB's auto-parsed timestamp type (#283)

### UI

- Add manual refresh button to the Artifacts side panel for cases when WebSocket `created` events are missed (#283)

## 0.2.4 (2026-04-02)

### Knowledge Graph

- Refactor entity extraction into dedicated Lambda (`entity-extractor`) with test mode for prompt tuning
- Split `analysis-finalizer` into 3 parallel Lambdas: SQS sender, page description generator, entity extractor
- Introduce core entity normalization using LLM — groups related entities loosely for better cross-page connections
- Store core entities in LanceDB (`add_graph_keywords`) for cross-document keyword search
- Add `search___graph_traverse` tool (qa_ids-based graph traversal, replaces `graph___graph_search`)
- Add `search___graph_keyword` tool (keyword similarity search via LanceDB + Neptune)
- Remove `graph-mcp` Lambda; merge graph tools into `search-mcp`
- Optimize Neptune queries: remove entity_limit, consolidate entity loop into single UNWIND query
- Graph search returns qa_id/qa_index for precise QA-level results
- Graph search filters sources to only Haiku-cited segments
- Entity extraction prompt improvements: skip visual labels, chart axes, generic terms
- Entity normalization prompt: loose grouping with core entity creation (one entity can belong to multiple groups)

### Features

- Add graph keywords actions for lancedb-service (#248)
- Add `get_by_qa_ids` action for LanceDB (#260)
- Add rerank action and restructure search-mcp into actions/lib (#258)
- Delete keywords by project id (#249)

### Bug Fixes

- Fix single image OCR chunk merger race condition (add `chunk_index` to single payload)
- Fix backend graph rebuild API timeout (increase Lambda invoke `read_timeout` to 900s)
- Fix graph-service `raw_query` not passing openCypher parameters
- Fix frontend `isGraphTool` check for renamed graph tools
- Fix `ToolResultDetailModal` segment_id parsing for qa_id format

### UI

- Add keyword display and connected entities to graph search result modal
- Add origin page indicators (yellow nodes) in graph search visualization
- Add clickable origin page filter in graph search modal
- Collapsible entity list in graph search results
- Show Analysis/Extra labels instead of QA index numbers
- Hide NEXT edges by default in document graph view
- Increase graph page range limit to 100
- Graph search shows only matched entities (not all entities on found segments)
- Deduplicate sources by page in graph results

### Search Skill

- Rewrite search skill with document search, keyword graph search, and web search paths
- Remove internal path labels from agent responses


## 0.2.3 (2026-03-23)

### Security

- Bump **jsdom** to ^29.0.0 (#101)
- Bump **undici** to >=7.24.0 (#115)
- Bump **express-rate-limit** to >=8.2.2 (#104)
- Bump **@modelcontextprotocol/sdk** to >=1.27.1 (#104)
- Bump **file-type** to >=21.3.2 (#113)
- Bump **ajv** to >=8.18.0 (#74)
- Bump **devalue** to >=5.6.4 (#107)
- Bump **yauzl** to >=3.2.1 (#117)
- Bump **flatted** to >=3.4.0 (#118)
- Bump **svgo** to >=4.0.1 (#99, #100)
- Bump **pillow** to >=12.1.1 (#61)

### Dependencies

- Bump **pyjwt** from 2.10.1 to 2.12.0 (#211)
- Bump **hono** from 4.12.4 to 4.12.7 (#199)
- Bump **pyasn1** from 0.6.2 to 0.6.3 (#216)
- Bump **aws-sdk-dynamodb** in lancedb-service (#215)

### Documentation

- Add permissions docs and update FAQ (#210)

### Bug Fixes

- Fix `chunk_pdf_path` UnboundLocalError in finally block (#208)
- Fix ajv override breaking eslint on Node 25 (#213)
- Fix imported Lambda permission issue using `fromFunctionAttributes` with `sameEnvironment`

### Features

- Add Rust PaddleOCR Lambda with MNN-based CPU inference, replacing Docker container Lambda (#229)
- Refactor OCR processor to two-Lambda architecture: Python adapter + Rust inference
- Remove `use_doc_unwarping` and `use_textline_orientation` OCR options from UI
- Remove entity types and cluster nodes from Neptune graph; simplify Entity ID hash to `SHA256(project_id:name)`
- Replace CodeBuild-based Rust Lambda builds with cargo-lambda-cdk RustFunction construct (#220)
- Add toka multilingual tokenizer Lambda for keyword extraction (#212)
- Migrate lancedb-service from Python Docker Lambda to Rust Lambda with cargo-lambda-cdk (#214, #217, #218)
- Pass language parameter to LanceDB for keyword extraction

## 0.2.2 (2026-03-13)
### Workflow Orchestration
- Integrate OCR, BDA, Transcribe, and WebCrawler preprocessing into Step Functions state machine with polling loops for async job
tracking
- Add real-time progress visibility for all preprocessing steps through WebSocket notifications
- Add English comments to all Step Functions states describing purpose and branching logic

### Analysis Optimization
- Improve analysis prompt to reduce redundant processing
- Exclude Excel (.xlsx) and CSV files from AI analysis pipeline

### Bug Fixes
- Fix webcrawler branch completing immediately without waiting for agent to finish (add DDB polling loop)
- Fix transcribe results not being merged into segments (check use_transcribe flag instead of missing preprocess_check.status)
- Fix reanalysis not updating language in DynamoDB workflow data
- Fix single tilde (~) being rendered as strikethrough in markdown across all components
- Fix shell redirect issue in Lambda layer build causing junk file creation

## 0.2.1 (2026-03-10)

Infrastructure updates for large-scale document processing.

# Changelog

## 0.2.0 (2026-03-01)

Initial release of IDP Pipeline v2.
