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
Strands Agent (Claude Opus 4.8, 기본값)
  ├─ 1. 의도 파악
  ├─ 2. 실행 계획 수립
  ├─ 3. 스킬 로딩 → 도구 호출 → 결과 수집
  └─ 4. 인용 포함 최종 응답 생성
```

### 모델 선택

사용자는 채팅 입력창에서 턴마다 사용할 모델과 추론(reasoning) 강도를 선택할 수 있습니다.

- 선택 가능한 모델은 SSM 파라미터(`/idp-v2/chat/models`)에 정의된 카탈로그에서 런타임에 로드됩니다. 모델 추가/제거는 재배포 없이 파라미터 수정만으로 반영됩니다.
- 에이전트는 요청된 `model_id`를 카탈로그 허용 목록으로 검증합니다(프론트 선택 UI는 보안 경계가 아님). 허용되지 않은 모델은 기본 모델로 대체됩니다.
- 추론 강도(low/medium/high)는 최종 확정된 모델이 지원할 때만 `output_config.effort`로 전달됩니다.
- 모델을 변경하면 새 대화가 시작되어 한 세션에 여러 모델 응답이 섞이지 않습니다.

---

## 스킬 시스템

에이전트는 **스킬** 단위로 동작합니다. 스킬은 `.skills/{name}/SKILL.md`에 정의된 마크다운 파일로, 에이전트가 작업 수행 전에 읽고 따르는 지침입니다.

| 스킬 | 용도 | 사용 도구 |
|---|---|---|
| **search** | 문서 검색 + 웹 검색 전략 | Search MCP (graph_traverse, graph_keyword), AgentCore Web Search |
| **dataset** | 정형 데이터(엑셀/CSV) Text2SQL 질의 | Data MCP (search_datasets, describe_dataset, run_sql) |
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
  │   └─ Search MCP (graph_traverse) → 엔티티 연결 탐색
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
| `graph_traverse` | qa_ids 기반 엔티티 그래프 탐색, 관련 페이지 발견 |
| `graph_keyword` | 키워드 기반 그래프 검색 |

### Document MCP

| 도구 | 설명 |
|---|---|
| `extract_text` | PDF/DOCX/PPTX 텍스트 추출 |
| `extract_tables` | 문서 내 테이블 추출 |
| `create_document` | PDF/DOCX/PPTX 생성 |
| `edit_document` | 기존 문서 편집 |

### Data MCP (정형 데이터 Text2SQL)

엑셀/CSV에서 변환된 Parquet 데이터셋을 SQL로 질의합니다. 정확한 집계·필터·정렬이 필요한 정형 데이터에 사용합니다.

| 도구 | 설명 |
|---|---|
| `search_datasets` | 프로젝트 내 데이터셋을 이름/설명 기반으로 하이브리드 검색 |
| `describe_dataset` | 데이터셋의 스키마·샘플·쿼리 예시(레퍼런스 문서) 조회 |
| `run_sql` | DuckDB로 Parquet 데이터셋에 read-only SQL 실행 |

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

## 로컬 도구

Gateway를 거치지 않고 에이전트 프로세스에서 직접 실행되는 도구입니다.

| 도구 | 설명 |
|---|---|
| `render_chart` | 응답에 인라인 차트 카드를 렌더링 (hbar / compare / timeline / donut / stacked / scatter). 직전 도구 결과의 실제 수치만 사용 |
| `ask_user` | 구조화된 선택 질문 카드(단일/복수/자유 입력)를 표시. 사용자의 선택은 다음 메시지로 전달되어 다음 턴에 반영 |
| `generate_image` | AI 이미지 생성 |
| `code_interpreter` | 격리된 Python 샌드박스 실행 (아래 참고) |

`render_chart`와 `ask_user`의 결과는 프론트엔드에서 일반 텍스트 대신 전용 UI 카드로 렌더링됩니다.

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
