---
title: "필요 IAM 권한"
description: "IDP Pipeline 배포에 필요한 최소 IAM 권한"
---

## 개요

배포하는 IAM 사용자 또는 역할은 여러 AWS 서비스의 리소스를 생성하고 관리할 수 있는 권한이 필요합니다. 아래는 배포에 필요한 최소 IAM 권한입니다.

## 최소 필요 권한

### 핵심 인프라

| 서비스 | 액션 | 용도 |
|--------|------|------|
| CloudFormation | `cloudformation:*` | CDK 스택 배포 |
| IAM | `iam:*` | Lambda, ECS, Step Functions 등의 역할/정책 생성 |
| SSM | `ssm:GetParameter`, `ssm:PutParameter`, `ssm:DeleteParameter` | 스택 간 리소스 참조 |
| KMS | `kms:Create*`, `kms:Describe*`, `kms:Enable*`, `kms:List*`, `kms:Put*`, `kms:GenerateDataKey*`, `kms:Decrypt` | S3, DynamoDB, SQS 암호화 |
| CloudWatch | `cloudwatch:*`, `logs:*` | 모니터링, 알람, 로그 그룹 |

### 네트워크

| 서비스 | 액션 | 용도 |
|--------|------|------|
| EC2 | `ec2:*` | VPC, 서브넷, NAT 게이트웨이, 보안 그룹, VPC 엔드포인트 |
| ELB | `elasticloadbalancing:*` | 백엔드용 Private ALB |

### 컴퓨팅

| 서비스 | 액션 | 용도 |
|--------|------|------|
| Lambda | `lambda:*` | 모든 Lambda 함수 및 레이어 |
| ECS | `ecs:*` | 백엔드 Fargate 서비스 |
| ECR | `ecr:*` | Lambda 및 ECS 컨테이너 이미지 |
| CodeBuild | `codebuild:*` | OCR 컨테이너 이미지 빌드 |
| Step Functions | `states:*` | 문서 분석 워크플로우 |

### 스토리지

| 서비스 | 액션 | 용도 |
|--------|------|------|
| S3 | `s3:*`, `s3express:*` | 문서 저장소, LanceDB, 세션, 프론트엔드 호스팅 |
| DynamoDB | `dynamodb:*` | 워크플로우 상태, 백엔드 데이터 |
| ElastiCache | `elasticache:*` | WebSocket 연결용 Redis |
| Neptune | `neptune-db:*`, `rds:*` | 지식 그래프 데이터베이스 |

### AI / ML

| 서비스 | 액션 | 용도 |
|--------|------|------|
| Bedrock | `bedrock:*` | Claude, Nova Embed, Cohere Rerank, BDA |
| Bedrock AgentCore | `bedrock-agentcore:*` | IDP Agent, Voice Agent, WebCrawler Agent, MCP Gateway |
| SageMaker | `sagemaker:*` | PaddleOCR GPU 엔드포인트 |
| Transcribe | `transcribe:*` | 오디오/비디오 음성 인식 |

### API 및 인증

| 서비스 | 액션 | 용도 |
|--------|------|------|
| API Gateway | `apigateway:*`, `apigatewayv2:*` | REST, HTTP, WebSocket API |
| CloudFront | `cloudfront:*` | 프론트엔드 CDN |
| Cognito | `cognito-idp:*`, `cognito-identity:*` | 사용자/자격 증명 풀 |

### 메시징

| 서비스 | 액션 | 용도 |
|--------|------|------|
| SQS | `sqs:*` | 워크플로우 큐, LanceDB 라이터, 그래프 삭제 |
| SNS | `sns:*` | OCR 완료 알림 |
| EventBridge | `events:*` | S3 업로드 감지, SFN 실패 캐치 |

## 샘플 IAM 정책

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

> 이 정책은 서비스 수준 와일드카드를 사용합니다. 프로덕션 환경에서는 `Resource`를 특정 ARN으로 제한하는 것을 권장합니다.

## Bedrock 모델 액세스

2025년 9월부터 Amazon Bedrock은 모든 서버리스 파운데이션 모델에 대한 액세스를 자동으로 활성화합니다. 더 이상 Bedrock 콘솔에서 수동으로 모델을 활성화할 필요가 없으며, IAM 정책과 SCP로 액세스를 제어합니다.

### 사전 요구 사항

- **서드파티 모델** (Anthropic, Cohere 등): IAM 역할에 AWS Marketplace 권한(`aws-marketplace:Subscribe`, `aws-marketplace:Unsubscribe`, `aws-marketplace:ViewSubscriptions`)이 필요합니다. 첫 호출 시 Bedrock이 백그라운드에서 자동 구독합니다 (최대 15분 소요).
- **Anthropic 모델**: 첫 호출 전 Bedrock 콘솔 또는 `PutUseCaseForModelAccess` API를 통해 **FTU(First Time Use)** 양식을 1회 제출해야 합니다.

:::note
서드파티 모델을 처음 호출할 때 자동 구독이 완료될 때까지 최대 15분간 `AccessDeniedException` (403) 에러가 발생할 수 있습니다. 자세한 내용은 [FAQ](./faq#ai-분석이-응답-없이-실패하거나-marketplace-구독-권한-오류가-발생합니다)를 참고하세요.
:::

### 필요 모델

| 모델 | 모델 ID | 용도 |
|------|---------|------|
| Claude Sonnet 4.6 | `anthropic.claude-sonnet-4-6` | 세그먼트 분석, 문서 요약, 웹 크롤러 |
| Claude Haiku 4.5 | `anthropic.claude-haiku-4-5-20251001-v1:0` | 검색 요약, 설명, 추출 |
| Amazon Nova Embed | `amazon.nova-2-multimodal-embeddings-v1:0` | 벡터 임베딩 (1024d) |
| Amazon Nova Lite 2 | `amazon.nova-2-lite-v1:0` | 비디오 스크립트 추출 |


### 모델 액세스 제한

특정 모델에 대한 액세스를 거부하려면 IAM 정책을 사용합니다:

```json
{
  "Effect": "Deny",
  "Action": ["bedrock:*"],
  "Resource": ["arn:aws:bedrock:*::foundation-model/<model-id>"]
}
```

## Lambda 할당량

계정에 따라 Lambda 할당량이 제한되어 있어 배포 또는 실행 시 문제가 발생할 수 있습니다. Service Quotas 대시보드에서 현재 값을 확인하세요.

| 할당량 | 기본 한도 | 필요값 | 비고 |
|--------|----------|--------|------|
| Lambda 함수 메모리 | 10,240 MB (일부 신규 계정: 3,008 MB) | 5,120 MB | OCR Lambda에 필요. 일부 신규 계정은 사용량에 따라 자동 증가, 수동 요청 불가 |
| Lambda 동시 실행 수 | 리전당 1,000 (낮게 설정된 경우 있음) | 1,000 | Service Quotas에서 증가 요청 가능. 반영까지 최대 하루 소요 |

자세한 내용은 [FAQ](./faq#ocr-스택-배포가-실패합니다-lambda-메모리-제한)를 참고하세요.

## CDK 부트스트랩

최초 배포 전 CDK 부트스트랩이 필요합니다:

```bash
npx cdk bootstrap aws://{ACCOUNT_ID}/{REGION}
```

CDK 부트스트랩은 배포 시 사용되는 S3 버킷과 IAM 역할을 생성합니다. 부트스트랩 사용자는 추가로 다음 권한이 필요합니다:

- `cloudformation:CreateStack`
- `s3:CreateBucket`
- `iam:CreateRole`, `iam:AttachRolePolicy`
- `ecr:CreateRepository`
- `ssm:PutParameter`
