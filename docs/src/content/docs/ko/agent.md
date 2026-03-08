---
title: "에이전트 개요"
description: "Strands SDK 기반 AI 에이전트 아키텍처와 역할"
---

## 에이전트 구성

이 프로젝트는 3개의 독립된 AI 에이전트로 구성됩니다. 각 에이전트는 [Strands SDK](https://github.com/strands-agents/sdk-python) 기반으로 구축되어 AWS Bedrock AgentCore에서 실행됩니다.

| 에이전트 | 역할 | 모델 | 인터페이스 |
|---|---|---|---|
| **IDP Agent** | 문서 분석, 검색, 아티팩트 생성 | Claude Opus 4.6 | HTTP 스트리밍 |
| **Voice Agent** | 실시간 양방향 음성 대화 | Nova Sonic | WebSocket |
| **Web Crawler Agent** | 웹 페이지 크롤링 및 콘텐츠 추출 | Claude Sonnet 4.6 | SQS 트리거 |

## 공통 아키텍처

```
사용자 요청
  │
  ▼
AWS Bedrock AgentCore
  │
  ├─ AgentCore Runtime (ECS 컨테이너)
  │   └─ Strands Agent
  │       ├─ LLM (Bedrock)
  │       ├─ MCP 도구 (AgentCore Gateway)
  │       └─ 내장 도구 (Strands SDK)
  │
  ├─ MCP Gateway (IAM SigV4 인증)
  │   ├─ Search MCP (LanceDB 하이브리드 검색)
  │   ├─ Graph MCP (Neptune 그래프 탐색)
  │   ├─ Image MCP (이미지 분석)
  │   ├─ QA MCP (QA 분석 관리)
  │   └─ Document MCP (PDF/DOCX/PPTX/MD)
  │
  └─ Code Interpreter (Python 샌드박스)
```

### MCP (Model Context Protocol)

에이전트는 MCP를 통해 외부 도구에 접근합니다. AgentCore Gateway가 MCP 서버를 호스팅하며, 각 에이전트는 SigV4로 인증된 HTTP 연결을 통해 도구를 호출합니다.

모든 MCP 도구 호출 시 `user_id`와 `project_id`가 자동 주입되어, 사용자 간 데이터 격리가 보장됩니다.

### 세션 관리

IDP Agent와 Voice Agent는 대화 이력을 S3에 저장합니다.

```
s3://session-storage-bucket/
└── sessions/
    └── {user_id}/
        └── {project_id}/
            └── {session_id}/
```

---

## 에이전트별 상세

- [IDP Agent](/agent-idp) — 문서 검색, 분석, 아티팩트 생성 (DOCX/XLSX/PPTX/차트/다이어그램)
- [Voice Agent](/agent-voice) — Nova Sonic 기반 실시간 음성 대화
- [Web Crawler Agent](/agent-webcrawler) — AgentCore Browser 기반 웹 크롤링, D2Snap HTML 압축
