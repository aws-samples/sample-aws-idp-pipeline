---
title: "데이터베이스 개요"
description: "벡터 검색과 그래프 탐색을 결합한 이유와 검색 아키텍처"
---

## 배경

이 프로젝트는 문서를 **페이지 단위로 분석**합니다. 각 페이지는 독립된 세그먼트로 분리되어 AI 분석을 거치고, 그 결과가 벡터 임베딩으로 저장됩니다. 이 구조에서 벡터 검색만으로는 해결하기 어려운 문제가 있습니다.

### 페이지 간 연결의 단절

100페이지짜리 설계 도면이 있다고 가정합니다. 도면 하나가 2페이지에 걸쳐 있으면, 벡터 검색은 각 페이지를 독립적으로 취급합니다. "밸브 V-101의 사양"을 검색하면 42페이지는 나오지만, 이어지는 43페이지는 내용이 달라 검색에서 누락될 수 있습니다.

```
벡터 검색만 사용할 때:

검색: "밸브 V-101 사양"
  → 42페이지 (V-101 도면 전반부) ✓ 검색됨
  → 43페이지 (V-101 도면 후반부) ✗ 내용이 달라 누락
  → 78페이지 (V-101 유지보수 기록) ✗ 유사도 낮아 누락
```

문서가 수십 건일 때는 큰 문제가 아니지만, 수백~수천 건의 문서가 쌓이면 벡터 유사도만으로는 연관 페이지를 빠짐없이 찾기 어렵습니다.

### 그래프 단독 검색의 한계

그래프 데이터베이스만으로 검색하는 방식도 고려했습니다. 엔티티(V-101, 밸브, 유지보수 등)와 관계를 추출하여, 엔티티 연결을 따라가면 관련 페이지를 모두 발견할 수 있습니다.

```
그래프만 사용할 때:

검색: "밸브 V-101 사양"
  → Entity "V-101" 탐색
    → 42페이지 (MENTIONED_IN) ✓
    → 43페이지 (MENTIONED_IN) ✓
    → 78페이지 (RELATES_TO → "유지보수" → MENTIONED_IN) ✓
```

연결된 페이지는 잘 찾지만, 문제가 있었습니다:
- **시멘틱 검색 불가**: "밸브 사양"처럼 정확한 엔티티명이 아닌 자연어 질문에 약함
- **엔티티 추출 품질 의존**: LLM이 엔티티를 누락하면 그래프에 연결이 없음
- **FTS 없음**: 그래프 DB는 전문 검색을 지원하지 않음

### 벡터 + 그래프 결합

두 방식의 강점을 조합하여 이 문제를 해결합니다:

```
결합 검색:

[1단계] 벡터 검색 (LanceDB)
  검색: "밸브 V-101 사양"
  → 42페이지 (score: 0.92) ✓
  → 15페이지 (score: 0.71) ✓  ← 시멘틱 유사도로 발견

[2단계] 그래프 탐색 (Neptune)
  시작점: 42페이지의 QA ID → 엔티티 "V-101" 탐색
  → 43페이지 (V-101 → MENTIONED_IN) ✓  ← 이어지는 페이지 발견
  → 78페이지 (V-101 → RELATES_TO → "유지보수" → MENTIONED_IN) ✓
  → 이미 찾은 42페이지는 제외 (중복 방지)
```

벡터 검색이 의미적으로 관련된 페이지를 찾고, 그래프 탐색이 엔티티 연결을 따라 벡터 검색이 놓친 페이지를 보완합니다.

---

## 검색 아키텍처

에이전트는 MCP 도구를 통해 두 데이터베이스를 순차적으로 사용합니다.

```
사용자 질문: "밸브 V-101의 사양과 유지보수 이력을 알려줘"
  │
  ▼
[1] MCP Search Tool (summarize)
  │  → LanceDB hybrid_search (벡터 + FTS)
  │  → Haiku 요약
  │  → 결과: 42페이지, 15페이지 (qa_ids 포함)
  │
  ▼
[2] MCP Graph Tool (graph_search)
  │  → 입력: qa_ids (벡터 검색에서 얻은 QA ID)
  │  → Neptune: QA ID → Analysis → Entity → RELATES_TO → Entity → Analysis → Segment
  │  → LanceDB: 발견된 세그먼트의 본문 조회 (get_by_segment_ids)
  │  → Haiku 요약
  │  → 결과: 43페이지, 78페이지 (벡터 검색에 없던 페이지)
  │
  ▼
[3] 에이전트가 두 결과를 종합하여 최종 응답 생성
```

