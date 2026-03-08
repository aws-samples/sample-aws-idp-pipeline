---
title: "IDP 에이전트"
description: "문서 검색, 분석, 아티팩트 생성을 담당하는 메인 에이전트"
---

## 개요

IDP Agent는 사용자와의 대화를 통해 문서를 검색하고 분석하며, 결과물(아티팩트)을 생성하는 메인 에이전트입니다. Strands SDK의 ReAct 패턴으로 동작하며, MCP 도구와 Code Interpreter를 결합하여 복합적인 작업을 수행합니다.

```
사용자 질문
  │
  ▼
AgentCore Runtime (HTTP 스트리밍)
  │
  ▼
Strands Agent (Claude Opus 4.6)
  ├─ 1. 의도 파악
  ├─ 2. 실행 계획 수립
  ├─ 3. 스킬 로딩 → 도구 호출 → 결과 수집
  └─ 4. 인용 포함 최종 응답 생성
```

---

## 스킬 시스템

에이전트는 **스킬** 단위로 동작합니다. 스킬은 `.skills/{name}/SKILL.md`에 정의된 마크다운 파일로, 에이전트가 작업 수행 전에 읽고 따르는 지침입니다.

| 스킬 | 용도 | 사용 도구 |
|---|---|---|
| **search** | 문서 검색 + 웹 검색 전략 | Search MCP, Graph MCP, DuckDuckGo |
| **docx** | Word 문서 생성/편집 | Code Interpreter (python-docx) |
| **xlsx** | Excel 스프레드시트 생성/편집 | Code Interpreter (openpyxl) |
| **pptx** | PowerPoint 생성/편집 | Code Interpreter (python-pptx) |
| **diagram** | 구조 다이어그램 생성 | Code Interpreter (Mermaid) |
| **chart** | 데이터 시각화 차트 생성 | Code Interpreter (Matplotlib) |
| **qa-analysis** | QA 분석 관리 | QA MCP |
| **markdown** | 마크다운 문서 생성 | MD MCP |

### 실행 흐름

```
사용자: "V-101 밸브의 분석 결과를 Word로 정리해줘"
  │
  ├─ [1] search 스킬 로딩 → 문서 검색
  │   ├─ Search MCP (summarize) → 벡터 + FTS 검색
  │   └─ Graph MCP (graph_search) → 엔티티 연결 탐색
  │
  ├─ [2] docx 스킬 로딩 → Word 문서 생성
  │   └─ Code Interpreter → python-docx로 문서 작성 → S3 업로드
  │
  └─ [3] 인용 포함 최종 응답
      → [document_id:doc_xxxxx](s3_uri)
      → [artifact_id:art_xxxxx](filename.docx)
```

---

## MCP 도구

AgentCore Gateway를 통해 접근하는 MCP 도구입니다.

### Search MCP

| 도구 | 설명 |
|---|---|
| `summarize` | 하이브리드 검색 (벡터 + FTS) → Haiku 요약, qa_ids 반환 |
| `overview` | 프로젝트 문서 목록 조회 |

### Graph MCP

| 도구 | 설명 |
|---|---|
| `graph_search` | qa_ids 기반 엔티티 그래프 탐색, 관련 페이지 발견 |
| `link_documents` | 문서 간 연결 생성 |
| `unlink_documents` | 문서 간 연결 해제 |

### Document MCP

| 도구 | 설명 |
|---|---|
| `extract_text` | PDF/DOCX/PPTX 텍스트 추출 |
| `extract_tables` | 문서 내 테이블 추출 |
| `create_document` | PDF/DOCX/PPTX 생성 |
| `edit_document` | 기존 문서 편집 |

### 기타 MCP

| MCP | 도구 | 설명 |
|---|---|---|
| Image MCP | `analyze_image` | 이미지 분석 |
| QA MCP | `get_document_segments` | 문서 세그먼트 조회 |
| QA MCP | `add_document_qa` | QA 분석 추가 |
| MD MCP | `load_markdown` | 마크다운 로드 |
| MD MCP | `save_markdown` | 마크다운 저장 |
| MD MCP | `edit_markdown` | 마크다운 편집 |

---

## Code Interpreter

AgentCore Code Interpreter는 격리된 Python 샌드박스 환경을 제공합니다. AWS SDK가 사전 구성되어 있어 S3 업로드가 가능합니다.

에이전트가 아티팩트(문서, 차트, 다이어그램)를 생성할 때 사용합니다.

```
Code Interpreter
  ├─ python-docx, openpyxl, python-pptx  (문서 생성)
  ├─ matplotlib                           (차트)
  ├─ mermaid-py                           (다이어그램)
  └─ boto3                                (S3 업로드)
       → s3://{bucket}/{user_id}/{project_id}/artifacts/{artifact_id}/
```

---

## 다국어 지원

DynamoDB에서 프로젝트의 언어 설정을 조회하여 시스템 프롬프트에 주입합니다. 에이전트는 해당 언어로 응답합니다.
