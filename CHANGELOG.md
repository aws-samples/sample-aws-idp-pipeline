## 0.2.3 (Draft)

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