### 핵심 연결점: Entity

두 데이터베이스를 연결하는 핵심은 **Entity**입니다. 같은 엔티티를 공유하는 Analysis 노드를 통해 관련 페이지를 발견합니다.

- **QA ID** (`{workflow_id}_{segment_index}_{qa_index}`): 각 문서 세그먼트별로 분석된 결과의 식별자
- **LanceDB**: QA 분석 결과를 `qa_id`로 저장, 벡터 검색 결과에 `qa_id`를 반환
- **Neptune**: 같은 `qa_id`를 Analysis 노드의 `id`로 사용, Entity가 `MENTIONED_IN`으로 연결

```
LanceDB (qa_id: wf_abc_0042_00)
  ↕ 동일한 ID
Neptune (Analysis {id: wf_abc_0042_00})
  ── MENTIONED_IN → Entity ("V-101", EQUIPMENT) ← MENTIONED_IN ── Analysis {id: wf_abc_0078_00}
                                                                      ↕ 동일한 ID
                                                                    LanceDB (qa_id: wf_abc_0078_00)
```

같은 엔티티 "V-101"이 여러 Analysis 노드에서 언급되므로, 엔티티를 공유하는 것만으로 관련 페이지를 발견할 수 있습니다.

---

## 역할 분담

| | LanceDB (벡터 DB) | Neptune (그래프 DB) |
|---|---|---|
| **저장 대상** | QA 분석 텍스트 + 벡터 임베딩 | 엔티티, 관계, 문서 구조 |
| **검색 방식** | 하이브리드 (벡터 + FTS) | 그래프 순회 (openCypher) |
| **강점** | 자연어 질문, 의미 유사도 | 엔티티 간 연결, 관계 탐색 |
| **약점** | 페이지 간 연결 인식 불가 | 시멘틱 검색 불가, FTS 없음 |
| **검색 순서** | 1단계 (시작점) | 2단계 (확장) |
| **스토리지** | S3 Express One Zone | Neptune Serverless (VPC) |
| **비용 모델** | S3 요금만 (서버리스) | NCU 기반 (min 1, max 2.5) |

---

## 데이터 흐름

문서가 업로드되면 두 데이터베이스에 동시에 데이터가 구축됩니다.

```
Step Functions Workflow
  │
  ├─ Map (세그먼트별 병렬, max 30)
  │   ├─ SegmentAnalyzer: AI 분석 (Claude Sonnet 4.5)
  │   └─ AnalysisFinalizer:
  │       ├─ SQS → LanceDB Writer → LanceDB Service
  │       │   → 키워드 추출 (Kiwi) + 벡터 임베딩 (Nova) + 저장
  │       └─ 엔티티/관계 추출 (Strands Agent) → S3에 저장
  │
  ├─ GraphBuilder:
  │   └─ S3에서 엔티티 수집 → 중복 제거 → GraphService → Neptune 저장
  │
  └─ DocumentSummarizer: 문서 요약 생성
```

AnalysisFinalizer에서 벡터 임베딩과 엔티티 추출이 세그먼트별로 병렬 실행되므로, 대량 문서도 효율적으로 처리됩니다. GraphBuilder는 Map 완료 후 실행되어 전체 엔티티를 수집하고 중복을 제거한 뒤 Neptune에 저장합니다.

---

## 하위 페이지

- [Vector Database](/vectordb) — LanceDB, S3 Express One Zone, Kiwi 한국어 형태소 분석, 하이브리드 검색
- [Graph Database](/graphdb) — Neptune DB Serverless, openCypher, 엔티티 추출, 그래프 탐색
- [DynamoDB](/dynamodb) — One Table Design, 워크플로우 상태 관리, 세그먼트 메타데이터
