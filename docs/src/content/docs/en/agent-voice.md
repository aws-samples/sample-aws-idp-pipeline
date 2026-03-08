---
title: "Voice Agent"
description: "Bidi Agent supporting real-time bidirectional voice conversation"
---

## Overview

The Voice Agent (Bidi Agent) provides real-time bidirectional voice conversations. It streams audio with the browser via WebSocket using the Amazon Nova Sonic model.

```
Browser (Web Audio API)
  │ WebSocket
  ▼
AgentCore WebSocket Proxy
  │ WebSocket
  ▼
Voice Agent Container (FastAPI + Uvicorn)
  │ Strands BidiModel
  ▼
Amazon Nova Sonic
```

---

## Voice Model

Uses Amazon Nova Sonic. It operates through the AWS internal network, enabling low-latency voice conversations without a separate API key.

| Item | Value |
|---|---|
| **Model** | Amazon Nova Sonic |
| **API Key** | Not required (IAM Role) |
| **Latency** | Low (AWS internal network) |
| **Voices** | tiffany, matthew |

---

## WebSocket Events

### Browser → Server

| Event | Description |
|---|---|
| `audio` | PCM audio (16kHz, 1 channel) |
| `text` | Text input |
| `ping` | Keep-alive (responds with pong) |
| `stop` | End session |

### Server → Browser

| Event | Description |
|---|---|
| `audio` | Response audio (with sample rate) |
| `transcript` | Text (with role, is_final) |
| `tool_use` | Tool invocation notification |
| `tool_result` | Tool execution result |
| `connection_start` | Connection established |
| `response_start` / `response_complete` | Response lifecycle |
| `interruption` | User interrupted speech |
| `error` | Error message |
| `timeout` | Session timeout (default 900s) |

---

## Tools

The Voice Agent can also use MCP tools.

| Tool | Description |
|---|---|
| `getDateAndTimeTool` | Get current time in specified timezone |
| DuckDuckGo `search` | Web search |
| DuckDuckGo `fetch_content` | Fetch full web page content |
| AgentCore MCP tools | Document search, graph traversal, etc. |

---

## Automatic Language Detection

The preferred language is determined based on the browser's timezone.

| Timezone | Language |
|---|---|
| Asia/Seoul | Korean |
| Asia/Tokyo | Japanese |
| Asia/Shanghai | Chinese |
| Europe/Paris | French |
| Europe/Berlin | German |
| America/Sao_Paulo | Portuguese |
| Other | English |

---

## Transcript Persistence

Conversation transcripts are saved to S3.
