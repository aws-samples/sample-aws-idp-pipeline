<p align="center">
  <img src="../assets/logo.png" alt="AWS IDP Logo" width="120">
</p>
<h1 align="center">Sample AWS IDP Pipeline</h1>

<p align="center">
  <strong>非構造化データのためのAI駆動インテリジェント文書処理（IDP）プロトタイプ</strong>
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
  <a href="../../README.md">English</a> | <a href="README_ko.md">한국어</a> | <strong>日本語</strong>
</p>

<p align="center">
  <a href="#機能">機能</a> |
  <a href="#アーキテクチャ">アーキテクチャ</a> |
  <a href="#はじめに">はじめに</a> |
  <a href="#デプロイ">デプロイ</a> |
  <a href="#対応モデル">モデル</a>
</p>

---

## 概要

非構造化データを実用的なインサイトに変換するAI駆動IDPプロトタイプです。**文書、動画、音声、画像**を分析し、ハイブリッド検索（ベクトル＋キーワード）と対話型AIインターフェースを提供します。AWS CDKで構築されたNxモノレポ構成で、リアルタイムワークフローステータス通知をサポートします。

> [!CAUTION]
> 開発中のバージョンです。本番環境にデプロイしないでください。

> [!NOTE]
> これはAWSサンプルプロジェクトです。実験、評価、開発目的で設計されています。

<p align="center">
  <img src="../assets/main-screen.png" alt="Main Screen" width="900">
</p>

## 機能

- **インテリジェント文書処理（IDP）**
  - Bedrock Data Automation（BDA）による文書分析
  - [PaddleOCR（SageMaker）によるOCR処理](../ocr/OCR_ja.md)
  - AWS Transcribeによる音声/動画テキスト変換
  - ファイルタイプ自動検出と前処理パイプラインルーティング

- **[AI駆動分析](../analysis/ANALYSIS_ja.md)**
  - Claude Sonnet 4.5 Vision ReAct Agentによるセグメント別深層分析
  - Claude Haiku 4.5による文書要約生成
  - Nova Embedによる1024次元ベクトル埋め込み

- **[ハイブリッド検索](../vectordb/VECTORDB_ja.md)**
  - LanceDBベクトル検索 + FTS（全文検索）
  - Kiwi韓国語形態素解析器によるキーワード抽出
  - Bedrock Cohere Rerank v3.5による結果再ランキング

- **AIチャット（Agent Core）**
  - Bedrock Agent Core基盤のIDP Agent / Research Agent
  - MCP Gatewayによるツール呼び出し（検索、アーティファクト管理）
  - S3ベースのセッション管理で会話コンテキスト維持

- **リアルタイム通知**
  - WebSocket API + ElastiCache Redisによるリアルタイムステータス更新
  - DynamoDB Streamsによるワークフローイベント検出
  - ステップ進捗、アーティファクト変更、セッション状態のリアルタイム反映

## アーキテクチャ

![Architecture](../assets/architecture.png)

### CDKスタック構成

```
@idp-v2/infra
├── VpcStack              - VPC (10.0.0.0/16, 2 AZ, NAT Gateway)
├── StorageStack          - S3バケット、DynamoDBテーブル、ElastiCache Redis
├── EventStack            - S3 EventBridge、SQSキュー、ファイルタイプ検出Lambda
├── BdaStack              - Bedrock Data Automationコンシューマー
├── OcrStack              - PaddleOCR SageMaker非同期エンドポイント
├── TranscribeStack       - AWS Transcribeコンシューマー
├── WorkflowStack         - Step Functionsワークフロー（Distributed Map）
├── WebsocketStack        - WebSocket API、リアルタイム通知
├── WorkerStack           - WebSocketメッセージ処理
├── McpStack              - MCP Gateway（検索、アーティファクトツール）
├── AgentStack            - Bedrock Agent Core（IDP Agent、Research Agent）
└── ApplicationStack      - Backend（ECS Fargate）、Frontend（CloudFront）、Cognito
```

### コアワークフロー

#### 1. 文書アップロード＆分析パイプライン

ユーザーがPresigned URLでS3に文書をアップロードすると、EventBridgeがObjectCreatedイベントを検出します。Type Detection Lambdaがファイルタイプを判別してSQSにルーティングし、OCR（PaddleOCR/SageMaker）とTranscribeは自動実行、BDAはオプションで実行されます。前処理完了後、Step Functionsワークフローがセグメント分割、AI分析、ベクトル埋め込み、文書要約を順次実行します。

