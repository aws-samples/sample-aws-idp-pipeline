---
title: "웹 크롤러 에이전트"
description: "AgentCore Browser로 웹 페이지를 크롤링하여 문서 파이프라인에 연결하는 에이전트"
---

## 개요

Web Crawler Agent는 웹 페이지를 크롤링하여 콘텐츠를 추출하고, 문서 분석 파이프라인에 연결하는 에이전트입니다. AgentCore Browser로 실제 브라우저를 제어하며, D2Snap 알고리즘으로 HTML을 압축하여 LLM 토큰을 절약합니다.

```
사용자가 .webreq 파일 업로드
  │ EventBridge
  ▼
SQS 큐
  │
  ▼
Webcrawler Consumer Lambda
  │ bedrock-agentcore:InvokeAgentRuntime
  ▼
Web Crawler Agent (AgentCore Runtime)
  ├─ AgentCore Browser (Playwright)
  ├─ D2Snap (HTML 압축)
  └─ S3 저장 (페이지별 JSON)
```

---

## 처리 흐름

1. 사용자가 `.webreq` 파일(URL + 지시사항)을 S3에 업로드
2. EventBridge → SQS → Lambda Consumer가 AgentCore Runtime 호출
3. 에이전트가 `.webreq` 파일을 S3에서 다운로드하여 URL과 지시사항 추출
4. AgentCore Browser로 페이지 탐색:
   - 스크린샷 촬영 (시각적 분석)
   - HTML 추출 → D2Snap 압축
   - 마크다운으로 콘텐츠 추출
   - `save_page`로 S3에 저장
   - 링크 평가 → 추가 페이지 크롤링
5. 메타데이터 저장, DynamoDB 상태 업데이트

---

## 도구

| 도구 | 설명 |
|---|---|
| `browser` | 페이지 이동, 스크린샷, 클릭, 입력, 스크롤 |
| `get_compressed_html` | D2Snap으로 HTML 압축 후 반환 |
| `save_page` | 추출된 콘텐츠를 S3에 페이지별 JSON으로 저장 |
| `get_current_time` | 현재 시간 조회 (UTC, US/Eastern, US/Pacific, Asia/Seoul) |

---

## D2Snap (HTML 압축)

[D2Snap](https://arxiv.org/pdf/2508.04412)(DOM Downsampling for Static Page Analysis)은 HTML에서 불필요한 요소를 제거하여 LLM 토큰 사용량을 70~90% 절감합니다.

### 압축 과정

```
원본 HTML
  │
  ├─ 1. 비콘텐츠 제거: <script>, <style>, <svg>, <iframe>, 주석
  ├─ 2. 숨김 요소 제거: aria-hidden, display:none
  ├─ 3. 속성 간소화: id, class, href, src, alt, role 등만 유지
  └─ 4. 콘텐츠 제한: 텍스트 500자, 리스트 10항목, 테이블 20행
  │
  ▼
압축된 HTML (70~90% 토큰 절감)
```

### 분석 전략

| 전략 | 보존 대상 | 용도 |
|---|---|---|
| `content_extraction` | 제목, 문단, 리스트, 테이블 | 콘텐츠 추출 |
| `browser_automation` | 버튼, 폼, 입력, 네비게이션 | 브라우저 자동화 |
| `hybrid` | 콘텐츠 + 네비게이션 + 미디어 | 웹 크롤링 (기본값) |

---

## 입출력

### 입력 (.webreq)

```json
{
  "url": "https://example.com/article",
  "instruction": "메인 기사 내용에 집중 (선택사항)"
}
```

### 출력 (S3)

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

## DynamoDB 상태 추적

크롤링 진행 상태를 DynamoDB에 기록합니다.

| PK | SK | 용도 |
|---|---|---|
| `WEB#{document_id}` | `WF#{workflow_id}` | 전처리 상태 (status, started_at, ended_at) |
| `WF#{workflow_id}` | `STEP` | 워크플로우 단계 상태 |

---

## 제한사항

- 크롤링 당 최대 약 20페이지
- 에이전트 타임아웃: 기본 1800초 (30분), `AGENT_TIMEOUT_SECS`로 설정 가능
- Playwright contextvars 충돌 방지를 위해 브라우저 작업은 스레딩 락으로 직렬화
