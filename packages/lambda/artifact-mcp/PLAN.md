# Artifact MCP 구현 계획

## 개요

LLM이 생성한 파일(문서, 이미지 등)을 S3에 저장하고 관리하는 MCP Tool을 제공한다.

## 아키텍처

```
[LLM Agent] --MCP call--> [artifact-mcp Lambda] ---> [S3 + DynamoDB]
                                                          |
[Frontend] <--API--- [Backend] <--query------------------+
```

## MCP Tools

### 1. save_artifact

아티팩트를 S3에 저장하고 메타데이터를 DynamoDB에 기록한다.

**Input:**
```json
{
  "project_id": "string (required)",
  "filename": "string (required)",
  "content": "string (required, base64 encoded for binary, plain text for text)",
  "content_type": "string (required, MIME type: image/png, text/markdown, etc.)",
  "encoding": "string (optional, 'base64' | 'text', default: 'text')"
}
```

**Output:**
```json
{
  "artifact_id": "string (UUID)",
  "s3_key": "string",
  "url": "string (presigned URL or CloudFront URL)",
  "created_at": "string (ISO 8601)"
}
```

### 2. load_artifact

LLM이 기존 아티팩트를 참조할 때 사용한다.

**Input:**
```json
{
  "project_id": "string (required)",
  "artifact_id": "string (required)"
}
```

**Output:**
```json
{
  "artifact_id": "string",
  "filename": "string",
  "content_type": "string",
  "content": "string (base64 for binary, plain text for text)",
  "encoding": "string ('base64' | 'text')",
  "created_at": "string (ISO 8601)"
}
```

## 저장소 설계

### S3 Key 구조

**버킷:** 기존 document-storage-bucket 사용

```
projects/{project_id}/artifacts/{artifact_id}.{ext}
```

예시:
```
projects/proj_abc123/artifacts/art_001.md
projects/proj_abc123/artifacts/art_002.png
```

원본 filename은 DynamoDB 메타데이터에 저장.

### DynamoDB 테이블 스키마

**테이블명:** `idp-artifacts`

| 속성 | 타입 | 설명 |
|------|------|------|
| PK | String | `PROJECT#{project_id}` |
| SK | String | `ARTIFACT#{artifact_id}` |
| artifact_id | String | UUID |
| project_id | String | 프로젝트 ID |
| filename | String | 파일명 |
| content_type | String | MIME 타입 |
| s3_key | String | S3 키 |
| s3_bucket | String | S3 버킷명 |
| file_size | Number | 파일 크기 (bytes) |
| created_at | String | 생성 시간 (ISO 8601) |

**GSI:** 필요시 `artifact_id`로 조회하는 GSI 추가

## 구현 파일 구조

```
packages/lambda/artifact-mcp/
├── package.json
├── tsconfig.json
├── project.json
├── schema.json          # MCP tool 스키마 정의
├── src/
│   ├── index.ts         # Lambda 핸들러
│   ├── env.d.ts         # 환경변수 타입
│   ├── s3.ts            # S3 업로드 로직
│   └── dynamodb.ts      # DynamoDB 메타데이터 저장
└── PLAN.md              # 이 문서
```

## 환경 변수

| 변수명 | 설명 |
|--------|------|
| ARTIFACT_BUCKET | 아티팩트 저장 S3 버킷명 |
| ARTIFACT_TABLE | DynamoDB 테이블명 |
| URL_EXPIRATION | Presigned URL 만료 시간 (초) |

## 의존성

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-dynamodb": "^3.x",
    "@aws-sdk/lib-dynamodb": "^3.x",
    "@aws-sdk/s3-request-presigner": "^3.x"
  }
}
```

## Backend API (별도 구현 필요)

### 1. GET /projects/{project_id}/artifacts

프로젝트의 아티팩트 목록을 조회한다.

**Response:**
```json
{
  "artifacts": [
    {
      "artifact_id": "art_xyz789",
      "filename": "report.md",
      "content_type": "text/markdown",
      "url": "https://... (presigned URL)",
      "file_size": 1024,
      "created_at": "2025-01-21T12:00:00Z"
    }
  ]
}
```

### 2. GET /projects/{project_id}/artifacts/{artifact_id}

특정 아티팩트의 상세 정보 및 다운로드 URL을 조회한다.

**Response:**
```json
{
  "artifact_id": "art_xyz789",
  "filename": "report.md",
  "content_type": "text/markdown",
  "url": "https://... (presigned URL)",
  "file_size": 1024,
  "created_at": "2025-01-21T12:00:00Z"
}
```

### 3. DELETE /projects/{project_id}/artifacts/{artifact_id}

아티팩트를 삭제한다.

**Response:**
```json
{
  "deleted": true
}
```

## 인프라 변경 사항

1. S3 버킷 생성 또는 기존 버킷 사용 결정
2. DynamoDB 테이블 생성
3. Lambda 함수 배포
4. AgentCore Gateway에 MCP 등록

## 구현 순서

1. [ ] package.json, tsconfig.json, project.json 생성
2. [ ] schema.json (MCP tool 스키마) 작성
3. [ ] DynamoDB 클라이언트 구현 (dynamodb.ts)
4. [ ] S3 업로드 및 presigned URL 생성 구현 (s3.ts)
5. [ ] Lambda 핸들러 구현 (index.ts)
6. [ ] 인프라 코드 추가 (CDK)
7. [ ] Backend 아티팩트 목록 API 추가
8. [ ] 테스트
