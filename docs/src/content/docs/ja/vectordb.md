---
title: "Vector Database"
description: "サーバーレスベクトルストレージと多言語ハイブリッド検索"
---

## 概要

このプロジェクトでは、Amazon OpenSearch Serviceの代わりに[LanceDB](https://lancedb.com/)をベクトルデータベースとして使用しています。LanceDBはオープンソースのサーバーレスベクトルデータベースで、データをS3に直接保存し、専用クラスターインフラが不要です。[Lindera](https://github.com/lindera/lindera)と[ICU4X](https://github.com/unicode-org/icu4x)ベースの多言語トークナイザーと組み合わせることで、多言語文書に対するハイブリッド検索（ベクトル＋全文検索）を実現しています。

### 多言語検索サポート

| 言語 | セマンティック検索（ベクトル） | 全文検索（FTS） | 検索モード |
|------|:---:|:---:|------------|
| **韓国語** | O | O | ハイブリッド（ベクトル + FTS） |
| **日本語** | O | O | ハイブリッド（ベクトル + FTS） |
| **中国語** | O | O | ハイブリッド（ベクトル + FTS） |
| **英語およびその他の言語** | O | O | ハイブリッド（ベクトル + FTS） |

LinderaはCJK言語（韓国語、日本語、中国語）に対して辞書ベースのトークン化を提供し、ICU4Xはその他の言語に対してUnicodeワードセグメンテーションを処理します。これにより、すべてのサポート言語で正確なFTSキーワード抽出が可能です。

### PoCにLanceDBを選んだ理由

このプロジェクトは**PoC/プロトタイプ**であり、コスト効率が重要な要素です。

| 項目 | OpenSearch Service | LanceDB (S3) |
|------|-------------------|---------------|
| インフラ | 専用クラスター（最低2〜3ノード） | クラスター不要（サーバーレス） |
| アイドルコスト | 未使用時でも課金 | S3ストレージコストのみ |
| 設定の複雑さ | ドメイン構成、VPC、アクセスポリシー | S3バケット + DynamoDBロックテーブル |
| スケーリング | ノードスケーリングが必要 | S3と共に自動拡張 |
| 推定月額コスト（PoC） | $200〜500+（t3.medium x2最低） | $1〜10（S3 + DDBオンデマンド） |

:::note
OpenSearchはダッシュボード、k-NNプラグイン、きめ細かなアクセス制御など、本番ワークロードに適した豊富な機能を提供します。移行ガイドは[OpenSearchマイグレーション](#opensearchマイグレーション)を参照してください。
:::

---

## アーキテクチャ

```
書き込みパス:
  Analysis Finalizer → SQS (Write Queue) → LanceDB Writer Lambda
    → LanceDB Service Lambda (Rust)
        ├─ Toka Lambda (Rust): キーワード抽出 (Lindera / ICU4X)
        ├─ Bedrock Nova: ベクトル埋め込み (1024d)
        └─ LanceDB: S3 Express One Zoneに保存

読み取りパス:
  MCP Search Tool Lambda
    → LanceDB Service Lambda (Rust): ハイブリッド検索 (ベクトル + FTS)
    → Bedrock Claude Haiku: 検索結果の要約

削除パス:
  Backend API（プロジェクト削除）
    → LanceDB Service Lambda: drop_table
```

### ストレージ構造

```
S3 Express One Zone (Directory Bucket)
  └─ idp-v2/
      ├─ {project_id_1}/     ← プロジェクトごとに1つのLanceDBテーブル
      │   ├─ data/
      │   └─ indices/
      └─ {project_id_2}/
          ├─ data/
          └─ indices/

DynamoDB (Lock Table)
  PK: base_uri  |  SK: version
  └─ LanceDBテーブルの同時アクセス管理
```

---

## コンポーネント

### 1. LanceDB Service Lambda（Rust）

ベクトルDBのコアサービスです。Rustで実装され（`cargo-lambda-cdk`）、メモリ使用量とコールドスタートが最適化されています。

| 項目 | 値 |
|------|-----|
| 関数名 | `idp-v2-lance-service` |
| ランタイム | Rust (cargo-lambda-cdk) |
| アーキテクチャ | ARM64 |
| メモリ | 1024 MB |
| タイムアウト | 5分 |

**サポートアクション:**

| アクション | 説明 |
|-----------|------|
| `add_record` | QAレコード追加（キーワード抽出 + 埋め込み + 保存） |
| `delete_record` | QA IDまたはセグメントIDで削除 |
| `get_segments` | ワークフローの全セグメント取得 |
| `get_by_segment_ids` | セグメントIDリストで本文取得（Graph MCPで使用） |
| `hybrid_search` | ハイブリッド検索（ベクトル + FTS、`query_type='hybrid'`） |
| `list_tables` | 全プロジェクトテーブル一覧 |
| `count` | プロジェクトテーブルのレコード数取得 |
| `delete_by_workflow` | ワークフローIDで全レコード削除 |
| `drop_table` | プロジェクトテーブル全体を削除 |

**Rust Lambdaを使用する理由:**

Rustは従来のDocker Python Lambdaと比較してメモリ使用量が大幅に削減され、コールドスタートが高速です。Scale-to-zeroが可能なサーバーレスベクトルDBサービスにとって重要な特性です。

### 2. Toka Lambda（Rust）

LanceDB ServiceがFTSキーワード抽出に使用する多言語トークナイザーサービスです。

| 項目 | 値 |
|------|-----|
| 関数名 | `idp-v2-toka` |
| ランタイム | Rust (cargo-lambda-cdk) |
| アーキテクチャ | ARM64 |
| メモリ | 1024 MB |
| トークナイザー | Lindera（CJK辞書ベース）、ICU4X（Unicodeワードセグメンテーション） |

### 3. LanceDB Writer Lambda

分析パイプラインからの書き込みリクエストを受信し、LanceDB Serviceに委任するSQSコンシューマーです。

| 項目 | 値 |
|------|-----|
| 関数名 | `idp-v2-lancedb-writer` |
| ランタイム | Python 3.14 |
| メモリ | 256 MB |
| タイムアウト | 5分 |
| トリガー | SQS（`idp-v2-lancedb-write-queue`） |
| 同時実行数 | 1（順次処理） |

同時実行数を1に設定し、LanceDBテーブルへの同時書き込み競合を防止しています。

### 4. MCP Search Tool

AIチャット中にエージェントが文書を検索する際、LanceDB Service Lambdaを直接呼び出すMCPツールです。

```
ユーザークエリ → Bedrock Agent Core → MCP Gateway
  → Search Tool Lambda → LanceDB Service Lambda (hybrid_search)
    → Bedrock Claude Haiku: 検索結果の要約 → レスポンス
```

| 項目 | 値 |
|------|-----|
| スタック | McpStack |
| ランタイム | Node.js 22.x (ARM64) |
| タイムアウト | 30秒 |
| 環境変数 | `LANCEDB_FUNCTION_ARN`（SSM経由） |

---

## データスキーマ

各QA分析結果がレコードとして保存されます。1つのセグメント（ページ）に複数のQAが存在できるため、**QA単位でレコード**が作成されます:

```python
class DocumentRecord(LanceModel):
    workflow_id: str            # ワークフローID
    document_id: str            # 文書ID
    segment_id: str             # "{workflow_id}_{segment_index:04d}"
    qa_id: str                  # "{workflow_id}_{segment_index:04d}_{qa_index:02d}"
    segment_index: int          # セグメントページ/チャプター番号
    qa_index: int               # QA番号（0から）
    question: str               # AIが生成した質問
    content: str                # content_combined（埋め込みソースフィールド）
    vector: Vector(1024)        # Bedrock Nova埋め込み（ベクトルフィールド）
    keywords: str               # トークン化キーワード（FTSインデックス）
    file_uri: str               # 元ファイルS3 URI
    file_type: str              # MIMEタイプ
    image_uri: Optional[str]    # セグメント画像S3 URI
    created_at: datetime        # タイムスタンプ
```

- **プロジェクトごとに1テーブル**: テーブル名 = `project_id`
- **QA単位保存**: セグメントごとに複数のQAが独立レコードとして保存（`qa_id`で一意識別）
- **`content`**: 全前処理結果を統合したテキスト（OCR + BDA + PDFテキスト + AI分析）
- **`vector`**: LanceDB埋め込み関数で自動生成（Bedrock Nova、1024次元）
- **`keywords`**: Lindera/ICU4Xで抽出したトークン（FTSインデックス）。LinderaはCJK言語を辞書ベースでトークン化し、ICU4Xはその他の言語をUnicodeワードセグメンテーションで処理

---

## Toka: 多言語トークナイザー

Tokaは[Lindera](https://github.com/lindera/lindera)と[ICU4X](https://github.com/unicode-org/icu4x)を組み合わせたRustベースの多言語トークナイザーLambdaです。

### カスタムトークナイザーを使用する理由

LanceDBの内蔵FTSトークナイザーはCJK言語を十分にサポートしていません。CJK言語（韓国語、日本語、中国語）は膠着語であったり単語境界がないため、単純なスペースベースのトークン化では不十分です。例:

```
韓国語入力:  "인공지능 기반 문서 분석 시스템을 구축했습니다."
Toka出力:   ["인공지능", "기반", "분석", "시스템", "구축", "했", "."]

日本語入力: "文書分析システムを構築しました"
Toka出力:    ["文書", "分析", "システム", "構築", "し"]
```

### トークナイザー選択

| 言語 | トークナイザー | 方式 |
|------|-------------|------|
| 韓国語 | Lindera (lindera-ko-dic) | 辞書ベース形態素分析 |
| 日本語 | Lindera (lindera-ipadic) | 辞書ベース形態素分析 |
| 中国語 | Lindera (lindera-cc-cedict) | 辞書ベースセグメンテーション |
| その他 | ICU4X | Unicodeワードセグメンテーション |

---

## ハイブリッド検索フロー

すべての検索はLanceDB Service Lambdaで処理されます。LanceDBのネイティブ`query_type='hybrid'`を使用してベクトル検索と全文検索を統合します。

```
検索クエリ: "문서 분석 결과 조회"
  │
  ├─ [1] Tokaキーワード抽出（LanceDB Service Lambda経由）
  │     → ["문서", "분석", "결과", "조회"]
  │
  ├─ [2] LanceDBネイティブハイブリッド検索
  │     → table.search(query=keywords, query_type='hybrid')
  │     → ベクトル検索（Nova埋め込み）+ FTS自動マージ
  │     → Top-K結果（_relevance_score）
  │
  └─ [3] 結果の要約（MCP Search Tool Lambda）
        → Bedrock Claude Haikuで検索結果に基づく回答を生成
```

---

## インフラ（CDK）

### S3 Express One Zone

```typescript
// StorageStack
const expressStorage = new CfnDirectoryBucket(this, 'LanceDbExpressStorage', {
  bucketName: `idp-v2-lancedb--use1-az4--x-s3`,
  dataRedundancy: 'SingleAvailabilityZone',
  locationName: 'use1-az4',
});
```

S3 Express One Zoneは一桁ミリ秒のレイテンシを提供し、ベクトル検索のような頻繁な読み書きパターンに最適化されています。

### DynamoDB Lock Table

```typescript
// StorageStack
const lockTable = new Table(this, 'LanceDbLockTable', {
  partitionKey: { name: 'base_uri', type: AttributeType.STRING },
  sortKey: { name: 'version', type: AttributeType.NUMBER },
  billingMode: BillingMode.PAY_PER_REQUEST,
});
```

複数のLambda関数が同じデータセットに同時アクセスする際の分散ロックを管理します。

### SSMパラメータ

| キー | 説明 |
|------|------|
| `/idp-v2/lancedb/lock/table-name` | DynamoDBロックテーブル名 |
| `/idp-v2/lancedb/express/bucket-name` | S3 Expressバケット名 |
| `/idp-v2/lancedb/express/az-id` | S3 Express可用性ゾーンID |
| `/idp-v2/lancedb/function-arn` | LanceDB Service Lambda関数ARN |

---

## コンポーネント依存関係マップ

LanceDBに依存するすべてのコンポーネントを示したダイアグラムです:

```mermaid
graph TB
    subgraph Write["Write Path"]
        Writer["LanceDB Writer"]
        QA["QA Regenerator"]
    end

    subgraph Read["Read Path"]
        MCP["MCP Search Tool<br/>(Agent)"]
    end

    subgraph Delete["Delete Path"]
        Backend["Backend API<br/>（プロジェクト削除）"]
    end

    subgraph Core["Core Service"]
        Service["LanceDB Service<br/>(Rust Lambda)"]
        Toka["Toka<br/>(Rust Lambda)"]
    end

    subgraph Storage["Storage Layer"]
        S3["S3 Express One Zone"]
        DDB["DynamoDB Lock Table"]
    end

    Writer -->|invoke| Service
    QA -->|invoke| Service
    MCP -->|invoke<br/>hybrid_search| Service
    Backend -->|invoke<br/>drop_table| Service

    Service --> S3 & DDB
    Service -->|invoke| Toka

    style Storage fill:#fff3e0,stroke:#ff9900
    style Core fill:#e8f5e9,stroke:#2ea043
    style Write fill:#fce4ec,stroke:#e91e63
    style Read fill:#e3f2fd,stroke:#1976d2
    style Delete fill:#f3e5f5,stroke:#7b1fa2
```

| コンポーネント | スタック | アクセスタイプ | 説明 |
|--------------|--------|-------------|------|
| **LanceDB Service** | LanceServiceStack | 読み書き | コアDBサービス（Rust Lambda） |
| **Toka** | LanceServiceStack | トークン化 | 多言語トークナイザー（Rust Lambda） |
| **LanceDB Writer** | WorkflowStack | 書き込み（Service経由） | SQSコンシューマー、Serviceに委任 |
| **Analysis Finalizer** | WorkflowStack | 書き込み（SQS/Service経由） | セグメントを書き込みキューに送信、再分析時に削除 |
| **QA Regenerator** | WorkflowStack | 書き込み（Service経由） | Q&Aセグメント更新 |
| **MCP Search Tool** | McpStack | 読み取り（Service直接呼び出し） | エージェント文書検索ツール |
| **Backend API** | ApplicationStack | 削除（Service経由） | プロジェクト削除時に`drop_table`を呼び出し |

---

## OpenSearchマイグレーション

本番環境でAmazon OpenSearch Serviceに移行する場合、以下のコンポーネントの修正が必要です。

### 交換対象コンポーネント

| コンポーネント | 現在（LanceDB） | 変更後（OpenSearch） | 範囲 |
|--------------|----------------|---------------------|------|
| **LanceDB Service Lambda** | Rust Lambda + LanceDB | OpenSearchクライアント（CRUD + 検索） | 全面交換 |
| **LanceDB Writer Lambda** | SQS → LanceDB Service呼び出し | SQS → OpenSearchインデックス書き込み | 呼び出し先交換 |
| **MCP Search Tool** | Lambda invoke → LanceDB Service | Lambda invoke → OpenSearch検索 | 呼び出し先交換 |
| **StorageStack** | S3 Express + DDBロックテーブル | OpenSearchドメイン（VPC） | リソース交換 |

### 変更不要コンポーネント

| コンポーネント | 理由 |
|--------------|------|
| **Analysis Finalizer** | SQSにメッセージ送信のみ（キューインターフェース不変） |
| **Frontend** | DB直接アクセスなし |
| **Step Functions Workflow** | LanceDB直接依存なし |

### マイグレーション戦略

```
Phase 1: ストレージ層の交換
  - VPC内にOpenSearchドメインを作成
  - StorageStackリソース交換（S3 Express + DDBロック削除）
  - 韓国語トークン化のためのNori分析器設定（Toka/Lindera代替）

Phase 2: 書き込みパスの交換
  - LanceDB Service → OpenSearchインデクシングサービスに変更
  - 文書スキーマ変更（OpenSearchインデックスマッピング）
  - 埋め込み用OpenSearch neural ingest pipeline追加

Phase 3: 読み取りパスの交換
  - MCP Search Tool LambdaのinvokeターゲットをOpenSearch検索サービスに変更
  - Toka依存関係削除（Noriが韓国語トークン化を処理）

Phase 4: LanceDB依存関係の削除
  - Rust Lambda関数削除（LanceDB Service、Toka）
  - S3 ExpressバケットおよびDDBロックテーブルの削除
```

### 主要考慮事項

| 項目 | 内容 |
|------|------|
| 韓国語トークン化 | OpenSearchには[Nori分析器](https://opensearch.org/docs/latest/analyzers/language-analyzers/#korean-nori)が内蔵されておりToka/Lindera削除可能 |
| ベクトル検索 | OpenSearch k-NNプラグイン（HNSW/IVF）がLanceDBベクトル検索を代替 |
| 埋め込み | OpenSearch neural searchでingest pipelineから自動埋め込み可能、または事前計算済み埋め込みを使用 |
| コスト | OpenSearchは稼働中のクラスターが必要。HAのための最低2ノードクラスター |
| SQSインターフェース | SQS書き込みキューパターンは維持可能、コンシューマーロジックのみ変更 |
