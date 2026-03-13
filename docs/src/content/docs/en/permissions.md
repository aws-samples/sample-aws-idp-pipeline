---
title: "Required IAM Permissions"
description: "Minimum IAM permissions required to deploy the IDP Pipeline"
---

## Overview

The deploying IAM user or role requires permissions to create and manage resources across multiple AWS services. Below is the minimum set of IAM permissions required for deployment.

## Minimum Required Permissions

### Core Infrastructure

| Service | Actions | Used By |
|---------|---------|---------|
| CloudFormation | `cloudformation:*` | CDK stack deployment |
| IAM | `iam:*` | Create roles/policies for Lambda, ECS, Step Functions |
| SSM | `ssm:GetParameter`, `ssm:PutParameter`, `ssm:DeleteParameter` | Cross-stack resource discovery |
| KMS | `kms:Create*`, `kms:Describe*`, `kms:Enable*`, `kms:List*`, `kms:Put*`, `kms:GenerateDataKey*`, `kms:Decrypt` | Encryption for S3, DynamoDB, SQS |
| CloudWatch | `cloudwatch:*`, `logs:*` | Monitoring, alarms, log groups |

### Networking

| Service | Actions | Used By |
|---------|---------|---------|
| EC2 | `ec2:*` | VPC, subnets, NAT gateway, security groups, VPC endpoints |
| ELB | `elasticloadbalancing:*` | Private ALB for backend |

### Compute

| Service | Actions | Used By |
|---------|---------|---------|
| Lambda | `lambda:*` | All Lambda functions and layers |
| ECS | `ecs:*` | Backend Fargate service |
| ECR | `ecr:*` | Container images for Lambda and ECS |
| CodeBuild | `codebuild:*` | OCR container image build |
| Step Functions | `states:*` | Document analysis workflow |

### Storage

| Service | Actions | Used By |
|---------|---------|---------|
| S3 | `s3:*`, `s3express:*` | Document storage, LanceDB, sessions, frontend hosting |
| DynamoDB | `dynamodb:*` | Workflow state, backend data |
| ElastiCache | `elasticache:*` | Redis for WebSocket connections |
| Neptune | `neptune-db:*`, `rds:*` | Knowledge graph database |

### AI / ML

| Service | Actions | Used By |
|---------|---------|---------|
| Bedrock | `bedrock:*` | Claude, Nova Embed, Cohere Rerank, BDA |
| Bedrock AgentCore | `bedrock-agentcore:*` | IDP Agent, Voice Agent, WebCrawler Agent, MCP Gateway |
| SageMaker | `sagemaker:*` | PaddleOCR GPU endpoint |
| Transcribe | `transcribe:*` | Audio/video transcription |

### API & Auth

| Service | Actions | Used By |
|---------|---------|---------|
| API Gateway | `apigateway:*`, `apigatewayv2:*` | REST, HTTP, WebSocket APIs |
| CloudFront | `cloudfront:*` | Frontend CDN |
| Cognito | `cognito-idp:*`, `cognito-identity:*` | User/Identity pools |

### Messaging

| Service | Actions | Used By |
|---------|---------|---------|
| SQS | `sqs:*` | Workflow queue, LanceDB writer, graph deletion |
| SNS | `sns:*` | OCR completion notifications |
| EventBridge | `events:*` | S3 upload detection, SFN failure catching |

## Sample IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "iam:*",
        "ssm:*",
        "kms:*",
        "cloudwatch:*",
        "logs:*",
        "ec2:*",
        "elasticloadbalancing:*",
        "lambda:*",
        "ecs:*",
        "ecr:*",
        "codebuild:*",
        "states:*",
        "s3:*",
        "s3express:*",
        "dynamodb:*",
        "elasticache:*",
        "neptune-db:*",
        "rds:*",
        "bedrock:*",
        "bedrock-agentcore:*",
        "sagemaker:*",
        "transcribe:*",
        "apigateway:*",
        "apigatewayv2:*",
        "cloudfront:*",
        "cognito-idp:*",
        "cognito-identity:*",
        "sqs:*",
        "sns:*",
        "events:*",
        "sts:*",
        "application-autoscaling:*",
        "aws-marketplace:Subscribe",
        "aws-marketplace:Unsubscribe",
        "aws-marketplace:ViewSubscriptions"
      ],
      "Resource": "*"
    }
  ]
}
```

> This policy uses service-level wildcards. For production environments, consider restricting `Resource` to specific ARNs.

## Bedrock Model Access

Since September 2025, Amazon Bedrock automatically enables access to all serverless foundation models. You no longer need to manually enable models in the Bedrock console. Access is controlled via IAM policies and SCPs.

### Prerequisites

- **Third-party models** (Anthropic, Cohere, etc.): The IAM role must have AWS Marketplace permissions (`aws-marketplace:Subscribe`, `aws-marketplace:Unsubscribe`, `aws-marketplace:ViewSubscriptions`). On first invocation, Bedrock auto-subscribes in the background (up to 15 minutes).
- **Anthropic models**: Require a one-time **First Time Use (FTU)** form submission (use case details) via the Bedrock console or `PutUseCaseForModelAccess` API before first invocation.

:::note
On the first invocation of a third-party model, you may see `AccessDeniedException` (403) errors for up to 15 minutes while the auto-subscription completes. See [FAQ](./faq#ai-analysis-fails-silently-or-shows-marketplace-subscription-errors) for details.
:::

### Required Models

| Model | Model ID | Purpose |
|-------|----------|---------|
| Claude Sonnet 4.6 | `anthropic.claude-sonnet-4-6` | Segment analysis, document summarization, web crawler |
| Claude Haiku 4.5 | `anthropic.claude-haiku-4-5-20251001-v1:0` | Search summarization, description, extraction |
| Amazon Nova Embed | `amazon.nova-2-multimodal-embeddings-v1:0` | Vector embeddings (1024d) |
| Amazon Nova Lite 2 | `amazon.nova-2-lite-v1:0` | Video script extraction |


### Restricting Model Access

To deny access to a specific model, use an IAM policy:

```json
{
  "Effect": "Deny",
  "Action": ["bedrock:*"],
  "Resource": ["arn:aws:bedrock:*::foundation-model/<model-id>"]
}
```

## Lambda Quotas

Lambda quotas may be limited depending on your account, causing deployment or runtime failures. Check current values in the Service Quotas dashboard.

| Quota | Default Limit | Required | Note |
|-------|--------------|----------|------|
| Lambda function memory | 10,240 MB (some new accounts: 3,008 MB) | 5,120 MB | Required for OCR Lambda. Some new accounts auto-increase with usage, cannot be manually requested |
| Lambda concurrent executions | 1,000 per region (may be lower) | 1,000 | Can request increase via Service Quotas. May take up to one day to take effect |

See [FAQ](./faq#ocr-stack-deployment-fails-lambda-memory-limit) for details.

## CDK Bootstrap

Before first deployment, CDK bootstrap is required:

```bash
npx cdk bootstrap aws://{ACCOUNT_ID}/{REGION}
```

CDK bootstrap creates an S3 bucket and IAM roles used during deployment. The bootstrapping user additionally needs:

- `cloudformation:CreateStack`
- `s3:CreateBucket`
- `iam:CreateRole`, `iam:AttachRolePolicy`
- `ecr:CreateRepository`
- `ssm:PutParameter`
