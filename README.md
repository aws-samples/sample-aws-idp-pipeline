<p align="center">
  <img src="docs/assets/logo.png" alt="AWS IDP Logo" width="120">
</p>
<h1 align="center">Sample AWS IDP Pipeline</h1>

<p align="center">
  <strong>AI-powered Intelligent Document Processing (IDP) Prototype for Unstructured Data</strong>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/License-Amazon_Software_License-green.svg" alt="License">
  <img src="https://img.shields.io/badge/AWS_CDK-2.230.x-FF9900?logo=amazonaws" alt="AWS CDK">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Nx-22.x-143055?logo=nx&logoColor=white" alt="Nx">
  <img src="https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-0.123+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/AWS-Bedrock-FF9900?logo=amazon&logoColor=white" alt="Amazon Bedrock">
  <img src="https://img.shields.io/badge/AWS-Bedrock_Agent_Core-FF9900?logo=amazon&logoColor=white" alt="Bedrock Agent Core">
  <img src="https://img.shields.io/badge/Strands_Agents-1.23.x-FF9900?logo=amazon&logoColor=white" alt="Strands Agents">
</p>

<p align="center">
  <strong>English</strong> | <a href="docs/readme/README_ko.md">한국어</a> | <a href="docs/readme/README_ja.md">日本語</a>
</p>

<p align="center">
  <a href="#features">Features</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#getting-started">Getting Started</a> |
  <a href="#deployment">Deployment</a> |
  <a href="#supported-models">Models</a>
</p>

---

## Overview

An AI-powered IDP prototype that transforms unstructured data into actionable insights. Analyzes **documents, videos, audio files, and images** with hybrid search (vector + keyword) and a conversational AI interface. Built as an Nx monorepo with AWS CDK, featuring real-time workflow status notifications.

> [!CAUTION]
> This is a development version. Do not deploy to production.

> [!NOTE]
> This is an AWS sample project designed for experimentation, evaluation, and development purposes.

<p align="center">
  <img src="docs/assets/main-screen.png" alt="Main Screen" width="900">
</p>

## Features

- **Intelligent Document Processing (IDP)**
  - Document analysis with Bedrock Data Automation (BDA)
  - [OCR processing with PaddleOCR on SageMaker](docs/ocr/OCR_en.md)
  - Audio/video transcription via AWS Transcribe
  - Automatic file type detection and preprocessing pipeline routing

- **[AI-Powered Analysis](docs/analysis/ANALYSIS_en.md)**
  - Per-segment deep analysis with Claude Sonnet 4.5 Vision ReAct Agent
  - Document summarization with Claude Haiku 4.5
  - 1024-dimensional vector embeddings with Nova Embed

- **[Hybrid Search](docs/vectordb/VECTORDB_en.md)**
  - LanceDB vector search + Full-Text Search (FTS)
  - Kiwi Korean morphological analyzer for keyword extraction
  - Result reranking with Bedrock Cohere Rerank v3.5

- **AI Chat (Agent Core)**
  - IDP Agent / Research Agent on Bedrock Agent Core
  - Tool invocation via MCP Gateway (search, artifact management)
  - S3-based session management for conversation continuity

- **Real-time Notifications**
  - Real-time status updates via WebSocket API + ElastiCache Redis
  - Workflow event detection through DynamoDB Streams
  - Live updates for step progress, artifact changes, and session state

## Architecture

![Architecture](docs/assets/architecture.png)

### CDK Stack Structure

```
@idp-v2/infra
├── VpcStack              - VPC (10.0.0.0/16, 2 AZ, NAT Gateway)
├── StorageStack          - S3 buckets, DynamoDB tables, ElastiCache Redis
├── EventStack            - S3 EventBridge, SQS queues, file type detection Lambda
├── BdaStack              - Bedrock Data Automation consumer
├── OcrStack              - PaddleOCR SageMaker async endpoint
├── TranscribeStack       - AWS Transcribe consumer
├── WorkflowStack         - Step Functions workflow (Distributed Map)
├── WebsocketStack        - WebSocket API, real-time notifications
├── WorkerStack           - WebSocket message processing
├── McpStack              - MCP Gateway (search, artifact tools)
├── AgentStack            - Bedrock Agent Core (IDP Agent, Research Agent)
└── ApplicationStack      - Backend (ECS Fargate), Frontend (CloudFront), Cognito
```

### Core Workflows

