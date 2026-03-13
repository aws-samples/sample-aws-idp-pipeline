---
title: "Preprocessing Pipeline"
description: "Automatic Routing and Asynchronous Preprocessing by File Type"
---

## Overview

When a document is uploaded, the Type Detection Lambda detects the file type and distributes the necessary preprocessing tasks asynchronously via SQS queues. Once preprocessing is complete, the Step Functions workflow merges results and passes them to the AI analysis stage.

```
S3 Upload
  ↓ [EventBridge]
Type Detection Lambda
  ├─ OCR Queue        → PaddleOCR (Lambda/SageMaker)
  ├─ BDA Queue        → Bedrock Data Automation
  ├─ Transcribe Queue → AWS Transcribe
  ├─ WebCrawler Queue → Bedrock Agent Core
  └─ Workflow Queue   → Step Functions
                        ├─ Segment Prep (segment creation)
                        ├─ Check Preprocess Status (polling)
                        ├─ Format Parser (text extraction)
                        ├─ Segment Builder (result merging)
                        └─ → AI Analysis Pipeline
```

> For details on the AI analysis pipeline (Segment Analyzer, Document Summarizer), see [AI Analysis Pipeline](./analysis.md).

---

## Preprocessing Routing by File Type

| File Type | Extensions | OCR | BDA | Transcribe | Format Parser | WebCrawler |
|-----------|-----------|:---:|:---:|:----------:|:-------------:|:----------:|
| PDF | `.pdf` | O | O | - | A | - |
| Image | `.png` `.jpg` `.jpeg` `.gif` `.tiff` `.tif` `.webp` | O | O | - | - | - |
| Video | `.mp4` `.mov` `.avi` `.mkv` `.webm` | - | O | O | - | - |
| Audio | `.mp3` `.wav` `.flac` `.m4a` | - | O | O | - | - |
| Word Document | `.docx` `.doc` | - | - | - | A | - |
| Presentation | `.pptx` `.ppt` | - | - | - | A | - |
| Text | `.txt` `.md` | - | - | - | A | - |
| Web | `.webreq` | - | - | - | - | A |
| CAD | `.dxf` | - | - | - | A | - |

- **A** (Automatic): Enabled by default (runs automatically)
- **O** (Optional): User enables per document at upload time
- **-** : Not applicable

> OCR (`use_ocr`), BDA (`use_bda`), and Transcribe (`use_transcribe`) can all be selectively enabled per document at upload time.

---

## Preprocessing Components

### PaddleOCR

Extracts text from PDFs and images. Supports dual backends: Lambda (CPU) or SageMaker (GPU).

| Item | Value |
|------|-------|
| Target | PDF, Images (excluding DXF) |
| Lambda Models | `pp-ocrv5`, `pp-structurev3` (CPU) |
| SageMaker Models | `paddleocr-vl` (GPU) |
| Output | `paddleocr/result.json` (per-page text + block coordinates) |

OCR language is automatically mapped based on the project language setting (Korean → `korean`, Japanese → `japan`, etc.).

> For details, see [PaddleOCR on SageMaker](./ocr.md).

### Bedrock Data Automation (BDA)

Uses AWS Bedrock Data Automation to analyze document structure (tables, layouts, images) in markdown format. For videos, it performs chapter splitting and summarization.

| Item | Value |
|------|-------|
| Target | PDF, Images, Video, Audio (excluding office documents/DXF/web) |
| Activation | `use_bda=true` (selected at document upload) |
| Output | `bda-output/` (markdown, images, metadata) |

### AWS Transcribe

Converts speech from audio and video files to text. Generates timestamped segment-level transcripts.

| Item | Value |
|------|-------|
| Target | Video (MP4, MOV, AVI, MKV, WebM), Audio (MP3, WAV, FLAC, M4A) |
| Activation | `use_transcribe=true` (selected at document upload) |
| Output | `transcribe/{workflow_id}-{timestamp}.json` |

### Format Parser

Extracts text using various libraries depending on file type. Runs synchronously within the Step Functions workflow.

| File Type | Library | Action |
|-----------|---------|--------|
| PDF | `pypdf` | Per-page text layer extraction (graphics stripping) |
| DOCX/DOC | LibreOffice → `pypdf` + `pypdfium2` | Convert to PDF, then per-page text + PNG image generation |
| PPTX/PPT | `python-pptx` + LibreOffice → `pypdfium2` | Per-slide text + PNG image generation |
| TXT/MD | Direct read | Text chunking (15,000 chars, 500 char overlap) |
| DXF | `ezdxf` + `matplotlib` | Per-layout text extraction + PNG rendering |

Output: `format-parser/result.json`

### WebCrawler

A web crawling agent powered by Bedrock Agent Core that crawls URLs specified in `.webreq` files.