```
S3 Upload (Presigned URL)
  → EventBridge (ObjectCreated)
    → Type Detection Lambda
      ├─ OCR Queue     → PaddleOCR (SageMaker)    ── 自動実行
      ├─ BDA Queue     → Bedrock Data Automation   ── オプション
      └─ Transcribe Queue → AWS Transcribe          ── 自動実行

  → Step Functions Workflow
      Segment Prep ─→ Wait for Preprocess ─→ Build Segments
        ─→ Distributed Map (max 30)
            ├─ Segment Analyzer (Claude Sonnet 4.5 Vision)
            └─ Analysis Finalizer → SQS → LanceDB Writer
        ─→ Document Summarizer (Claude Haiku 4.5)
            → Vector Embedding (Nova 1024d) → LanceDB
```

#### 2. リアルタイム通知（WebSocket）

ワークフローの進行状態がDynamoDBに記録されると、DynamoDB Streamsが変更を検出します。VPC内部のWorkflowStream LambdaがRedisでアクティブ接続を照会し、WebSocket APIを通じてイベントをプッシュすることで、フロントエンドでリアルタイムにステータスを反映します。

```
DynamoDB Streams（状態変更検出）
  → WorkflowStream Lambda (VPC)
    → Redis（接続照会）
      → WebSocket API → Frontend
        ├─ ステップ進捗
        ├─ アーティファクト変更
        └─ セッション状態更新
```

#### 3. AIチャット（Agent Core）

ユーザーの質問がAPI Gatewayを通じてBedrock Agent Coreに送信されます。IDP AgentとResearch AgentがMCP Gatewayを通じてツールを呼び出し、Search Toolでハイブリッド検索を実行し、Artifact Toolで成果物を管理します。セッション履歴はS3に保存され、会話コンテキストが維持されます。

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

#### 4. バックエンドAPI（HTTP）

API Gateway HTTP（IAM認証）からVPC Linkを通じてPrivate ALBを経由し、ECS FargateのFastAPIに接続されます。プロジェクト/文書管理、ワークフロー照会、ハイブリッド検索、チャットセッション、カスタムエージェント、アーティファクト管理など、すべてのデータアクセスを担当します。

```
API Gateway HTTP (IAM Auth)
  → VPC Link → Private ALB → ECS Fargate (FastAPI)
    ├─ DynamoDB     ── プロジェクト/文書CRUD、ワークフロー状態
    ├─ LanceDB      ── ハイブリッド検索 (Vector + FTS)
    ├─ Bedrock      ── Cohere Rerank v3.5
    ├─ S3           ── Presigned URL、セッション (DuckDB)、エージェント
    ├─ Redis        ── クエリキャッシュ
    ├─ Step Functions ── 再分析トリガー
    └─ Lambda       ── QA Regenerator
```

### 主要設計判断

| 判断 | 理由 |
|------|------|
| Step Functionsペイロード → DynamoDB中間ストレージ | Step Functions 256KBペイロード制限の回避 |
| セグメントインデックスのみワークフローに渡す | 3000ページ以上の文書サポート |
| LanceDB + S3 Express One Zone | ベクトル検索に最適化された低レイテンシストレージ |
| SageMaker Auto-scaling 0→1 | コスト最適化（アイドル時Scale-to-zero） |
| ElastiCache Redis | WebSocket接続状態管理（DynamoDB TTLより高速） |
| DuckDBでS3直接クエリ | セッション/エージェントデータのコピーなしで照会 |
| VPC Link + Private ALB | バックエンドをインターネットに公開しない |
| Distributed Map（最大30並列） | Lambda同時実行制限と並列性のバランス |

## はじめに

### 前提条件

