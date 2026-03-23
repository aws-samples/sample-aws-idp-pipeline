---
title: "FAQ"
description: "よくある質問"
---

## デプロイ

### デプロイに費用はかかりますか？

はい、AWSリソースの使用に応じて費用が発生します。主な課金リソースは以下の通りです。

| リソース | 説明 |
|----------|------|
| NAT Gateway | VPC外部通信（時間あたり + データ転送） |
| ECS Fargate | FastAPIバックエンドコンテナ（vCPU + メモリ） |
| ElastiCache Redis | WebSocket接続管理 |
| S3 / S3 Express One Zone | ドキュメント保存、ベクトルDB、セッション、アーティファクト |
| SageMaker Endpoint | PaddleOCR（ml.g5.xlarge、使用時のみスケールアップ） |
| Bedrock | モデル呼び出し件あたり課金（入出力トークン） |
| Step Functions | ワークフロー実行件あたり状態遷移課金 |
| DynamoDB | 読み取り/書き込み容量ユニット |

:::note
SageMakerエンドポイントはデフォルトで0→1オートスケーリングが設定されており、未使用時にはインスタンスが0に縮小されます。
:::

### AI分析が応答なしで失敗、またはMarketplaceサブスクリプションエラーが発生します

以下の症状が発生する場合があります：
- AIチャットで応答がない、またはドキュメント分析ワークフローが失敗
- ログに`AccessDeniedException`またはMarketplaceサブスクリプション関連エラーが表示

2025年9月より、BedrockはすべてのサーバーレスモデルをIAMで自動有効化するため、コンソールで手動有効化する必要はありません。ただし、サードパーティモデル（Anthropic、Cohereなど）を**初めて呼び出す**と、BedrockがバックグラウンドでAWS Marketplaceサブスクリプションを開始します。この処理中（最大15分）は呼び出しが失敗する場合がありますが、サブスクリプション完了後は正常に動作します。