| Item | Value |
|------|-------|
| Target | `.webreq` files |
| Input | JSON (`{"url": "...", "instruction": "..."}`) |
| Output | `webcrawler/pages/page_XXXX.json` (multi-page) or `webcrawler/content.md` (legacy) |

---

## Detailed Flow by File Type

### PDF

```
PDF Upload
  ↓
Type Detection
  ├─ OCR Queue → PaddleOCR → paddleocr/result.json (per-page text, optional)
  ├─ BDA Queue → BDA → bda-output/ (markdown, optional)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Render each page to PNG (pypdfium2, 150 DPI)
      ├─ Check Preprocess Status: Poll for OCR/BDA completion
      ├─ Format Parser: Extract text layers with pypdf
      └─ Segment Builder: Merge OCR + BDA + Format Parser
```

| Item | Value |
|------|-------|
| Segment Type | `PAGE` (one per page) |
| Segment Count | Number of PDF pages |
| Images | Per-page PNG (`preprocessed/page_XXXX.png`) |
| Automatic Preprocessing | Format Parser |
| Optional Preprocessing | OCR, BDA |

### Image

```
Image Upload (PNG, JPG, TIFF, etc.)
  ↓
Type Detection
  ├─ OCR Queue → PaddleOCR → paddleocr/result.json (single text, optional)
  ├─ BDA Queue → BDA → bda-output/ (markdown, optional)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Use original image (no copy)
      ├─ Check Preprocess Status: Poll for OCR/BDA completion
      └─ Segment Builder: Merge OCR + BDA
```

| Item | Value |
|------|-------|
| Segment Type | `PAGE` (1) |
| Segment Count | 1 |
| Images | Original file URI used directly |
| Optional Preprocessing | OCR, BDA |

### Video (MP4/MOV/AVI/MKV/WebM)

```
Video Upload
  ↓
Type Detection
  ├─ BDA Queue → BDA → Chapter splitting + summaries (optional)
  ├─ Transcribe Queue → AWS Transcribe → Transcript (optional)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 VIDEO segment
      ├─ Check Preprocess Status: Poll for BDA/Transcribe completion
      └─ Segment Builder: Merge BDA chapters + Transcribe
```

| Item | Value |
|------|-------|
| Segment Type | `VIDEO` (without BDA) or `CHAPTER` (with BDA chapter splitting) |
| Segment Count | 1 (without BDA) or number of chapters (with BDA) |
| Images | None |
| Optional Preprocessing | BDA, Transcribe |

### Audio (MP3/WAV/FLAC/M4A)

```
Audio Upload
  ↓
Type Detection
  ├─ BDA Queue → BDA (optional)
  ├─ Transcribe Queue → AWS Transcribe → Transcript (optional)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 AUDIO segment
      ├─ Check Preprocess Status: Poll for BDA/Transcribe completion
      └─ Segment Builder: Merge Transcribe results
```

| Item | Value |
|------|-------|
| Segment Type | `AUDIO` |
| Segment Count | 1 |
| Images | None |
| Optional Preprocessing | BDA, Transcribe |

### Word Document (DOCX/DOC)

```
DOCX/DOC Upload
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 placeholder
      ├─ Format Parser: Convert to PDF via LibreOffice → per-page text + PNG
      └─ Segment Builder: Override segments with Format Parser results
```

| Item | Value |
|------|-------|
| Segment Type | `PAGE` (one per page) |
| Segment Count | Number of PDF pages after LibreOffice conversion |
| Images | Per-page PNG (`format-parser/slides/slide_XXXX.png` → `preprocessed/page_XXXX.png`) |
| Automatic Preprocessing | Format Parser |
| Async Preprocessing | None (all preprocessing skipped) |

### Presentation (PPTX/PPT)

```
PPTX/PPT Upload
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 placeholder
      ├─ Format Parser: python-pptx text + LibreOffice PDF conversion → PNG
      └─ Segment Builder: Override segments with Format Parser results
```

| Item | Value |
|------|-------|
| Segment Type | `PAGE` (one per slide) |
| Segment Count | Number of slides |
| Images | Per-slide PNG (`format-parser/slides/slide_XXXX.png` → `preprocessed/page_XXXX.png`) |
| Automatic Preprocessing | Format Parser |
| Text Extraction | Slide text + tables + speaker notes |

### Text (TXT/MD)

```
TXT/MD Upload
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 placeholder
      ├─ Format Parser: Read text → chunk splitting
      └─ Segment Builder: Override segments with Format Parser results
```

| Item | Value |
|------|-------|
| Segment Type | `TEXT` (one per chunk) |
| Segment Count | Determined by text length |
| Images | None |
| Automatic Preprocessing | Format Parser |
| Chunking Config | 15,000 chars per chunk, 500 char overlap, sentence boundary preferred |