#### 1. Document Upload & Analysis Pipeline

When a user uploads a document to S3 via Presigned URL, EventBridge detects the ObjectCreated event. The Type Detection Lambda identifies the file type and routes it to SQS. OCR (PaddleOCR/SageMaker) and Transcribe run automatically, while BDA runs optionally. After preprocessing completes, the Step Functions workflow performs segmentation, AI analysis, vector embedding, and document summarization sequentially.

```
S3 Upload (Presigned URL)
  → EventBridge (ObjectCreated)
    → Type Detection Lambda
      ├─ OCR Queue     → PaddleOCR (SageMaker)    ── automatic
      ├─ BDA Queue     → Bedrock Data Automation   ── optional
      └─ Transcribe Queue → AWS Transcribe          ── automatic

  → Step Functions Workflow
      Segment Prep ─→ Wait for Preprocess ─→ Build Segments
        ─→ Distributed Map (max 30)
            ├─ Segment Analyzer (Claude Sonnet 4.5 Vision)
            └─ Analysis Finalizer → SQS → LanceDB Writer
        ─→ Document Summarizer (Claude Haiku 4.5)
            → Vector Embedding (Nova 1024d) → LanceDB
```

#### 2. Real-time Notifications (WebSocket)

When workflow progress is recorded in DynamoDB, DynamoDB Streams detects the changes. The WorkflowStream Lambda inside the VPC looks up active connections in Redis, then pushes events through the WebSocket API so the frontend reflects status in real time.

```
DynamoDB Streams (state change detection)
  → WorkflowStream Lambda (VPC)
    → Redis (connection lookup)
      → WebSocket API → Frontend
        ├─ Step progress
        ├─ Artifact changes
        └─ Session state updates
```

#### 3. AI Chat (Agent Core)

User queries are routed through API Gateway to Bedrock Agent Core. The IDP Agent and Research Agent invoke tools via MCP Gateway, performing hybrid search with the Search Tool and managing outputs with the Artifact Tool. Session history is persisted to S3 to maintain conversation context.

```
User Query
  → API Gateway REST (SigV4)
    → Bedrock Agent Core Runtime
      ├─ IDP Agent (Claude Sonnet 4.5)
      └─ Research Agent
          → MCP Gateway
            ├─ Search Tool Lambda → Backend API → Hybrid Search (Vector + FTS + Rerank)
            └─ Artifact Tool Lambda → S3
          → S3 (Session Load/Save)
```

#### 4. Backend API (HTTP)

API Gateway HTTP (IAM Auth) connects through VPC Link to a Private ALB, then to ECS Fargate running FastAPI. It handles all data access including project/document management, workflow queries, hybrid search, chat sessions, custom agents, and artifact management.

```
API Gateway HTTP (IAM Auth)
  → VPC Link → Private ALB → ECS Fargate (FastAPI)
    ├─ DynamoDB     ── Project/document CRUD, workflow status
    ├─ LanceDB      ── Hybrid search (Vector + FTS)
    ├─ Bedrock      ── Cohere Rerank v3.5
    ├─ S3           ── Presigned URL, sessions (DuckDB), agents
    ├─ Redis        ── Query cache
    ├─ Step Functions ── Reanalysis trigger
    └─ Lambda       ── QA Regenerator
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Step Functions payload → DynamoDB intermediate storage | Bypass Step Functions 256KB payload limit |
| Only segment indices passed in workflow | Support for 3000+ page documents |
| LanceDB + S3 Express One Zone | Low-latency storage optimized for vector search |
| SageMaker Auto-scaling 0→1 | Cost optimization (Scale-to-zero when idle) |
| ElastiCache Redis | WebSocket connection state management (faster than DynamoDB TTL) |
| DuckDB for direct S3 queries | Query session/agent data without copying |
| VPC Link + Private ALB | Keep backend unexposed to the internet |
| Distributed Map (max 30 concurrency) | Balance between parallelism and Lambda concurrency limits |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v8+
- [Python](https://www.python.org/) 3.12
- [AWS CLI](https://aws.amazon.com/cli/) (credentials configured)
- [AWS CDK](https://aws.amazon.com/cdk/) v2
- [mise](https://mise.jdx.dev/) (task management)

### Installation

```bash
# Clone the repository
git clone https://github.com/aws-samples/sample-aws-idp-pipeline.git
cd sample-aws-idp-pipeline

