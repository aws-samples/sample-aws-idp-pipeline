---
title: "DynamoDB"
description: "One Table Designによるワークフロー状態管理"
---

## 概要

DynamoDBは検索用データベースではなく、**ワークフロー状態管理**用途で使用されます。プロジェクト、文書、ワークフロー、セグメント、処理ステップのすべての状態を1つのテーブルで管理する**One Table Design**パターンを適用しています。

---

## テーブル構成

| 項目 | 値 |
|---|---|
| **課金** | On-Demand |
| **Partition Key** | `PK`（String） |
| **Sort Key** | `SK`（String） |
| **GSI1** | `GSI1PK` / `GSI1SK` |
| **GSI2** | `GSI2PK` / `GSI2SK` |
| **Stream** | NEW_AND_OLD_IMAGES |

---

## データ構造

### プロジェクト（PROJ#）

```
PK: PROJ#{project_id}
SK: META
```

| フィールド | 説明 |
|---|---|
| `data.name` | プロジェクト名 |
| `data.language` | 言語（デフォルト: en） |
| `data.document_prompt` | 文書分析用カスタムプロンプト |
| `data.ocr_model` | OCRモデル（デフォルト: pp-ocrv5） |

### プロジェクト-文書リンク（PROJ# / DOC#）

```
PK: PROJ#{project_id}
SK: DOC#{document_id}
```

プロジェクトに属する文書一覧は`begins_with(SK, 'DOC#')`でクエリします。

### プロジェクト-ワークフローリンク（PROJ# / WF#）

```
PK: PROJ#{project_id}
SK: WF#{workflow_id}
```

| フィールド | 説明 |
|---|---|
| `data.file_name` | ファイル名 |
| `data.status` | ワークフローステータス |

### ワークフローメタデータ（DOC#またはWEB#）

```
PK: DOC#{document_id}（またはWEB#{document_id}）
SK: WF#{workflow_id}
```

| フィールド | 説明 |
|---|---|
| `data.project_id` | 所属プロジェクト |
| `data.file_uri` | S3パス |
| `data.file_name` | ファイル名 |
| `data.file_type` | MIMEタイプ |
| `data.execution_arn` | Step Functions実行ARN |
| `data.status` | pending / in_progress / completed / failed |
| `data.total_segments` | 総セグメント数 |
| `data.preprocess` | 前処理ステージ別ステータス（ocr、bda、transcribe、webcrawler） |

### ワークフローステップ（WF# / STEP）

```
PK: WF#{workflow_id}
SK: STEP
GSI1PK: STEP#ANALYSIS_STATUS
GSI1SK: pending | in_progress | completed | failed
```

ワークフローの各処理ステップの状態を追跡します。GSI1により現在実行中の分析を高速に検索できます。

| ステップ | 説明 |
|---|---|
| `segment_prep` | セグメント準備 |
| `bda_processor` | Bedrock Document Analysis |
| `format_parser` | フォーマットパース |
| `paddleocr_processor` | PaddleOCR処理 |
| `transcribe` | 音声変換 |
| `webcrawler` | Webクローリング |
| `segment_builder` | セグメント構築 |
| `segment_analyzer` | AI分析（Claude） |
| `graph_builder` | グラフ構築 |
| `document_summarizer` | 文書要約 |

各ステップは`status`、`label`、`started_at`、`ended_at`、`error`属性を持ちます。

### セグメント（WF# / SEG#）

```
PK: WF#{workflow_id}
SK: SEG#{segment_index:04d}    ← 0001, 0002, ...
```

| フィールド | 説明 |
|---|---|
| `data.segment_index` | セグメントインデックス |
| `data.s3_key` | S3パス（セグメントデータ） |
| `data.image_uri` | 画像URI |
| `data.image_analysis` | 画像分析結果配列 |

---

## アクセスパターン

| クエリ | インデックス | キー条件 |
|---|---|---|
| プロジェクト文書一覧 | Primary | `PK=PROJ#{proj_id}`、`SK begins_with DOC#` |
| プロジェクトワークフロー一覧 | Primary | `PK=PROJ#{proj_id}`、`SK begins_with WF#` |
| ワークフローメタデータ | Primary | `PK=DOC#{doc_id}`、`SK=WF#{wf_id}` |
| ステップ進行状態 | Primary | `PK=WF#{wf_id}`、`SK=STEP` |
| セグメント一覧 | Primary | `PK=WF#{wf_id}`、`SK begins_with SEG#` |
| 特定セグメント | Primary | `PK=WF#{wf_id}`、`SK=SEG#{index}` |
| 実行中の分析検索 | GSI1 | `GSI1PK=STEP#ANALYSIS_STATUS`、`GSI1SK=in_progress` |

---

## 設計原則

### One Table Designを選択した理由

- **単一トランザクション**: ワークフロー作成時にメタデータとステップ状態を`batch_write`で原子的に作成
- **効率的なクエリ**: プロジェクトのすべての文書/ワークフローを単一クエリで取得
- **コスト削減**: 1つのテーブルで管理し、運用の複雑さを最小化

### S3との役割分担

DynamoDBは**状態とメタデータ**のみを保存し、**実際のデータ**（セグメントコンテンツ、分析結果）はS3に保存します。

```
DynamoDB                          S3
  ├─ ワークフロー状態               ├─ セグメント元データ
  ├─ ステップ別進行状態             ├─ 分析結果（JSON）
  ├─ セグメントメタデータ（s3_key） ├─ エンティティ抽出結果
  └─ WebSocket接続情報              └─ 文書要約
```

Step Functionsのペイロード制限（256KB）により、DynamoDBを中間ストレージとして活用します。3000ページ以上の文書もセグメントインデックスのみを渡して処理できます。
