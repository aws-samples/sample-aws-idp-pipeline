---
title: "Webクローラーエージェント"
description: "AgentCore BrowserでWebページをクローリングし、文書パイプラインに接続するエージェント"
---

## 概要

Web Crawler Agentは、Webページをクローリングしてコンテンツを抽出し、文書分析パイプラインに接続するエージェントです。AgentCore Browserで実際のブラウザを制御し、D2SnapアルゴリズムでHTMLを圧縮してLLMトークンを節約します。

```
ユーザーが.webreqファイルをアップロード
  │ EventBridge
  ▼
SQSキュー
  │
  ▼
Webcrawler Consumer Lambda
  │ bedrock-agentcore:InvokeAgentRuntime
  ▼
Web Crawler Agent（AgentCore Runtime）
  ├─ AgentCore Browser（Playwright）
  ├─ D2Snap（HTML圧縮）
  └─ S3保存（ページ単位JSON）
```

---

## 処理フロー

1. ユーザーが`.webreq`ファイル（URL + 指示事項）をS3にアップロード
2. EventBridge → SQS → Lambda ConsumerがAgentCore Runtimeを呼び出し
3. エージェントが`.webreq`ファイルをS3からダウンロードし、URLと指示事項を抽出
4. AgentCore Browserでページを探索：
   - スクリーンショット撮影（視覚的分析）
   - HTML抽出 → D2Snap圧縮
   - Markdownでコンテンツ抽出
   - `save_page`でS3に保存
   - リンク評価 → 追加ページのクローリング
5. メタデータ保存、DynamoDBステータス更新

---

## ツール

| ツール | 説明 |
|---|---|
| `browser` | ページ遷移、スクリーンショット、クリック、入力、スクロール |
| `get_compressed_html` | D2SnapでHTML圧縮後に返却 |
| `save_page` | 抽出コンテンツをページ単位JSONでS3に保存 |
| `get_current_time` | 現在時刻取得（UTC、US/Eastern、US/Pacific、Asia/Seoul） |

---

## D2Snap（HTML圧縮）

[D2Snap](https://arxiv.org/pdf/2508.04412)（DOM Downsampling for Static Page Analysis）は、HTMLから不要な要素を除去し、LLMトークン使用量を70〜90%削減します。

### 圧縮プロセス

```
元のHTML
  │
  ├─ 1. 非コンテンツ除去: <script>、<style>、<svg>、<iframe>、コメント
  ├─ 2. 非表示要素除去: aria-hidden、display:none
  ├─ 3. 属性簡素化: id、class、href、src、alt、roleなどのみ保持
  └─ 4. コンテンツ制限: テキスト500文字、リスト10項目、テーブル20行
  │
  ▼
圧縮されたHTML（70〜90%トークン削減）
```

### 分析戦略

| 戦略 | 保存対象 | 用途 |
|---|---|---|
| `content_extraction` | 見出し、段落、リスト、テーブル | コンテンツ抽出 |
| `browser_automation` | ボタン、フォーム、入力、ナビゲーション | ブラウザ自動化 |
| `hybrid` | コンテンツ + ナビゲーション + メディア | Webクローリング（デフォルト） |

---

## 入出力

### 入力（.webreq）

```json
{
  "url": "https://example.com/article",
  "instruction": "メイン記事の内容に集中（オプション）"
}
```

### 出力（S3）

```
s3://bucket/projects/{project_id}/documents/{doc_id}/
└── webcrawler/
    ├── metadata.json
    └── pages/
        ├── page_0000.json   ← { url, title, content, crawled_at }
        ├── page_0001.json
        └── page_0002.json
```

---

## DynamoDBステータス追跡

クローリングの進行状況をDynamoDBに記録します。

| PK | SK | 用途 |
|---|---|---|
| `WEB#{document_id}` | `WF#{workflow_id}` | 前処理ステータス（status、started_at、ended_at） |
| `WF#{workflow_id}` | `STEP` | ワークフローステップステータス |

---

## 制限事項

- クローリング当たり最大約20ページ
- エージェントタイムアウト：デフォルト1800秒（30分）、`AGENT_TIMEOUT_SECS`で設定可能
- Playwrightのcontextvars競合防止のため、ブラウザ操作はスレッディングロックで直列化