- [Node.js](https://nodejs.org/) v18以上
- [pnpm](https://pnpm.io/) v8以上
- [Python](https://www.python.org/) 3.12
- [AWS CLI](https://aws.amazon.com/cli/)（認証情報設定済み）
- [AWS CDK](https://aws.amazon.com/cdk/) v2
- [mise](https://mise.jdx.dev/)（タスク管理）

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/aws-samples/sample-aws-idp-pipeline.git
cd sample-aws-idp-pipeline

# 依存関係のインストール
pnpm install

# 環境変数の設定
cp .env.local.example .env.local
# .env.localを編集してAWSプロファイルとリージョンを設定
```

### ローカル開発

```bash
# フロントエンド開発サーバー
pnpm nx serve @idp-v2/frontend

# エージェントのローカル実行
pnpm nx serve idp_v2.idp_agent
```

## デプロイ

> **Quick Deploy**: CloudShell + CodeBuildを使用して、単一スクリプトでパイプライン全体をデプロイできます。[Quick Deploy Guide](../deployment/DEPLOYMENT_ja.md)を参照してください。

### miseを使用したデプロイ（推奨）

```bash
# miseのインストール (macOS)
brew install mise

# スタック選択デプロイ（fzfで選択）
mise run deploy

# 全体ビルド
pnpm build:all
```

### CDK直接デプロイ

```bash
# CDKブートストラップ（初回のみ）
pnpm nx synth @idp-v2/infra

# 全スタックデプロイ
pnpm nx deploy @idp-v2/infra

# ホットスワップデプロイ（開発用）
pnpm nx deploy @idp-v2/infra --hotswap

# リソース削除
pnpm nx destroy @idp-v2/infra
```

### 主要コマンド

```bash
# ビルド
pnpm build:all                              # 全体ビルド
pnpm nx build @idp-v2/infra                 # 単一パッケージビルド

# テスト
pnpm nx test @idp-v2/infra                  # テスト実行
pnpm nx test @idp-v2/infra --update         # スナップショット更新

# リント
pnpm nx lint @idp-v2/infra                  # リント
pnpm nx lint @idp-v2/infra --configuration=fix  # 自動修正
```

## 対応モデル

### AI分析モデル

| モデル | 用途 | 説明 |
|--------|------|------|
| Claude Sonnet 4.5 | セグメント分析 / エージェント | Vision ReAct Agent、深層文書分析 |
| Claude Haiku 4.5 | 文書要約 | 軽量モデル、高速要約生成 |
| Nova Embed Text v1 | ベクトル埋め込み | 1024次元テキスト埋め込み |
| Cohere Rerank v3.5 | 検索再ランキング | ハイブリッド検索結果最適化 |

### 前処理モデル

| モデル | 用途 | 説明 |
|--------|------|------|
| PaddleOCR | OCR | SageMaker g5.xlarge、Auto-scaling 0→1 |
| Bedrock Data Automation | 文書分析 | 非同期文書構造分析（オプション） |
| AWS Transcribe | 音声変換 | 音声/動画テキスト変換 |

## プロジェクト構成

```
sample-aws-idp-pipeline/
├── packages/
│   ├── agents/                    # AIエージェント
│   │   ├── idp-agent/             # IDP Agent (Strands SDK)
│   │   └── research-agent/        # Research Agent
│   ├── backend/app/               # FastAPIバックエンド
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── ddb/                   # DynamoDBモジュール
│   │   ├── routers/               # APIルーター
│   │   └── services/              # ビジネスロジック
│   ├── common/constructs/src/     # 再利用CDKコンストラクト
│   ├── frontend/src/              # React SPA
│   │   ├── routes/                # ページルート
│   │   └── components/            # Reactコンポーネント
│   └── infra/src/
│       ├── stacks/                # 12 CDKスタック
│       ├── functions/             # Python Lambda関数
│       │   ├── step-functions/    # ワークフロー関数
│       │   ├── shared/            # 共有モジュール
│       │   ├── websocket/         # WebSocketハンドラー
│       │   └── lancedb-writer/    # LanceDBライター
│       └── lambda-layers/         # Lambdaレイヤー
├── docs/                          # ドキュメント
└── README.md
```

## 技術スタック

### インフラストラクチャ（TypeScript）
- AWS CDK 2.230.x + Nx 22.x
- AWS Step Functions（ワークフローオーケストレーション）
- AWS Lambda + Lambda Layers
- API Gateway HTTP / REST / WebSocket

### バックエンド（Python）
- FastAPI（ECS Fargate、ARM64）
- LanceDB + S3 Express One Zone（ベクトルストレージ）
- DynamoDB（One Table Design）
- Kiwi（韓国語形態素解析器）
- DuckDB（S3直接クエリ）

### フロントエンド（TypeScript）
- React 19 + TanStack Router
- Tailwind CSS
- AWS SDK（S3アップロード）
- Cognito OIDC認証
- WebSocketクライアント

### AI / ML
- Bedrock Agent Core（Strands SDK、ReActパターン）
- Bedrock Claude Sonnet 4.5 / Haiku 4.5
- Bedrock Nova Embed（1024次元）
- Bedrock Cohere Rerank v3.5
- PaddleOCR（SageMaker）
- AWS Transcribe

---

## ライセンス

このプロジェクトは[Amazon Software License](../../LICENSE)の下でライセンスされています。
