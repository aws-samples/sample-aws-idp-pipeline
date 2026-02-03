<h1 align="center">Features</h1>

<p align="center">
  <strong>Sample AWS IDP Pipeline Key Features</strong>
</p>

<p align="center">
  <strong>English</strong> | <a href="FEATURES_ko.md">한국어</a> | <a href="FEATURES_ja.md">日本語</a>
</p>

---

## 1. Project Management

Manage documents and analysis results on a per-project basis.

- Create / edit / delete projects
- Language settings (Korean, English, Japanese)
- Custom document analysis prompts
- Per-project color themes

<p align="center">
  <img src="../assets/features-project.gif" alt="Project Management" width="800">
</p>

---

## 2. Document Upload & Preprocessing

Upload files in various formats and the system automatically detects the file type and routes them to the appropriate preprocessing pipeline. Supports documents (PDF, DOC, TXT), images (PNG, JPG, GIF, TIFF), videos (MP4, MOV, AVI), and audio files (MP3, WAV, FLAC) up to 500MB.

- Drag-and-drop / multi-file upload
- Automatic file type detection and pipeline routing
- PaddleOCR (SageMaker) text extraction
- Bedrock Data Automation document structure analysis (optional)
- PDF text layer extraction (pypdf)
- Audio/video transcription (AWS Transcribe)

| File Type | Supported Formats | Preprocessing |
|-----------|-------------------|---------------|
| Documents | PDF, DOC, TXT | PaddleOCR + BDA (optional) + PDF text extraction |
| Images | PNG, JPG, GIF, TIFF | PaddleOCR + BDA (optional) |
| Videos | MP4, MOV, AVI | AWS Transcribe + BDA (optional) |
| Audio | MP3, WAV, FLAC | AWS Transcribe |

<p align="center">
  <img src="../assets/features-upload.gif" alt="Document Upload" width="800">
</p>

---

## 3. AI Analysis Pipeline

Uploaded documents are automatically analyzed through a Step Functions workflow. A Strands SDK-based ReAct Agent performs in-depth analysis on each segment using an iterative question-answer approach.

- Per-segment deep analysis (Claude Sonnet 4.5 Vision ReAct Agent)
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

> For detailed analysis flow, see [AI Analysis Pipeline](../analysis/ANALYSIS_en.md).

<p align="center">
  <img src="../assets/features-analysis.gif" alt="AI Analysis Pipeline" width="800">
</p>

---

## 4. Real-time Notifications

Workflow progress is delivered to the frontend in real-time via WebSocket. DynamoDB Streams detects state changes, looks up active connections in Redis, and pushes events through the WebSocket API.

- Step-level start / complete / error notifications
- Segment analysis progress (X/Y completed)
- Workflow start / complete / error notifications
- Artifact and session creation events

<p align="center">
  <img src="../assets/features-realtime.gif" alt="Real-time Notifications" width="800">
</p>

---

## 5. Workflow Detail View

View detailed per-segment results for analyzed documents.

- Per-segment OCR / BDA / PDF text / AI analysis results
- Video segment timecode-based viewing
- Transcription segment review
- Q&A regeneration (with custom instructions)
- Q&A add and delete
- Full document reanalysis

<p align="center">
  <img src="../assets/features-workflow-detail.gif" alt="Workflow Detail" width="800">
</p>

---

## 6. AI Chat (Agent Core)

A conversational AI interface powered by Bedrock Agent Core. IDP Agent and Research Agent leverage tools via MCP Gateway for document search, artifact generation, and more, performing Q&A based on documents uploaded to the project.

### Chat Features

- Streaming responses with real-time tool usage display
- Image/document attachments (multi-modal input)
- Markdown rendering and code highlighting
- Session management (create / rename / delete, conversation history preserved)

### Hybrid Search

The AI Agent automatically searches project documents during conversations.

- Vector search + Full-Text Search (FTS)
- Korean morphological analysis (Kiwi)
- Cohere Rerank v3.5 result reranking

### Custom Agents

Create custom agents per project for specialized analysis.

- Agent name and system prompt configuration
- Create / edit / delete agents
- Switch agents during conversations

### MCP Tools

| Tool | Description |
|------|-------------|
| search_documents | Hybrid search across project documents |
| save/load/edit_markdown | Create and edit markdown files |
| create_pdf, extract_pdf_text/tables | Generate PDFs and extract text/tables |
| create_docx, extract_docx_text/tables | Generate Word documents and extract text/tables |
| generate_image | AI image generation |
| code_interpreter | Python code execution |

<p align="center">
  <img src="../assets/features-chat.gif" alt="AI Chat" width="800">
</p>

---

## 7. Artifact Management

Manage files generated by agents during AI chat (PDF, DOCX, images, markdown, etc.) in the artifact gallery.

- Browse and search artifacts
- Inline preview (images, PDF, markdown, HTML, DOCX)
- Download and delete
- Filter by project
- Navigate to originating project

<p align="center">
  <img src="../assets/features-artifacts.gif" alt="Artifacts Management" width="800">
</p>

---

## License

This project is licensed under the [Amazon Software License](../../LICENSE).
