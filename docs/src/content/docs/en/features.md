---
title: "Features"
description: "Sample AWS IDP Pipeline Key Features"
---

## 1. Project Management

Manage documents and analysis results on a per-project basis.

- Create / edit / delete projects
- Language settings (Korean, English, Japanese)
- Custom document analysis prompts
- Per-project color themes

<!-- ![Project Management](../assets/features-project.gif) -->

---

## 2. Document Upload & Preprocessing

Upload files in various formats and the system automatically detects the file type and routes them to the appropriate preprocessing pipeline. Supports documents (PDF, DOC, TXT), images (PNG, JPG, GIF, TIFF), videos (MP4, MOV, AVI), and audio files (MP3, WAV, FLAC) up to 500MB.

- Drag-and-drop / multi-file upload
- Automatic file type detection and pipeline routing
- PaddleOCR (SageMaker) text extraction
- Bedrock Data Automation document structure analysis (optional)
- PDF text layer extraction (pypdf)
- Audio/video transcription (AWS Transcribe)

> For detailed preprocessing flows by file type, see [Preprocessing Pipeline](./preprocessing.md).

| File Type | Supported Formats | Preprocessing |
|-----------|-------------------|---------------|
| Documents | PDF, DOC, TXT | PaddleOCR + BDA (optional) + PDF text extraction |
| Images | PNG, JPG, GIF, TIFF | PaddleOCR + BDA (optional) |
| Videos | MP4, MOV, AVI | AWS Transcribe + BDA (optional) |
| Audio | MP3, WAV, FLAC | AWS Transcribe |

<!-- ![Document Upload](../assets/features-upload.gif) -->

---

## 3. AI Analysis Pipeline

Uploaded documents are automatically analyzed through a Step Functions workflow. A Strands SDK-based ReAct Agent performs in-depth analysis on each segment using an iterative question-answer approach.

- Per-segment deep analysis (Claude Sonnet 4.6 Vision ReAct Agent)
- Video analysis (TwelveLabs Pegasus 1.2)
- Document summary generation (Claude Haiku 4.5)
- Vector embedding and storage (Nova Embed 1024d → LanceDB)
- Reanalysis / Q&A regeneration / Q&A add and delete

```
Document Upload
  → Preprocessing (OCR, BDA, Transcribe)
    → Segment Splitting
      → Distributed Map (max 30 concurrency)
        → ReAct Agent Analysis (per segment)
          → Vector Embedding → LanceDB Storage
      → Document Summary Generation
```

> For detailed analysis flow, see [AI Analysis Pipeline](./analysis.md).

<!-- ![AI Analysis Pipeline](../assets/features-analysis.gif) -->

---

## 4. Real-time Notifications

Workflow progress is delivered to the frontend in real-time via WebSocket. DynamoDB Streams detects state changes, looks up active connections in Redis, and pushes events through the WebSocket API.

- Step-level start / complete / error notifications
- Segment analysis progress (X/Y completed)
- Workflow start / complete / error notifications
- Artifact and session creation events

<!-- ![Real-time Notifications](../assets/features-realtime.gif) -->

---

## 5. Workflow Detail View

View detailed per-segment results for analyzed documents.

- Per-segment OCR / BDA / PDF text / AI analysis results
- Video segment timecode-based viewing
- Transcription segment review
- Q&A regeneration (with custom instructions)
- Q&A add and delete
- Full document reanalysis

<!-- ![Workflow Detail](../assets/features-workflow-detail.gif) -->

---

## 6. AI Chat (Agent Core)

A conversational AI interface powered by Bedrock Agent Core. IDP Agent and Research Agent leverage tools via MCP Gateway for document search, artifact generation, and more, performing Q&A based on documents uploaded to the project.

### Chat Features

- Streaming responses with real-time tool usage display (typing buffering for smooth rendering)
- Stop mid-response (cancel in-progress generation)
- Image/document attachments (multi-modal input)
- Markdown rendering and code highlighting
- Session management (create / rename / delete, conversation history preserved)

### Model Selection

Pick the model and reasoning effort per turn.

- Model list loaded from an SSM-backed catalog (add/remove without redeploy)
- Reasoning effort (low/medium/high) — for models that support it
- Changing the model starts a new chat; the last-used model per session is remembered (this browser only)

### Inline Visualization and Questions

- **Inline charts**: numeric answers rendered as chart cards (horizontal bar / compare / timeline / donut / stacked / scatter)
- **Question cards**: the agent presents structured questions (single / multi / free-text) as cards, and the user's choice is applied on the next turn

### Hybrid Search

The AI Agent automatically searches project documents during conversations.

- Vector search + Full-Text Search (FTS)
- Multilingual tokenization (Lindera / ICU4X)
- Cohere Rerank v3.5 result reranking

### Custom Agents

Create custom agents per project for specialized analysis.

- Agent name and system prompt configuration
- Create / edit / delete agents
- Switch agents during conversations

### MCP Tools

| Tool | Description |
|------|-------------|
| summarize / graph_traverse / graph_keyword | Hybrid search and graph traversal over project documents |
| search_datasets / describe_dataset / run_sql | Structured data (Excel/CSV) Text2SQL querying |
| create/edit_document, extract_text/tables | Generate documents (PDF/DOCX/PPTX) and extract text/tables |
| save/load/edit_markdown | Create and edit markdown files |
| render_chart | Render inline chart cards |
| ask_user | Show question cards |
| generate_image | AI image generation |
| code_interpreter | Python code execution |

<!-- ![AI Chat](../assets/features-chat.gif) -->

---

## 7. Artifact Management

Manage files generated by agents during AI chat (PDF, DOCX, images, markdown, etc.) in the artifact gallery.

- Browse and search artifacts
- Inline preview (images, PDF, markdown, HTML, DOCX)
- Download and delete
- Filter by project
- Navigate to originating project

<!-- ![Artifacts Management](../assets/features-artifacts.gif) -->
