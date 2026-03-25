---
title: "FAQ"
description: "Frequently Asked Questions"
---

## Deployment

### Does deployment incur costs?

Yes, costs are incurred based on AWS resource usage. The main billable resources are:

| Resource | Description |
|----------|-------------|
| NAT Gateway | VPC external communication (hourly + data transfer) |
| ECS Fargate | FastAPI backend container (vCPU + memory) |
| ElastiCache Redis | WebSocket connection management |
| S3 / S3 Express One Zone | Document storage, vector DB, sessions, artifacts |
| SageMaker Endpoint | PaddleOCR (ml.g5.xlarge, scales up only when in use) |
| Bedrock | Per-invocation billing (input/output tokens) |
| Step Functions | Per-workflow execution state transition billing |
| DynamoDB | Read/write capacity units |

:::note
The SageMaker endpoint is configured with 0→1 auto-scaling by default, so instances scale down to 0 when not in use.
:::

### AI analysis fails silently or shows Marketplace subscription errors

You may experience the following symptoms:
- AI chat returns no response, or document analysis workflow fails
- Logs show `AccessDeniedException` or Marketplace subscription-related errors

Since September 2025, Bedrock automatically enables all serverless models via IAM — no manual console activation is needed. However, on the **first invocation** of a third-party model (Anthropic, Cohere, etc.), Bedrock initiates an AWS Marketplace subscription in the background. During this process (up to 15 minutes), calls may fail. Once the subscription completes, everything works normally.

**Things to check:**
- Ensure the deploying IAM role has `aws-marketplace:Subscribe`, `aws-marketplace:Unsubscribe`, and `aws-marketplace:ViewSubscriptions` permissions
- For Anthropic models, a one-time **FTU (First Time Use)** form must be submitted via the Bedrock console or `PutUseCaseForModelAccess` API

### OCR stack deployment fails (Lambda memory limit)

The Rust PaddleOCR Lambda requires 2,048MB of memory. Lambda memory can normally be configured up to 10,240MB, but some new or free-tier accounts have a default quota of 3,008MB. In most cases this should not be an issue, but if your account quota is unusually low, deployment may fail. This quota cannot be manually requested — it increases automatically based on account usage.

:::note
Check your current memory quota in the Service Quotas dashboard.
:::

### Lambda concurrency errors during workflow execution

The default Lambda concurrent execution limit is 1,000 per region, but some accounts may have a lower quota. Processing multiple documents simultaneously or running parallel segment analysis can exceed this limit.

**Action:** Check your current quota in the Service Quotas dashboard and request an increase if it is low. It may take up to one day for the increase to take effect.

### Bedrock quota limits during large document analysis

When analyzing documents with many pages, you may hit Bedrock service quotas (requests per minute, tokens per minute, etc.), causing analysis to fail or slow down. Start by testing with small documents first, then request a Bedrock quota increase via the Service Quotas dashboard if needed.

### Neptune Serverless deployment fails (free-tier account)

Neptune Serverless is not available on AWS free-tier accounts. A non-free-tier account is required to use the knowledge graph feature.

### Deployment failed. What should I do?

