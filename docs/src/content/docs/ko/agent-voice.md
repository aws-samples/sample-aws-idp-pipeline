---
title: "음성 에이전트"
description: "실시간 양방향 음성 대화를 지원하는 Bidi Agent"
---

## 개요

Voice Agent(Bidi Agent)는 실시간 양방향 음성 대화를 제공하는 에이전트입니다. WebSocket을 통해 브라우저와 오디오를 스트리밍하며, Amazon Nova Sonic 모델을 사용합니다.

```
브라우저 (Web Audio API)
  │ WebSocket
  ▼
AgentCore WebSocket Proxy
  │ WebSocket
  ▼
Voice Agent Container (FastAPI + Uvicorn)
  │ Strands BidiModel
  ▼
Amazon Nova Sonic
```

---

## 음성 모델

Amazon Nova Sonic을 사용합니다. AWS 내부 네트워크를 통해 동작하므로 별도 API 키 없이 낮은 지연시간으로 음성 대화가 가능합니다.

| 항목 | 값 |
|---|---|
| **모델** | Amazon Nova Sonic |
| **API 키** | 불필요 (IAM Role) |
| **지연시간** | 낮음 (AWS 내부 네트워크) |
| **음성** | tiffany, matthew |

---

## WebSocket 이벤트

### 브라우저 → 서버

| 이벤트 | 설명 |
|---|---|
| `audio` | PCM 오디오 (16kHz, 1채널) |
| `text` | 텍스트 입력 |
| `ping` | Keep-alive (pong 응답) |
| `stop` | 세션 종료 |

### 서버 → 브라우저

| 이벤트 | 설명 |
|---|---|
| `audio` | 응답 오디오 (sample rate 포함) |
| `transcript` | 텍스트 (role, is_final 포함) |
| `tool_use` | 도구 호출 알림 |
| `tool_result` | 도구 실행 결과 |
| `connection_start` | 연결 성공 |
| `response_start` / `response_complete` | 응답 수명 주기 |
| `interruption` | 사용자가 발화 중단 |
| `error` | 오류 메시지 |
| `timeout` | 세션 타임아웃 (기본 900초) |

---

## 도구

Voice Agent도 MCP 도구를 사용할 수 있습니다.

| 도구 | 설명 |
|---|---|
| `getDateAndTimeTool` | 지정 타임존의 현재 시간 조회 |
| DuckDuckGo `search` | 웹 검색 |
| DuckDuckGo `fetch_content` | 웹 페이지 전문 조회 |
| AgentCore MCP 도구 | 문서 검색, 그래프 탐색 등 |

---

## 언어 자동 감지

브라우저의 타임존을 기반으로 선호 언어를 결정합니다.

| 타임존 | 언어 |
|---|---|
| Asia/Seoul | 한국어 |
| Asia/Tokyo | 일본어 |
| Asia/Shanghai | 중국어 |
| Europe/Paris | 프랑스어 |
| Europe/Berlin | 독일어 |
| America/Sao_Paulo | 포르투갈어 |
| 기타 | 영어 |

---

## 대화 기록 저장

대화 기록(transcript)은 S3에 저장됩니다.
