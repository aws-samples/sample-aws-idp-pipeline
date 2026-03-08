---
title: "Web Crawler Agent"
description: "Agent that crawls web pages using AgentCore Browser and feeds content into the document pipeline"
---

## Overview

The Web Crawler Agent crawls web pages, extracts content, and connects it to the document analysis pipeline. It controls a real browser via AgentCore Browser and uses the D2Snap algorithm to compress HTML, saving LLM tokens.

```
User uploads .webreq file
  │ EventBridge
  ▼
SQS Queue
  │
  ▼
Webcrawler Consumer Lambda
  │ bedrock-agentcore:InvokeAgentRuntime
  ▼
Web Crawler Agent (AgentCore Runtime)
  ├─ AgentCore Browser (Playwright)
  ├─ D2Snap (HTML compression)
  └─ S3 storage (per-page JSON)
```

---

## Processing Flow

1. User uploads a `.webreq` file (URL + instructions) to S3
2. EventBridge → SQS → Lambda Consumer invokes AgentCore Runtime
3. Agent downloads `.webreq` file from S3, extracts URL and instructions
4. Navigates pages with AgentCore Browser:
   - Take screenshots (visual analysis)
   - Extract HTML → D2Snap compression
   - Extract content as Markdown
   - Save to S3 via `save_page`
   - Evaluate links → crawl additional pages
5. Save metadata, update DynamoDB status

---

## Tools

| Tool | Description |
|---|---|
| `browser` | Navigate, screenshot, click, type, scroll |
| `get_compressed_html` | Compress HTML with D2Snap and return |
| `save_page` | Save extracted content as per-page JSON to S3 |
| `get_current_time` | Get current time (UTC, US/Eastern, US/Pacific, Asia/Seoul) |

---

## D2Snap (HTML Compression)

[D2Snap](https://arxiv.org/pdf/2508.04412) (DOM Downsampling for Static Page Analysis) removes unnecessary elements from HTML, reducing LLM token usage by 70-90%.

### Compression Process

```
Original HTML
  │
  ├─ 1. Remove non-content: <script>, <style>, <svg>, <iframe>, comments
  ├─ 2. Remove hidden elements: aria-hidden, display:none
  ├─ 3. Simplify attributes: keep only id, class, href, src, alt, role, etc.
  └─ 4. Limit content: text 500 chars, lists 10 items, table rows 20
  │
  ▼
Compressed HTML (70-90% token reduction)
```

### Analysis Strategies

| Strategy | Preserves | Use Case |
|---|---|---|
| `content_extraction` | Headings, paragraphs, lists, tables | Content extraction |
| `browser_automation` | Buttons, forms, inputs, navigation | Browser automation |
| `hybrid` | Content + navigation + media | Web crawling (default) |

---

## Input / Output

### Input (.webreq)

```json
{
  "url": "https://example.com/article",
  "instruction": "Focus on main article content (optional)"
}
```

### Output (S3)

```
s3://bucket/projects/{project_id}/documents/{doc_id}/
└── webcrawler/
    ├── metadata.json
    └── pages/
        ├── page_0000.json   ← { url, title, content, crawled_at }
        ├── page_0001.json
        └── page_0002.json
```

---

## DynamoDB Status Tracking

Crawling progress is recorded in DynamoDB.

| PK | SK | Purpose |
|---|---|---|
| `WEB#{document_id}` | `WF#{workflow_id}` | Preprocess status (status, started_at, ended_at) |
| `WF#{workflow_id}` | `STEP` | Workflow step status |

---

## Limitations

- Maximum ~20 pages per crawl
- Agent timeout: default 1800 seconds (30 minutes), configurable via `AGENT_TIMEOUT_SECS`
- Browser operations are serialized with threading locks to prevent Playwright contextvars conflicts
