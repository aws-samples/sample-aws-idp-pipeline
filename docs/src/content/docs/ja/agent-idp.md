---
title: "IDPエージェント"
description: "文書検索、分析、アーティファクト生成を担当するメインエージェント"
---

## 概要

IDP Agentは、ユーザーとの会話を通じて文書を検索・分析し、成果物（アーティファクト）を生成するメインエージェントです。Strands SDKのReActパターンで動作し、MCPツールとCode Interpreterを組み合わせて複合的なタスクを実行します。

```
ユーザーの質問
  │
  ▼
AgentCore Runtime（HTTPストリーミング）
  │
  ▼
Strands Agent（Claude Opus 4.8、デフォルト）
  ├─ 1. 意図の把握
  ├─ 2. 実行計画の策定
  ├─ 3. スキルロード → ツール呼び出し → 結果収集
  └─ 4. 引用付き最終回答の生成
```

### モデル選択

ユーザーはチャット入力欄で、ターンごとに使用するモデルと推論（reasoning）強度を選択できます。

- 選択可能なモデルは SSM パラメータ（`/idp-v2/chat/models`）に定義されたカタログからランタイムに読み込まれます。モデルの追加/削除は再デプロイなしにパラメータの編集だけで反映されます。
- エージェントはリクエストされた `model_id` をカタログの許可リストで検証します（フロントの選択 UI はセキュリティ境界ではありません）。許可されていないモデルはデフォルトモデルにフォールバックします。
- 推論強度（low/medium/high）は、最終的に確定したモデルが対応している場合のみ `output_config.effort` として渡されます。
- モデルを変更すると新しい会話が開始され、1 つのセッションに複数モデルの応答が混在しません。

---

## スキルシステム

エージェントは**スキル**単位で動作します。スキルは`.skills/{name}/SKILL.md`に定義されたMarkdownファイルで、エージェントがタスク実行前に読んで従う指示書です。

| スキル | 用途 | 使用ツール |
|---|---|---|
| **search** | 文書検索 + Web検索戦略 | Search MCP (graph_traverse, graph_keyword)、AgentCore Web Search |
| **dataset** | 構造化データ（Excel/CSV）Text2SQL クエリ | Data MCP (search_datasets, describe_dataset, run_sql) |
| **docx** | Word文書の作成/編集 | Code Interpreter（python-docx） |
| **xlsx** | Excelスプレッドシートの作成/編集 | Code Interpreter（openpyxl） |
| **pptx** | PowerPointの作成/編集 | Code Interpreter（python-pptx） |
| **diagram** | 構造ダイアグラムの生成 | Code Interpreter（Mermaid） |
| **chart** | データ可視化チャートの生成 | Code Interpreter（Matplotlib） |
| **qa-analysis** | QA分析管理 | QA MCP |
| **markdown** | Markdown文書の生成 | MD MCP |

### 実行フロー

```
ユーザー: 「V-101バルブの分析結果をWordにまとめて」
  │
  ├─ [1] searchスキルロード → 文書検索
  │   ├─ Search MCP（summarize）→ ベクトル + FTS検索
  │   └─ Search MCP（graph_traverse）→ エンティティ接続探索
  │
  ├─ [2] docxスキルロード → Word文書作成
  │   └─ Code Interpreter → python-docxで文書作成 → S3アップロード
  │
  └─ [3] 引用付き最終回答
      → [document_id:doc_xxxxx](s3_uri)
      → [artifact_id:art_xxxxx](filename.docx)
```

---

## MCPツール

AgentCore Gatewayを通じてアクセスするMCPツールです。

### Search MCP

| ツール | 説明 |
|---|---|
| `summarize` | ハイブリッド検索（ベクトル + FTS）→ Haiku要約、qa_idsを返却 |
| `overview` | プロジェクト文書一覧の取得 |
| `graph_traverse` | qa_idsベースのエンティティグラフ探索、関連ページの発見 |
| `graph_keyword` | キーワードベースのグラフ検索 |

### Document MCP

| ツール | 説明 |
|---|---|
| `extract_text` | PDF/DOCX/PPTXからテキスト抽出 |
| `extract_tables` | 文書内テーブルの抽出 |
| `create_document` | PDF/DOCX/PPTXの作成 |
| `edit_document` | 既存文書の編集 |

### Data MCP（構造化データ Text2SQL）

Excel/CSV から変換された Parquet データセットを SQL でクエリします。正確な集計・フィルタ・ソートが必要な構造化データに使用します。

| ツール | 説明 |
|---|---|
| `search_datasets` | プロジェクト内のデータセットを名前/説明ベースでハイブリッド検索 |
| `describe_dataset` | データセットのスキーマ・サンプル・クエリ例（リファレンス文書）の取得 |
| `run_sql` | DuckDB で Parquet データセットに read-only SQL を実行 |

### その他のMCP

| MCP | ツール | 説明 |
|---|---|---|
| Image MCP | `analyze_image` | 画像分析 |
| QA MCP | `get_document_segments` | 文書セグメントの取得 |
| QA MCP | `add_document_qa` | QA分析の追加 |
| MD MCP | `load_markdown` | Markdownの読み込み |
| MD MCP | `save_markdown` | Markdownの保存 |
| MD MCP | `edit_markdown` | Markdownの編集 |

---

## ローカルツール

Gateway を経由せず、エージェントプロセス内で直接実行されるツールです。

| ツール | 説明 |
|---|---|
| `render_chart` | 応答にインラインチャートカードをレンダリング（hbar / compare / timeline / donut / stacked / scatter）。直前のツール結果の実数値のみ使用 |
| `ask_user` | 構造化された選択質問カード（単一/複数/自由入力）を表示。ユーザーの選択は次のメッセージとして渡され、次のターンで反映 |
| `generate_image` | AI画像生成 |
| `code_interpreter` | 隔離された Python サンドボックス実行（下記参照） |

`render_chart` と `ask_user` の結果は、フロントエンドでプレーンテキストの代わりに専用 UI カードとしてレンダリングされます。

---

## Code Interpreter

AgentCore Code Interpreterは隔離されたPythonサンドボックス環境を提供します。AWS SDKが事前設定されており、S3アップロードが可能です。

エージェントがアーティファクト（文書、チャート、ダイアグラム）を生成する際に使用します。

```
Code Interpreter
  ├─ python-docx、openpyxl、python-pptx （文書生成）
  ├─ matplotlib                           （チャート）
  ├─ mermaid-py                           （ダイアグラム）
  └─ boto3                                （S3アップロード）
       → s3://{bucket}/{user_id}/{project_id}/artifacts/{artifact_id}/
```

---

## 多言語対応

DynamoDBからプロジェクトの言語設定を取得し、システムプロンプトに注入します。エージェントはその言語で応答します。