**確認事項：**
- デプロイIAMロールに`aws-marketplace:Subscribe`、`aws-marketplace:Unsubscribe`、`aws-marketplace:ViewSubscriptions`権限があるか確認
- Anthropicモデルは、BedrockコンソールまたはPutUseCaseForModelAccess` APIで**FTU（First Time Use）**フォームを1回提出する必要があります

### OCRスタックのデプロイが失敗します（Lambdaメモリ制限）

Rust PaddleOCR Lambdaは2,048MBのメモリが必要です。Lambdaメモリは通常10,240MBまで設定可能ですが、一部の新規またはフリーティアアカウントではデフォルトクォータが3,008MBに制限されています。ほとんどの場合問題にはなりませんが、アカウントのクォータが非常に低い場合はデプロイが失敗する可能性があります。このクォータは手動で申請できず、アカウントの使用量に応じて自動的に増加します。

:::note
Service Quotasダッシュボードで現在のメモリクォータを確認してください。
:::

### ワークフロー実行時にLambda同時実行数エラーが発生します

Lambdaの同時実行数のデフォルト上限はリージョンあたり1,000ですが、アカウントによってはより低く設定されている場合があります。複数のドキュメントを同時に処理したり、セグメントの並列分析時に同時実行数の上限を超える可能性があります。

**対応：** Service Quotasダッシュボードで現在のクォータを確認し、低い場合は増加をリクエストしてください。反映まで最大1日かかる場合があります。

### 大容量ドキュメント分析時にBedrockクォータ制限が発生します

ページ数の多いドキュメントを分析する際、Bedrockサービスクォータ（分あたりのリクエスト数、トークン数など）の超過により分析が失敗または遅延する場合があります。まず少ないページのドキュメントでテストし、必要に応じてService QuotasダッシュボードでBedrockクォータの増加をリクエストしてください。

### Neptune Serverlessのデプロイが失敗します（フリーティアアカウント）

Neptune ServerlessはAWSフリーティアアカウントでは利用できません。ナレッジグラフ機能を使用するには、フリーティアでない通常のアカウントが必要です。

### デプロイに失敗しました。どうすればいいですか？

[Quick Deploy Guide - トラブルシューティング](./deployment.md#トラブルシューティング)セクションを参照してください。CodeBuildログで失敗原因を確認できます。

```bash
aws logs tail /aws/codebuild/sample-aws-idp-pipeline-deploy --since 10m
```

---

## インフラストラクチャ

### SageMakerエンドポイントを常時稼働させるには？

デフォルト設定はオートスケーリング0→1で、未使用時10分後にインスタンスが0に縮小されます。常時稼働させるには、最小インスタンス数を変更します。

**AWS Consoleで変更：**

1. **SageMaker Console** > **Inference** > **Endpoints**でエンドポイントを選択
2. **Endpoint runtime settings**タブでvariantを選択し、**Update scaling policy**をクリック
3. **Minimum instance count**を`1`に変更

:::danger
ml.g5.xlargeインスタンスを常時稼働させると、時間あたりの費用が継続的に発生します。
:::

### 分析に使用されるAIモデルを変更するには？

ワークフロー分析モデルは`packages/infra/src/models.json`で管理されています。

```json
{
  "analysis": "global.anthropic.claude-sonnet-4-6",
  "summarizer": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "embedding": "amazon.nova-2-multimodal-embeddings-v1:0",
  "videoAnalysis": "us.twelvelabs.pegasus-1-2-v1:0"
}
```

| キー | 用途 | Lambda環境変数 |
|------|------|----------------|
| `analysis` | セグメント分析、Q&A再生成 | `BEDROCK_MODEL_ID` |
| `summarizer` | 文書要約 | `SUMMARIZER_MODEL_ID` |
| `embedding` | ベクトル埋め込み | `EMBEDDING_MODEL_ID` |
| `videoAnalysis` | 動画分析 | `BEDROCK_VIDEO_MODEL_ID` |

**方法1: models.jsonを修正して再デプロイ（推奨）**

```bash
# models.json修正後
pnpm nx deploy @idp-v2/infra
```

**方法2: Lambda環境変数を直接修正**

再デプロイなしで即座に変更するには、Lambda Consoleで環境変数を修正します。

1. **Lambda Console** > 該当関数を選択（例：`IDP-V2-*-SegmentAnalyzer`）
2. **Configuration** > **Environment variables** > **Edit**
3. 環境変数の値を修正して**Save**

:::danger
Lambda環境変数を直接修正すると、次回のCDKデプロイ時にmodels.jsonの値で上書きされます。
:::

---

## ドキュメント処理

### 対応ファイル形式は？

ドキュメント（PDF、DOC、TXT）、画像（PNG、JPG、GIF、TIFF）、動画（MP4、MOV、AVI）、音声（MP3、WAV、FLAC）ファイルを最大500MBまでサポートしています。

| ファイルタイプ | 対応フォーマット | 前処理 |
|---------------|-----------------|--------|
| ドキュメント | PDF、DOC、TXT | PaddleOCR + BDA（オプション）+ PDFテキスト抽出 |
| 画像 | PNG、JPG、GIF、TIFF | PaddleOCR + BDA（オプション） |
| 動画 | MP4、MOV、AVI | AWS Transcribe + BDA（オプション） |
| 音声 | MP3、WAV、FLAC | AWS Transcribe |

### 大容量ドキュメント（数千ページ）も処理できますか？

はい。Step Functions + DynamoDBベースのセグメント処理方式で大容量ドキュメントをサポートしています。3,000ページのドキュメントまでテスト済みです。ただし、ページ数に比例して処理時間とBedrock呼び出しコストが大幅に増加するため、まず少ないページのドキュメントでテストし、段階的に増やすことを推奨します。

### OCRエンジンは何を使用していますか？違いは？

| OCRエンジン | 説明 |
|------------|------|
| **PaddleOCR** | Lambda（Rust、MNN推論）またはSageMaker（GPU）で実行されるオープンソースOCR。80以上の言語をサポート。テキスト抽出に最適化 |
| **Bedrock Data Automation（BDA）** | AWS管理サービス。ドキュメント構造（テーブル、フォームなど）を一緒に分析。プロジェクト設定で選択可能 |

> 詳細は[PaddleOCR on SageMaker](./ocr.md)を参照してください。

### 動画/音声ファイルはどのように分析されますか？

1. **AWS Transcribe**が音声をテキストに変換します
2. 動画の場合、**TwelveLabs Pegasus 1.2**が視覚的内容を分析します
3. トランスクリプション + 視覚分析結果を組み合わせてセグメントを生成します
4. ReAct Agentが各セグメントを深層分析します

---

## AI分析

### 分析結果が不正確な場合はどうすればいいですか？

複数のレベルで結果を修正できます。

- **Q&A再生成**: 特定セグメントのQ&Aをカスタム指示とともに再生成
- **Q&A追加/削除**: 個別のQ&A項目を手動で追加または削除
- **全体再分析**: ドキュメント全体を新しい指示で再分析

### ドキュメント分析プロンプトをカスタマイズできますか？

はい。プロジェクト設定でドキュメント分析プロンプトを修正できます。このプロンプトはReAct Agentがセグメントを分析する際に使用されます。プロジェクトのドメインや分析目的に合わせてカスタマイズすると、より正確な結果が得られます。

### どのAIモデルを使用していますか？

| モデル | 用途 |
|--------|------|
| **Claude Sonnet 4.6** | セグメント分析（Vision ReAct Agent）、AIチャット |
| **Claude Haiku 4.5** | 文書要約 |
| **Amazon Nova Embed Text v1** | ベクトル埋め込み（1024d） |
| **TwelveLabs Pegasus 1.2** | 動画分析 |
| **Cohere Rerank v3.5** | 検索結果再ランキング |

---

## AIチャット

### チャットはドキュメント内容に基づいて回答しますか？

はい。AI AgentがMCPツールを通じてプロジェクトにアップロードされたドキュメントを自動的に検索します。ベクトル検索と全文検索（FTS）を組み合わせたハイブリッド検索を実行し、Cohere Rerankで結果を再ランキングして、最も関連性の高い内容に基づいて回答します。

### カスタムエージェントとは何ですか？

プロジェクトごとにシステムプロンプトを設定したカスタムエージェントを作成できます。例えば、法律文書分析専用エージェント、技術文書要約専用エージェントなどを作成して使用できます。会話中にエージェントを切り替えることもできます。

### エージェントが使用できるツールは？

| ツール | 説明 |
|--------|------|
| search_documents | プロジェクトドキュメントのハイブリッド検索 |
| save/load/edit_markdown | マークダウンファイルの作成と編集 |
| create_pdf, extract_pdf_text/tables | PDF作成とテキスト/テーブル抽出 |
| create_docx, extract_docx_text/tables | Wordドキュメント作成とテキスト/テーブル抽出 |
| generate_image | AI画像生成 |
| code_interpreter | Pythonコード実行 |

### チャットに画像やドキュメントを添付できますか？

はい。チャット入力欄に画像やドキュメントを添付してマルチモーダル入力を使用できます。AI Agentが添付ファイルの内容を分析して回答します。

---

## セキュリティ

### 認証はどのように処理されますか？

Amazon Cognito OIDC認証を使用しています。フロントエンドでCognitoを通じてログインするとJWTトークンが発行され、バックエンドAPI呼び出し時にトークンが自動的に含まれます。MCPツール呼び出しにはIAM SigV4認証を使用しています。

### データはどこに保存されますか？

| データ | ストレージ |
|--------|-----------|
| 元ファイル、セグメント画像 | Amazon S3 |
| ベクトル埋め込み、検索インデックス | LanceDB（S3 Express One Zone） |
| プロジェクト/ワークフローメタデータ | Amazon DynamoDB |
| チャットセッション、エージェントプロンプト、アーティファクト | Amazon S3 |
| WebSocket接続情報 | Amazon ElastiCache Redis |

### LanceDBデータを直接確認できますか？

LanceDBはS3 Express One Zoneに保存されているため、直接アクセスが困難です。CloudShellからLambdaを通じて照会できます。

**テーブル一覧照会**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "list_tables", "params": {}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**特定プロジェクトのレコード数照会**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "count", "params": {"project_id": "YOUR_PROJECT_ID"}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**特定ワークフローのセグメント照会**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "get_segments", "params": {"project_id": "YOUR_PROJECT_ID", "workflow_id": "YOUR_WORKFLOW_ID"}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**検索（ハイブリッド: ベクトル + キーワード）**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "search", "params": {"project_id": "YOUR_PROJECT_ID", "query": "検索クエリ", "limit": 5}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```
