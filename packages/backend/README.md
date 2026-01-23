# idp_v2.backend

Project description here.

## DynamoDB Query Patterns

Backend Table은 Single Table Design을 사용합니다.

### Table Structure

| Index | Partition Key | Sort Key |
|-------|---------------|----------|
| Primary | PK | SK |
| GSI1 | GSI1PK | GSI1SK |
| GSI2 | GSI2PK | GSI2SK |

### Entity Patterns

#### Project

| 속성 | 값 | 용도 |
|------|-----|------|
| PK | `PROJ#{project_id}` | 단일 프로젝트 조회 |
| SK | `META` | - |
| GSI1PK | `PROJECTS` | 전체 프로젝트 목록 |
| GSI1SK | `{created_at}` | 시간순 정렬 |

**쿼리 패턴:**
- 단일 프로젝트 조회: `PK = PROJ#{project_id}, SK = META`
- 전체 프로젝트 목록: `GSI1PK = PROJECTS` (시간순 정렬)

#### Document

| 속성 | 값 | 용도 |
|------|-----|------|
| PK | `PROJ#{project_id}` | 프로젝트 기준 조회 |
| SK | `DOC#{document_id}` | 단일 문서 조회 |
| GSI1PK | `PROJ#{project_id}#DOC` | 프로젝트별 문서 목록 |
| GSI1SK | `{created_at}` | 시간순 정렬 |

**쿼리 패턴:**
- 단일 문서 조회: `PK = PROJ#{project_id}, SK = DOC#{document_id}`
- 프로젝트별 문서 목록: `GSI1PK = PROJ#{project_id}#DOC` (시간순 정렬)

#### Workflow

| 속성 | 값 | 용도 |
|------|-----|------|
| PK | `DOC#{document_id}` | 문서 기준 조회 |
| SK | `WF#{workflow_id}` | 단일 워크플로우 조회 |

**쿼리 패턴:**
- 단일 워크플로우 조회: `PK = DOC#{document_id}, SK = WF#{workflow_id}`
- 문서별 워크플로우 목록: `PK = DOC#{document_id}, SK begins_with WF#`

#### Segment

| 속성 | 값 | 용도 |
|------|-----|------|
| PK | `WF#{workflow_id}` | 워크플로우 기준 조회 |
| SK | `SEG#{segment_index}` | 단일 세그먼트 조회 |

**쿼리 패턴:**
- 단일 세그먼트 조회: `PK = WF#{workflow_id}, SK = SEG#{segment_index}`
- 워크플로우별 세그먼트 목록: `PK = WF#{workflow_id}, SK begins_with SEG#`

#### Artifact

| 속성 | 값 | 용도 |
|------|-----|------|
| PK | `ART#{artifact_id}` | 단일 아티팩트 조회 |
| SK | `META` | - |
| GSI1PK | `USR#{user_id}#ART` | 유저별 아티팩트 목록 |
| GSI1SK | `{created_at}` | 시간순 정렬 |
| GSI2PK | `USR#{user_id}#PROJ#{project_id}#ART` | 유저별 프로젝트별 아티팩트 목록 |
| GSI2SK | `{created_at}` | 시간순 정렬 |

**쿼리 패턴:**
- 단일 아티팩트 조회: `PK = ART#{artifact_id}, SK = META`
- 유저별 아티팩트 목록: `GSI1PK = USR#{user_id}#ART` (시간순 정렬)
- 유저별 프로젝트별 아티팩트 목록: `GSI2PK = USR#{user_id}#PROJ#{project_id}#ART` (시간순 정렬)

## Cache

[Valkey](https://valkey.io/) (ElastiCache)를 사용하여 캐싱을 구현합니다. 캐시 클라이언트는 [glide-for-redis](https://github.com/valkey-io/valkey-glide)를 사용합니다.

### 구성

- `elasticache_endpoint` 설정이 있을 경우 TLS를 사용하여 클러스터에 연결합니다.
- 엔드포인트가 설정되지 않은 경우 캐시를 사용하지 않고 원본 함수를 직접 호출합니다.

### 캐시 키

| 키 | 대상 함수 | TTL |
|---|---|---|
| `query_projects` | `query_projects` | 3600초 (1시간) |
| `session_list:{user_id}:{project_id}` | `query_sessions` | 3600초 (1시간) |

### 캐시 무효화

`invalidate(key)` 함수를 호출하여 특정 키의 캐시를 무효화할 수 있습니다.

| 키 | 무효화 시점 |
|---|---|
| `query_projects` | 프로젝트 생성/수정/삭제 시 |
| `session_list:{user_id}:{project_id}` | 세션 수정/삭제 시 |
