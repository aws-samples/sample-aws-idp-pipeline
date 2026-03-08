---
title: "音声エージェント"
description: "リアルタイム双方向音声会話をサポートするBidi Agent"
---

## 概要

Voice Agent（Bidi Agent）は、リアルタイム双方向音声会話を提供するエージェントです。WebSocketを通じてブラウザとオーディオをストリーミングし、Amazon Nova Sonicモデルを使用します。

```
ブラウザ（Web Audio API）
  │ WebSocket
  ▼
AgentCore WebSocket Proxy
  │ WebSocket
  ▼
Voice Agentコンテナ（FastAPI + Uvicorn）
  │ Strands BidiModel
  ▼
Amazon Nova Sonic
```

---

## 音声モデル

Amazon Nova Sonicを使用します。AWS内部ネットワークを通じて動作するため、別途APIキーなしで低レイテンシの音声会話が可能です。

| 項目 | 値 |
|---|---|
| **モデル** | Amazon Nova Sonic |
| **APIキー** | 不要（IAM Role） |
| **レイテンシ** | 低（AWS内部ネットワーク） |
| **音声** | tiffany、matthew |

---

## WebSocketイベント

### ブラウザ → サーバー

| イベント | 説明 |
|---|---|
| `audio` | PCMオーディオ（16kHz、1チャンネル） |
| `text` | テキスト入力 |
| `ping` | Keep-alive（pongで応答） |
| `stop` | セッション終了 |

### サーバー → ブラウザ

| イベント | 説明 |
|---|---|
| `audio` | 応答オーディオ（サンプルレート付き） |
| `transcript` | テキスト（role、is_final付き） |
| `tool_use` | ツール呼び出し通知 |
| `tool_result` | ツール実行結果 |
| `connection_start` | 接続成功 |
| `response_start` / `response_complete` | 応答ライフサイクル |
| `interruption` | ユーザーが発話を中断 |
| `error` | エラーメッセージ |
| `timeout` | セッションタイムアウト（デフォルト900秒） |

---

## ツール

Voice AgentもMCPツールを使用できます。

| ツール | 説明 |
|---|---|
| `getDateAndTimeTool` | 指定タイムゾーンの現在時刻を取得 |
| DuckDuckGo `search` | Web検索 |
| DuckDuckGo `fetch_content` | Webページ全文取得 |
| AgentCore MCPツール | 文書検索、グラフ探索など |

---

## 言語自動検出

ブラウザのタイムゾーンに基づいて優先言語を決定します。

| タイムゾーン | 言語 |
|---|---|
| Asia/Seoul | 韓国語 |
| Asia/Tokyo | 日本語 |
| Asia/Shanghai | 中国語 |
| Europe/Paris | フランス語 |
| Europe/Berlin | ドイツ語 |
| America/Sao_Paulo | ポルトガル語 |
| その他 | 英語 |

---

## 会話記録の保存

会話記録（トランスクリプト）はS3に保存されます。
