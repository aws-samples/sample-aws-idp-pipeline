---
title: "必要なIAM権限"
description: "IDP Pipelineのデプロイに必要な最小IAM権限"
---

## 概要

デプロイするIAMユーザーまたはロールには、複数のAWSサービスにわたるリソースの作成と管理の権限が必要です。以下はデプロイに必要な最小IAM権限です。

## 最小必要権限

### コアインフラ

| サービス | アクション | 用途 |
|---------|----------|------|
| CloudFormation | `cloudformation:*` | CDKスタックデプロイ |
| IAM | `iam:*` | Lambda、ECS、Step Functionsなどのロール/ポリシー作成 |
| SSM | `ssm:GetParameter`, `ssm:PutParameter`, `ssm:DeleteParameter` | スタック間リソース参照 |
| KMS | `kms:Create*`, `kms:Describe*`, `kms:Enable*`, `kms:List*`, `kms:Put*`, `kms:GenerateDataKey*`, `kms:Decrypt` | S3、DynamoDB、SQS暗号化 |
| CloudWatch | `cloudwatch:*`, `logs:*` | モニタリング、アラーム、ロググループ |

### ネットワーク

| サービス | アクション | 用途 |
|---------|----------|------|
| EC2 | `ec2:*` | VPC、サブネット、NATゲートウェイ、セキュリティグループ、VPCエンドポイント |
| ELB | `elasticloadbalancing:*` | バックエンド用Private ALB |

### コンピューティング

| サービス | アクション | 用途 |
|---------|----------|------|
| Lambda | `lambda:*` | すべてのLambda関数およびレイヤー |
| ECS | `ecs:*` | バックエンドFargateサービス |
| ECR | `ecr:*` | LambdaおよびECSコンテナイメージ |
| CodeBuild | `codebuild:*` | Rust Lambdaビルド（cargo-lambda） |
| Step Functions | `states:*` | ドキュメント分析ワークフロー |

### ストレージ

| サービス | アクション | 用途 |
|---------|----------|------|
| S3 | `s3:*`, `s3express:*` | ドキュメントストレージ、LanceDB、セッション、フロントエンドホスティング |
| DynamoDB | `dynamodb:*` | ワークフロー状態、バックエンドデータ |
| ElastiCache | `elasticache:*` | WebSocket接続用Redis |
| Neptune | `neptune-db:*`, `rds:*` | ナレッジグラフデータベース |

### AI / ML

| サービス | アクション | 用途 |
|---------|----------|------|
| Bedrock | `bedrock:*` | Claude、Nova Embed、Cohere Rerank、BDA |
| Bedrock AgentCore | `bedrock-agentcore:*` | IDP Agent、Voice Agent、WebCrawler Agent、MCP Gateway |
| SageMaker | `sagemaker:*` | PaddleOCR GPUエンドポイント |
| Transcribe | `transcribe:*` | 音声/動画の文字起こし |

### APIと認証

| サービス | アクション | 用途 |
|---------|----------|------|
| API Gateway | `apigateway:*`, `apigatewayv2:*` | REST、HTTP、WebSocket API |
| CloudFront | `cloudfront:*` | フロントエンドCDN |
| Cognito | `cognito-idp:*`, `cognito-identity:*` | ユーザー/IDプール |

### メッセージング

| サービス | アクション | 用途 |
|---------|----------|------|
| SQS | `sqs:*` | ワークフローキュー、LanceDBライター、グラフ削除 |
| SNS | `sns:*` | OCR完了通知 |
| EventBridge | `events:*` | S3アップロード検出、SFN障害キャッチ |

## サンプルIAMポリシー

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

> このポリシーはサービスレベルのワイルドカードを使用しています。本番環境では`Resource`を特定のARNに制限することを推奨します。

## Bedrockモデルアクセス

2025年9月より、Amazon Bedrockはすべてのサーバーレス基盤モデルへのアクセスを自動的に有効化します。Bedrockコンソールで手動でモデルを有効化する必要はなくなり、IAMポリシーとSCPでアクセスを制御します。

### 前提条件

- **サードパーティモデル**（Anthropic、Cohereなど）：IAMロールにAWS Marketplace権限（`aws-marketplace:Subscribe`、`aws-marketplace:Unsubscribe`、`aws-marketplace:ViewSubscriptions`）が必要です。初回呼び出し時にBedrockがバックグラウンドで自動サブスクリプションします（最大15分）。
- **Anthropicモデル**：初回呼び出し前にBedrockコンソールまたは`PutUseCaseForModelAccess` APIで**FTU（First Time Use）**フォームを1回提出する必要があります。

:::note
サードパーティモデルを初めて呼び出す際、自動サブスクリプションが完了するまで最大15分間`AccessDeniedException`（403）エラーが発生する場合があります。詳細は[FAQ](./faq#ai分析が応答なしで失敗またはmarketplaceサブスクリプションエラーが発生します)を参照してください。
:::

### 必要モデル

| モデル | モデルID | 用途 |
|-------|---------|------|
| Claude Sonnet 4.6 | `anthropic.claude-sonnet-4-6` | セグメント分析、ドキュメント要約、Webクローラー |
| Claude Haiku 4.5 | `anthropic.claude-haiku-4-5-20251001-v1:0` | 検索要約、説明、抽出 |
| Amazon Nova Embed | `amazon.nova-2-multimodal-embeddings-v1:0` | ベクトル埋め込み (1024d) |
| Amazon Nova Lite 2 | `amazon.nova-2-lite-v1:0` | 動画スクリプト抽出 |


### モデルアクセスの制限

特定モデルへのアクセスを拒否するにはIAMポリシーを使用します：

```json
{
  "Effect": "Deny",
  "Action": ["bedrock:*"],
  "Resource": ["arn:aws:bedrock:*::foundation-model/<model-id>"]
}
```

## Lambdaクォータ

アカウントによってはLambdaクォータが制限されており、デプロイまたは実行時に問題が発生する場合があります。Service Quotasダッシュボードで現在の値を確認してください。

| クォータ | デフォルト上限 | 必要値 | 備考 |
|---------|-------------|--------|------|
| Lambda関数メモリ | 10,240 MB（一部の新規アカウント: 3,008 MB） | 2,048 MB | Rust PaddleOCR Lambdaに必要。一部の新規アカウントは使用量に応じて自動増加、手動申請不可 |
| Lambda同時実行数 | リージョンあたり1,000（低く設定されている場合あり） | 1,000 | Service Quotasで増加リクエスト可能。反映まで最大1日 |

詳細は[FAQ](./faq#ocrスタックのデプロイが失敗しますlambdaメモリ制限)を参照してください。

## CDKブートストラップ

初回デプロイ前にCDKブートストラップが必要です：

```bash
npx cdk bootstrap aws://{ACCOUNT_ID}/{REGION}
```

CDKブートストラップはデプロイ時に使用するS3バケットとIAMロールを作成します。ブートストラップユーザーには追加で以下の権限が必要です：

- `cloudformation:CreateStack`
- `s3:CreateBucket`
- `iam:CreateRole`, `iam:AttachRolePolicy`
- `ecr:CreateRepository`
- `ssm:PutParameter`