# Install dependencies
pnpm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local to configure your AWS profile and region
```

### Local Development

```bash
# Frontend dev server
pnpm nx serve @idp-v2/frontend

# Run agent locally
pnpm nx serve idp_v2.idp_agent
```

## Deployment

> **Quick Deploy**: Deploy the entire pipeline with a single script using CloudShell + CodeBuild. See [Quick Deploy Guide](docs/deployment/DEPLOYMENT_en.md).

### Deploy with mise (Recommended)

```bash
# Install mise (macOS)
brew install mise

# Deploy with stack selection (via fzf)
mise run deploy

# Build all
pnpm build:all
```

### Direct CDK Deployment

```bash
# CDK bootstrap (first time only)
pnpm nx synth @idp-v2/infra

# Deploy all stacks
pnpm nx deploy @idp-v2/infra

# Hotswap deploy (dev)
pnpm nx deploy @idp-v2/infra --hotswap

# Destroy resources
pnpm nx destroy @idp-v2/infra
```

### Common Commands

```bash
# Build
pnpm build:all                              # Build all packages
pnpm nx build @idp-v2/infra                 # Build single package

# Test
pnpm nx test @idp-v2/infra                  # Run tests
pnpm nx test @idp-v2/infra --update         # Update snapshots

# Lint
pnpm nx lint @idp-v2/infra                  # Lint
pnpm nx lint @idp-v2/infra --configuration=fix  # Auto-fix
```

## Supported Models

### AI Analysis Models

| Model | Purpose | Description |
|-------|---------|-------------|
| Claude Sonnet 4.5 | Segment analysis / Agent | Vision ReAct Agent, deep document analysis |
| Claude Haiku 4.5 | Document summarization | Lightweight model, fast summary generation |
| Nova Embed Text v1 | Vector embeddings | 1024-dimensional text embeddings |
| Cohere Rerank v3.5 | Search reranking | Hybrid search result optimization |

### Preprocessing Models

| Model | Purpose | Description |
|-------|---------|-------------|
| PaddleOCR | OCR | SageMaker g5.xlarge, Auto-scaling 0→1 |
| Bedrock Data Automation | Document analysis | Async document structure analysis (optional) |
| AWS Transcribe | Speech-to-text | Audio/video text conversion |

## Project Structure

```
sample-aws-idp-pipeline/
├── packages/
│   ├── agents/                    # AI agents
│   │   ├── idp-agent/             # IDP Agent (Strands SDK)
│   │   └── research-agent/        # Research Agent
│   ├── backend/app/               # FastAPI backend
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── ddb/                   # DynamoDB modules
│   │   ├── routers/               # API routers
│   │   └── services/              # Business logic
│   ├── common/constructs/src/     # Reusable CDK constructs
│   ├── frontend/src/              # React SPA
│   │   ├── routes/                # Page routes
│   │   └── components/            # React components
│   └── infra/src/
│       ├── stacks/                # 12 CDK stacks
│       ├── functions/             # Python Lambda functions
│       │   ├── step-functions/    # Workflow functions
│       │   ├── shared/            # Shared modules
│       │   ├── websocket/         # WebSocket handlers
│       │   └── lancedb-writer/    # LanceDB writer
│       └── lambda-layers/         # Lambda layers
├── docs/                          # Documentation
└── README.md
```

## Tech Stack

### Infrastructure (TypeScript)
- AWS CDK 2.230.x + Nx 22.x
- AWS Step Functions (workflow orchestration)
- AWS Lambda + Lambda Layers
- API Gateway HTTP / REST / WebSocket

### Backend (Python)
- FastAPI (ECS Fargate, ARM64)
- LanceDB + S3 Express One Zone (vector storage)
- DynamoDB (One Table Design)
- Kiwi (Korean morphological analyzer)
- DuckDB (direct S3 queries)

### Frontend (TypeScript)
- React 19 + TanStack Router
- Tailwind CSS
- AWS SDK (S3 upload)
- Cognito OIDC authentication
- WebSocket client

### AI / ML
- Bedrock Agent Core (Strands SDK, ReAct pattern)
- Bedrock Claude Sonnet 4.5 / Haiku 4.5
- Bedrock Nova Embed (1024 dimensions)
- Bedrock Cohere Rerank v3.5
- PaddleOCR (SageMaker)
- AWS Transcribe

---

## License

This project is licensed under the [Amazon Software License](LICENSE).
