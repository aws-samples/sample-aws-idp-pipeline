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
Strands Agent（Claude Opus 4.6）
  ├─ 1. 意図の把握
  ├─ 2. 実行計画の策定
  ├─ 3. スキルロード → ツール呼び出し → 結果収集
  └─ 4. 引用付き最終回答の生成
```

---

## スキルシステム

エージェントは**スキル**単位で動作します。スキルは`.skills/{name}/SKILL.md`に定義されたMarkdownファイルで、エージェントがタスク実行前に読んで従う指示書です。

| スキル | 用途 | 使用ツール |
|---|---|---|
| **search** | 文書検索 + Web検索戦略 | Search MCP、Graph MCP、DuckDuckGo |
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
  │   └─ Graph MCP（graph_search）→ エンティティ接続探索
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

### Graph MCP

| ツール | 説明 |
|---|---|
| `graph_search` | qa_idsベースのエンティティグラフ探索、関連ページの発見 |
| `link_documents` | 文書間リンクの作成 |
| `unlink_documents` | 文書間リンクの解除 |

### Document MCP

| ツール | 説明 |
|---|---|
| `extract_text` | PDF/DOCX/PPTXからテキスト抽出 |
| `extract_tables` | 文書内テーブルの抽出 |
| `create_document` | PDF/DOCX/PPTXの作成 |
| `edit_document` | 既存文書の編集 |

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
