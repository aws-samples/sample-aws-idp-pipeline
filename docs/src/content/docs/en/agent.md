---
title: "Agent Overview"
description: "AI agent architecture and roles built on Strands SDK"
---

## Agent Composition

This project consists of 3 independent AI agents. Each agent is built on the [Strands SDK](https://github.com/strands-agents/sdk-python) and runs on AWS Bedrock AgentCore.

| Agent | Role | Model | Interface |
|---|---|---|---|
| **IDP Agent** | Document analysis, search, artifact generation | Claude Opus 4.6 | HTTP streaming |
| **Voice Agent** | Real-time bidirectional voice conversation | Nova Sonic | WebSocket |
| **Web Crawler Agent** | Web page crawling and content extraction | Claude Sonnet 4.6 | SQS trigger |

## Common Architecture

```
User request
  │
  ▼
AWS Bedrock AgentCore
  │
  ├─ AgentCore Runtime (ECS container)
  │   └─ Strands Agent
  │       ├─ LLM (Bedrock)
  │       ├─ MCP tools (AgentCore Gateway)
  │       └─ Built-in tools (Strands SDK)
  │
  ├─ MCP Gateway (IAM SigV4 auth)
  │   ├─ Search MCP (LanceDB hybrid search)
  │   ├─ Graph MCP (Neptune graph traversal)
  │   ├─ Image MCP (image analysis)
  │   ├─ QA MCP (QA analysis management)
  │   └─ Document MCP (PDF/DOCX/PPTX/MD)
  │
  └─ Code Interpreter (Python sandbox)
```

### MCP (Model Context Protocol)

Agents access external tools via MCP. The AgentCore Gateway hosts MCP servers, and each agent calls tools through SigV4-authenticated HTTP connections.

All MCP tool calls automatically inject `user_id` and `project_id`, ensuring data isolation between users.

### Session Management

IDP Agent and Voice Agent persist conversation history to S3.

```
s3://session-storage-bucket/
└── sessions/
    └── {user_id}/
        └── {project_id}/
            └── {session_id}/
```

---

## Agent Details

- [IDP Agent](/agent-idp) — Document search, analysis, artifact generation (DOCX/XLSX/PPTX/charts/diagrams)
- [Voice Agent](/agent-voice) — Real-time voice conversation with Nova Sonic
- [Web Crawler Agent](/agent-webcrawler) — Web crawling with AgentCore Browser, D2Snap HTML compression