Refer to the [Quick Deploy Guide - Troubleshooting](./deployment.md#troubleshooting) section. You can check the failure cause through CodeBuild logs.

```bash
aws logs tail /aws/codebuild/sample-aws-idp-pipeline-deploy --since 10m
```

---

## Infrastructure

### How do I keep the SageMaker endpoint always running?

The default setting is auto-scaling 0→1, where instances scale down to 0 after 10 minutes of inactivity. To keep it always running, change the minimum instance count.

**Change via AWS Console:**

1. Go to **SageMaker Console** > **Inference** > **Endpoints** and select the endpoint
2. In the **Endpoint runtime settings** tab, select the variant and click **Update scaling policy**
3. Change **Minimum instance count** to `1`

:::danger
Keeping an ml.g5.xlarge instance always running will incur continuous hourly costs.
:::

### How do I change the AI models used for analysis?

Workflow analysis models are managed in `packages/infra/src/models.json`.

```json
{
  "analysis": "global.anthropic.claude-sonnet-4-6",
  "summarizer": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "embedding": "amazon.nova-2-multimodal-embeddings-v1:0",
  "videoAnalysis": "us.twelvelabs.pegasus-1-2-v1:0"
}
```

| Key | Purpose | Lambda Environment Variable |
|-----|---------|---------------------------|
| `analysis` | Segment analysis, Q&A regeneration | `BEDROCK_MODEL_ID` |
| `summarizer` | Document summarization | `SUMMARIZER_MODEL_ID` |
| `embedding` | Vector embedding | `EMBEDDING_MODEL_ID` |
| `videoAnalysis` | Video analysis | `BEDROCK_VIDEO_MODEL_ID` |

**Method 1: Edit models.json and redeploy (Recommended)**

```bash
# After editing models.json
pnpm nx deploy @idp-v2/infra
```

**Method 2: Directly modify Lambda environment variables**

To change immediately without redeployment, modify environment variables in the Lambda Console.

1. Go to **Lambda Console** > Select the function (e.g., `IDP-V2-*-SegmentAnalyzer`)
2. **Configuration** > **Environment variables** > **Edit**
3. Modify the environment variable value and click **Save**

:::danger
Directly modifying Lambda environment variables will be overwritten by models.json values on the next CDK deployment.
:::

---

## Document Processing

### What file formats are supported?

Documents (PDF, DOC, TXT), images (PNG, JPG, GIF, TIFF), videos (MP4, MOV, AVI), and audio files (MP3, WAV, FLAC) up to 500MB are supported.

| File Type | Supported Formats | Preprocessing |
|-----------|-------------------|---------------|
| Document | PDF, DOC, TXT | PaddleOCR + BDA (optional) + PDF text extraction |
| Image | PNG, JPG, GIF, TIFF | PaddleOCR + BDA (optional) |
| Video | MP4, MOV, AVI | AWS Transcribe + BDA (optional) |
| Audio | MP3, WAV, FLAC | AWS Transcribe |

### Can it handle large documents (thousands of pages)?

Yes. Large documents are supported through segment-based processing with Step Functions + DynamoDB. Documents up to 3,000 pages have been tested. However, processing time and Bedrock invocation costs increase significantly with page count, so we recommend starting with smaller documents and scaling up gradually.

### What OCR engines are used? What are the differences?

| OCR Engine | Description |
|------------|-------------|
| **PaddleOCR** | Open-source OCR running on Lambda (Rust, MNN inference) or SageMaker (GPU). Supports 80+ languages. Optimized for text extraction |
| **Bedrock Data Automation (BDA)** | AWS managed service. Analyzes document structure (tables, forms, etc.) together. Selectable in project settings |

> For details, see [PaddleOCR on SageMaker](./ocr.md).

### How are video/audio files analyzed?

1. **AWS Transcribe** converts speech to text
2. For videos, **TwelveLabs Pegasus 1.2** analyzes visual content
3. Transcription + visual analysis results are combined to generate segments
4. The ReAct Agent performs deep analysis on each segment

---

## AI Analysis

### What if the analysis results are inaccurate?

You can correct results at multiple levels:

- **Q&A Regeneration**: Regenerate Q&A for specific segments with custom instructions
- **Q&A Add/Delete**: Manually add or delete individual Q&A items
- **Full Reanalysis**: Reanalyze the entire document with new instructions

### Can I customize the document analysis prompt?

Yes. You can modify the document analysis prompt in the project settings. This prompt is used by the ReAct Agent when analyzing segments. Customizing it for your project's domain or analysis purpose will yield more accurate results.

### What AI models are used?

| Model | Purpose |
|-------|---------|
| **Claude Sonnet 4.6** | Segment analysis (Vision ReAct Agent), AI chat |
| **Claude Haiku 4.5** | Document summarization |
| **Amazon Nova Embed Text v1** | Vector embedding (1024d) |
| **TwelveLabs Pegasus 1.2** | Video analysis |
| **Cohere Rerank v3.5** | Search result reranking |

---

## AI Chat

### Does the chat answer based on document content?

Yes. The AI Agent automatically searches documents uploaded to the project through MCP tools. It performs hybrid search combining vector search and full-text search (FTS), reranks results with Cohere Rerank, and generates answers based on the most relevant content.

### What are custom agents?

You can create customized agents with project-specific system prompts. For example, you can create agents dedicated to legal document analysis, technical document summarization, etc. You can also switch between agents during a conversation.

### What tools can the agent use?

| Tool | Description |
|------|-------------|
| search_documents | Hybrid search across project documents |
| save/load/edit_markdown | Create and edit markdown files |
| create_pdf, extract_pdf_text/tables | PDF creation and text/table extraction |
| create_docx, extract_docx_text/tables | Word document creation and text/table extraction |
| generate_image | AI image generation |
| code_interpreter | Python code execution |

### Can I attach images or documents to the chat?

Yes. You can attach images or documents to the chat input for multimodal input. The AI Agent will analyze the attached file content and respond accordingly.

---

## Security

### How is authentication handled?

Amazon Cognito OIDC authentication is used. When you log in through Cognito on the frontend, a JWT token is issued and automatically included in backend API calls. MCP tool invocations use IAM SigV4 authentication.

### Where is data stored?

| Data | Storage |
|------|---------|
| Original files, segment images | Amazon S3 |
| Vector embeddings, search indices | LanceDB (S3 Express One Zone) |
| Project/workflow metadata | Amazon DynamoDB |
| Chat sessions, agent prompts, artifacts | Amazon S3 |
| WebSocket connection info | Amazon ElastiCache Redis |

### Can I directly access LanceDB data?

LanceDB is stored on S3 Express One Zone, making direct access difficult. You can query it via Lambda from CloudShell.

**List tables**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "list_tables", "params": {}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**Count records for a specific project**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "count", "params": {"project_id": "YOUR_PROJECT_ID"}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**Query segments for a specific workflow**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "get_segments_by_document_id", "params": {"project_id": "YOUR_PROJECT_ID", "document_id": "YOUR_DOCUMENT_ID"}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**Search (hybrid: vector + keyword)**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "search", "params": {"project_id": "YOUR_PROJECT_ID", "query": "search query", "limit": 5}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```
