---
title: "エージェント概要"
description: "Strands SDKベースのAIエージェントアーキテクチャと役割"
---

## エージェント構成

このプロジェクトは3つの独立したAIエージェントで構成されています。各エージェントは[Strands SDK](https://github.com/strands-agents/sdk-python)をベースに構築され、AWS Bedrock AgentCoreで実行されます。

| エージェント | 役割 | モデル | インターフェース |
|---|---|---|---|
| **IDP Agent** | 文書分析、検索、アーティファクト生成 | Claude Opus 4.6 | HTTPストリーミング |
| **Voice Agent** | リアルタイム双方向音声会話 | Nova Sonic | WebSocket |
| **Web Crawler Agent** | Webページクローリングとコンテンツ抽出 | Claude Sonnet 4.6 | SQSトリガー |

## 共通アーキテクチャ

```
ユーザーリクエスト
  │
  ▼
AWS Bedrock AgentCore
  │
  ├─ AgentCore Runtime（ECSコンテナ）
  │   └─ Strands Agent
  │       ├─ LLM（Bedrock）
  │       ├─ MCPツール（AgentCore Gateway）
  │       └─ 組み込みツール（Strands SDK）
  │
  ├─ MCP Gateway（IAM SigV4認証）
  │   ├─ Search MCP（LanceDBハイブリッド検索）
  │   ├─ Graph MCP（Neptuneグラフ探索）
  │   ├─ Image MCP（画像分析）
  │   ├─ QA MCP（QA分析管理）
  │   └─ Document MCP（PDF/DOCX/PPTX/MD）
  │
  └─ Code Interpreter（Pythonサンドボックス）
```

### MCP（Model Context Protocol）

エージェントはMCPを通じて外部ツールにアクセスします。AgentCore GatewayがMCPサーバーをホスティングし、各エージェントはSigV4で認証されたHTTP接続を通じてツールを呼び出します。

すべてのMCPツール呼び出し時に`user_id`と`project_id`が自動注入され、ユーザー間のデータ分離が保証されます。

### セッション管理

IDP AgentとVoice Agentは会話履歴をS3に保存します。

```
s3://session-storage-bucket/
└── sessions/
    └── {user_id}/
        └── {project_id}/
            └── {session_id}/
```

---

## エージェント詳細

- [IDP Agent](/agent-idp) — 文書検索、分析、アーティファクト生成（DOCX/XLSX/PPTX/チャート/ダイアグラム）
- [Voice Agent](/agent-voice) — Nova Sonicベースのリアルタイム音声会話
- [Web Crawler Agent](/agent-webcrawler) — AgentCore BrowserベースのWebクローリング、D2Snap HTML圧縮
