---
title: "主要機能"
description: "Sample AWS IDP Pipeline 主要機能紹介"
---

## 1. プロジェクト管理

プロジェクト単位で文書と分析結果を管理します。

- プロジェクトの作成/編集/削除
- 言語設定（韓国語、英語、日本語）
- 文書分析プロンプトのカスタマイズ
- プロジェクトごとのカラーテーマ

<!-- ![Project Management](../assets/features-project.gif) -->

---

## 2. 文書アップロードと前処理

さまざまな形式のファイルをアップロードすると、自動的にファイルタイプを検出し、適切な前処理パイプラインにルーティングします。文書（PDF、DOC、TXT）、画像（PNG、JPG、GIF、TIFF）、映像（MP4、MOV、AVI）、音声（MP3、WAV、FLAC）ファイルを最大500MBまでサポートします。

- ドラッグ＆ドロップ / 複数ファイルアップロード
- 自動ファイルタイプ検出とパイプラインルーティング
- PaddleOCR（SageMaker）テキスト抽出
- Bedrock Data Automation 文書構造分析（オプション）
- PDFテキストレイヤー抽出（pypdf）
- 音声/映像トランスクリプション（AWS Transcribe）

> ファイルタイプ別前処理フローの詳細は[Preprocessing Pipeline](./preprocessing.md)を参照してください。

| ファイルタイプ | 対応フォーマット | 前処理 |
|---------------|-----------------|--------|
| 文書 | PDF, DOC, TXT | PaddleOCR + BDA（オプション）+ PDFテキスト抽出 |
| 画像 | PNG, JPG, GIF, TIFF | PaddleOCR + BDA（オプション） |
| 映像 | MP4, MOV, AVI | AWS Transcribe + BDA（オプション） |
| 音声 | MP3, WAV, FLAC | AWS Transcribe |

<!-- ![Document Upload](../assets/features-upload.gif) -->

---

## 3. AI分析パイプライン

アップロードされた文書はStep Functionsワークフローを通じて自動的に分析されます。Strands SDKベースのReAct Agentがセグメントごとに反復的質問-応答方式の深層分析を実行します。

- セグメントごとの深層分析（Claude Sonnet 4.6 Vision ReAct Agent）
- 映像分析（TwelveLabs Pegasus 1.2）
- 文書要約生成（Claude Haiku 4.5）
- ベクトル埋め込みと保存（Nova Embed 1024d → LanceDB）
- 再分析 / Q&A再生成 / Q&Aの追加・削除

```
文書アップロード
  → 前処理（OCR、BDA、Transcribe）
    → セグメント分割
      → Distributed Map（最大30同時実行）
        → ReAct Agent分析（セグメントごと）
          → ベクトル埋め込み → LanceDB保存
      → 文書要約生成
```

> 詳細な分析フローは[AI Analysis Pipeline](./analysis.md)を参照してください。

<!-- ![AI Analysis Pipeline](../assets/features-analysis.gif) -->

---

## 4. リアルタイム通知

ワークフローの進行状況をWebSocketを通じてリアルタイムでフロントエンドに配信します。DynamoDB Streamsが状態変更を検出し、Redisでアクティブな接続を検索してWebSocket APIでイベントをプッシュします。

- ステップごとの開始/完了/エラー通知
- セグメント分析進行率（X/Y完了）
- ワークフロー開始/完了/エラー通知
- アーティファクトおよびセッション作成イベント

<!-- ![Real-time Notifications](../assets/features-realtime.gif) -->

---

## 5. ワークフロー詳細表示

分析が完了した文書のセグメントごとの結果を詳細に確認できます。

- セグメントごとのOCR / BDA / PDFテキスト / AI分析結果の確認
- 映像セグメントのタイムコードベース表示
- トランスクリプションセグメントの確認
- Q&A再生成（カスタム指示適用）
- Q&Aの追加・削除
- 文書全体の再分析

<!-- ![Workflow Detail](../assets/features-workflow-detail.gif) -->

---

## 6. AIチャット（Agent Core）

Bedrock Agent Coreベースの対話型AIインターフェースです。IDP AgentとResearch AgentがMCP Gatewayを通じて文書検索、アーティファクト生成などのツールを活用し、プロジェクトにアップロードされた文書をもとに質疑応答を行います。

### チャット機能

- ストリーミング応答およびツール使用過程のリアルタイム表示（タイピングバッファリングで滑らかなレンダリング）
- 応答の途中停止（進行中の生成をキャンセル）
- 画像/文書添付（マルチモーダル入力）
- マークダウンレンダリングおよびコードハイライト
- セッション管理（作成/名前変更/削除、会話履歴保存）

### モデル選択

ターンごとに使用するモデルと推論（reasoning）強度を選択します。

- モデル一覧は SSM パラメータベースのカタログから読み込み（再デプロイなしで追加/削除）
- 推論強度（low/medium/high）の調整 — 対応モデルのみ
- モデル変更時は新しい会話を開始、セッションごとの最後に使用したモデルを記憶（このブラウザのみ）

### インライン可視化と質問

- **インラインチャート**: 数値回答をチャートカードでレンダリング（横棒 / 比較 / タイムライン / ドーナツ / 積み上げ / 散布図）
- **質問カード**: エージェントが構造化された質問（単一/複数/自由入力）をカードで提示し、ユーザーの選択が次のターンに反映

### ハイブリッド検索

チャット中にAI Agentが自動的にプロジェクト文書を検索します。

- ベクトル検索 + 全文検索（FTS）
- 多言語トークン化（Lindera / ICU4X）
- Cohere Rerank v3.5 結果リランキング

### カスタムエージェント

プロジェクトごとにカスタムエージェントを作成して特化した分析を実行できます。

- エージェント名とシステムプロンプトの設定
- エージェントの作成/編集/削除
- 会話中のエージェント切り替え

### MCPツール

| ツール | 説明 |
|--------|------|
| summarize / graph_traverse / graph_keyword | プロジェクト文書のハイブリッド検索・グラフ探索 |
| search_datasets / describe_dataset / run_sql | 構造化データ（Excel/CSV）Text2SQL クエリ |
| create/edit_document, extract_text/tables | 文書（PDF/DOCX/PPTX）生成およびテキスト/テーブル抽出 |
| save/load/edit_markdown | マークダウンファイルの作成・編集 |
| render_chart | インラインチャートカードのレンダリング |
| ask_user | 質問カードの表示 |
| generate_image | AI画像生成 |
| code_interpreter | Pythonコード実行 |

<!-- ![AI Chat](../assets/features-chat.gif) -->

---

## 7. アーティファクト管理

AIチャット中にエージェントが生成したファイル（PDF、DOCX、画像、マークダウンなど）をアーティファクトギャラリーで管理します。

- アーティファクトの一覧表示と検索
- インラインプレビュー（画像、PDF、マークダウン、HTML、DOCX）
- ダウンロードと削除
- プロジェクトごとのフィルタリング
- 元のプロジェクトへの移動

<!-- ![Artifacts Management](../assets/features-artifacts.gif) -->
