---
title: "DynamoDB"
description: "One Table Design 기반 워크플로우 상태 관리"
---

## 개요

DynamoDB는 검색용 데이터베이스가 아닌 **워크플로우 상태 관리** 용도로 사용됩니다. 프로젝트, 문서, 워크플로우, 세그먼트, 분석 단계의 모든 상태를 하나의 테이블에서 관리하는 **One Table Design** 패턴을 적용했습니다.

---

## 테이블 구성

| 항목 | 값 |
|---|---|
| **과금** | On-Demand |
| **Partition Key** | `PK` (String) |
| **Sort Key** | `SK` (String) |
| **GSI1** | `GSI1PK` / `GSI1SK` |
| **GSI2** | `GSI2PK` / `GSI2SK` |
| **Stream** | NEW_AND_OLD_IMAGES |

---

## 데이터 구조

### 프로젝트 (PROJ#)

```
PK: PROJ#{project_id}
SK: META
```

| 필드 | 설명 |
|---|---|
| `data.name` | 프로젝트 이름 |
| `data.language` | 언어 (기본값: en) |
| `data.document_prompt` | 문서 분석용 커스텀 프롬프트 |
| `data.ocr_model` | OCR 모델 (기본값: pp-ocrv5) |

### 프로젝트-문서 연결 (PROJ# / DOC#)

```
PK: PROJ#{project_id}
SK: DOC#{document_id}
```

프로젝트에 속한 문서 목록을 조회할 때 `begins_with(SK, 'DOC#')`로 쿼리합니다.

### 프로젝트-워크플로우 연결 (PROJ# / WF#)

```
PK: PROJ#{project_id}
SK: WF#{workflow_id}
```

| 필드 | 설명 |
|---|---|
| `data.file_name` | 파일 이름 |
| `data.status` | 워크플로우 상태 |

### 워크플로우 메타데이터 (DOC# 또는 WEB#)

```
PK: DOC#{document_id}  (또는 WEB#{document_id})
SK: WF#{workflow_id}
```

| 필드 | 설명 |
|---|---|
| `data.project_id` | 소속 프로젝트 |
| `data.file_uri` | S3 경로 |
| `data.file_name` | 파일 이름 |
| `data.file_type` | MIME 타입 |
| `data.execution_arn` | Step Functions 실행 ARN |
| `data.status` | pending / in_progress / completed / failed |
| `data.total_segments` | 총 세그먼트 수 |
| `data.preprocess` | 전처리 단계별 상태 (ocr, bda, transcribe, webcrawler) |

### 워크플로우 단계 (WF# / STEP)

```
PK: WF#{workflow_id}
SK: STEP
GSI1PK: STEP#ANALYSIS_STATUS
GSI1SK: pending | in_progress | completed | failed
```

워크플로우의 각 처리 단계 상태를 추적합니다. GSI1을 통해 현재 분석 중인 워크플로우를 빠르게 조회합니다.

| 단계 | 설명 |
|---|---|
| `segment_prep` | 세그먼트 준비 |
| `bda_processor` | Bedrock Document Analysis |
| `format_parser` | 포맷 파싱 |
| `paddleocr_processor` | PaddleOCR 처리 |
| `transcribe` | 음성 변환 |
| `webcrawler` | 웹 크롤링 |
| `segment_builder` | 세그먼트 구성 |
| `segment_analyzer` | AI 분석 (Claude) |
| `graph_builder` | 그래프 구축 |
| `document_summarizer` | 문서 요약 |

각 단계는 `status`, `label`, `started_at`, `ended_at`, `error` 속성을 가집니다.

### 세그먼트 (WF# / SEG#)

```
PK: WF#{workflow_id}
SK: SEG#{segment_index:04d}    ← 0001, 0002, ...
```

| 필드 | 설명 |
|---|---|
| `data.segment_index` | 세그먼트 인덱스 |
| `data.s3_key` | S3 경로 (세그먼트 데이터) |
| `data.image_uri` | 이미지 URI |
| `data.image_analysis` | 이미지 분석 결과 배열 |

---

## 액세스 패턴

| 조회 | 인덱스 | 키 조건 |
|---|---|---|
| 프로젝트 문서 목록 | Primary | `PK=PROJ#{proj_id}`, `SK begins_with DOC#` |
| 프로젝트 워크플로우 목록 | Primary | `PK=PROJ#{proj_id}`, `SK begins_with WF#` |
| 워크플로우 메타데이터 | Primary | `PK=DOC#{doc_id}`, `SK=WF#{wf_id}` |
| 단계 진행 상태 | Primary | `PK=WF#{wf_id}`, `SK=STEP` |
| 세그먼트 목록 | Primary | `PK=WF#{wf_id}`, `SK begins_with SEG#` |
| 특정 세그먼트 | Primary | `PK=WF#{wf_id}`, `SK=SEG#{index}` |
| 진행 중인 분석 조회 | GSI1 | `GSI1PK=STEP#ANALYSIS_STATUS`, `GSI1SK=in_progress` |

---

## 설계 원칙

### One Table Design을 선택한 이유

- **단일 트랜잭션**: 워크플로우 생성 시 메타데이터와 단계 상태를 `batch_write`로 원자적으로 생성
- **효율적 조회**: 프로젝트의 모든 문서/워크플로우를 단일 쿼리로 조회
- **비용 절감**: 테이블 하나로 관리하여 운영 복잡도 최소화

### S3와의 역할 분담

DynamoDB는 **상태와 메타데이터**만 저장하고, **실제 데이터**(세그먼트 콘텐츠, 분석 결과)는 S3에 저장합니다.

```
DynamoDB                          S3
  ├─ 워크플로우 상태               ├─ 세그먼트 원본 데이터
  ├─ 단계별 진행 상태              ├─ 분석 결과 (JSON)
  ├─ 세그먼트 메타데이터 (s3_key)  ├─ 엔티티 추출 결과
  └─ WebSocket 연결 정보           └─ 문서 요약
```

Step Functions의 페이로드 제한(256KB)으로 인해 DynamoDB를 중간 저장소로 활용합니다. 3000페이지 이상의 문서도 세그먼트 인덱스만 전달하여 처리할 수 있습니다.