### Web (.webreq)

```
.webreq File Upload ({"url": "...", "instruction": "..."})
  ↓
Type Detection
  ├─ WebCrawler Queue → Bedrock Agent Core → Web crawling
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 WEB placeholder
      ├─ Check Preprocess Status: Poll for WebCrawler completion
      └─ Segment Builder: Override segments with WebCrawler results
```

| Item | Value |
|------|-------|
| Segment Type | `WEB` (one per page) |
| Segment Count | Number of crawled pages |
| Images | None |
| Automatic Preprocessing | WebCrawler |
| Output Fields | `webcrawler_content`, `source_url`, `page_title` |

### CAD (DXF)

```
DXF File Upload
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: Create 1 placeholder
      ├─ Format Parser: ezdxf text extraction + matplotlib PNG rendering
      └─ Segment Builder: Override segments with Format Parser results
```

| Item | Value |
|------|-------|
| Segment Type | `PAGE` (one per layout) |
| Segment Count | Number of DXF layouts (Model Space + Paper Space) |
| Images | Per-layout PNG (`format-parser/slides/layout_XXXX.png`) |
| Automatic Preprocessing | Format Parser |
| Extracted Entities | TEXT, MTEXT, ATTRIB, DIMENSION + layer/block metadata |

---

## Segment Builder

The Segment Builder merges all preprocessing results into a single segment JSON.

### Merge Priority

```
1. Base structure: Segment Prep (preprocessor/metadata.json)
2. Merge OCR: paddleocr/result.json → paddleocr, paddleocr_blocks
3. Merge BDA: bda-output/ → bda_indexer, bda_image_uri
4. Merge Format Parser: format-parser/result.json → format_parser, image_uri
5. Merge Transcribe: transcribe/*.json → transcribe, transcribe_segments
6. Merge WebCrawler: webcrawler/pages/*.json → webcrawler_content, source_url
```

### Segment Count Determination

Segment count is determined from different sources depending on file type:

| File Type | Segment Count Source |
|-----------|---------------------|
| PDF | Segment Prep (number of PDF pages) |
| Image | Segment Prep (always 1) |
| DOCX/DOC, PPTX/PPT, DXF | Format Parser (pages/slides/layouts after conversion) |
| TXT/MD | Format Parser (number of chunks) |
| Video | Segment Prep (1) or BDA (number of chapters) |
| Audio | Segment Prep (always 1) |
| Web | WebCrawler (number of crawled pages) |

> Segment Prep creates a placeholder, then Segment Builder adjusts the segment count based on actual results and updates `total_segments`.

---

## S3 Output Structure

```
s3://bucket/projects/{project_id}/documents/{document_id}/
  ├─ {original_file}                          # Original uploaded file
  ├─ preprocessed/
  │   ├─ metadata.json                        # Segment Prep metadata
  │   ├─ page_0000.png                        # Page images (PDF, DOCX, PPTX, DXF)
  │   ├─ page_0001.png
  │   └─ ...
  ├─ paddleocr/
  │   └─ result.json                          # OCR results (per-page text + blocks)
  ├─ bda-output/
  │   └─ {job_id}/
  │       ├─ job_metadata.json                # BDA job metadata
  │       ├─ standard_output/
  │       │   ├─ 0/result.json                # BDA analysis results (markdown)
  │       │   └─ 0/assets/                    # BDA extracted images
  │       └─ ...
  ├─ format-parser/
  │   ├─ result.json                          # Text extraction results
  │   └─ slides/                              # PPTX/DOCX/DXF images
  │       ├─ slide_0000.png
  │       └─ ...
  ├─ transcribe/
  │   └─ {workflow_id}-{timestamp}.json       # Transcribe results
  ├─ webcrawler/
  │   ├─ metadata.json                        # Crawling metadata
  │   └─ pages/
  │       ├─ page_0000.json                   # Crawled page content
  │       └─ ...
  └─ analysis/
      ├─ segment_0000.json                    # Merged segment data
      ├─ segment_0001.json
      └─ ...
```

---

## Asynchronous Preprocessing Status Management

Preprocessing status is managed in the `preprocess` field of the DynamoDB workflow record.

```json
{
  "preprocess": {
    "ocr": {"required": true, "status": "completed"},
    "bda": {"required": false, "status": "skipped"},
    "transcribe": {"required": false, "status": "skipped"},
    "webcrawler": {"required": false, "status": "skipped"}
  }
}
```

The `CheckPreprocessStatus` Lambda in the Step Functions workflow periodically polls to verify all required preprocessing is complete. Once all required preprocessors reach `completed` or `skipped` status, the workflow proceeds to the next stage (Format Parser → Segment Builder).
