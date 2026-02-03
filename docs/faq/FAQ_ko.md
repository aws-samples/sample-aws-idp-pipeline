<h1 align="center">FAQ</h1>

<p align="center">
  <strong>자주 묻는 질문</strong>
</p>

<p align="center">
  <a href="FAQ_en.md">English</a> | <strong>한국어</strong> | <a href="FAQ_ja.md">日本語</a>
</p>

---

## 배포

### 배포 시 비용이 발생하나요?

네, AWS 리소스 사용에 따라 비용이 발생합니다. 주요 과금 리소스는 다음과 같습니다.

| 리소스 | 설명 |
|--------|------|
| NAT Gateway | VPC 외부 통신 (시간당 + 데이터 전송) |
| ECS Fargate | FastAPI 백엔드 컨테이너 (vCPU + 메모리) |
| ElastiCache Redis | WebSocket 연결 관리 |
| S3 / S3 Express One Zone | 문서 저장, 벡터 DB, 세션, 아티팩트 |
| SageMaker Endpoint | PaddleOCR (ml.g5.xlarge, 사용 시에만 스케일업) |
| Bedrock | 모델 호출 건당 과금 (입출력 토큰) |
| Step Functions | 워크플로우 실행 건당 상태 전이 과금 |
| DynamoDB | 읽기/쓰기 용량 단위 |

> **참고**: SageMaker 엔드포인트는 기본적으로 0→1 오토스케일링이 설정되어 있어, 미사용 시 인스턴스가 0으로 축소됩니다.

### 배포에 실패했습니다. 어떻게 해야 하나요?

[Quick Deploy Guide - 문제 해결](../deployment/DEPLOYMENT_ko.md#문제-해결) 섹션을 참고하세요. CodeBuild 로그를 통해 실패 원인을 확인할 수 있습니다.

```bash
aws logs tail /aws/codebuild/sample-aws-idp-pipeline-deploy --since 10m
```

---

## 인프라

### SageMaker 엔드포인트를 상시 유지하려면?

기본 설정은 오토스케일링 0→1로, 미사용 시 10분 후 인스턴스가 0으로 축소됩니다. 상시 유지하려면 최소 인스턴스 수를 변경합니다.

**AWS Console에서 변경:**

1. **SageMaker Console** > **Inference** > **Endpoints** 에서 엔드포인트 선택
2. **Endpoint runtime settings** 탭에서 variant 선택 후 **Update scaling policy** 클릭
3. **Minimum instance count**를 `1`로 변경

> **주의**: ml.g5.xlarge 인스턴스를 상시 유지하면 시간당 비용이 지속적으로 발생합니다.

### 분석에 사용되는 AI 모델을 변경하려면?

워크플로우 분석 모델은 `packages/infra/src/models.json`에서 관리됩니다.

```json
{
  "analysis": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "summarizer": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "embedding": "amazon.nova-2-multimodal-embeddings-v1:0",
  "videoAnalysis": "us.twelvelabs.pegasus-1-2-v1:0"
}
```

| 키 | 용도 | Lambda 환경변수 |
|----|------|-----------------|
| `analysis` | 세그먼트 분석, Q&A 재생성 | `BEDROCK_MODEL_ID` |
| `summarizer` | 문서 요약 | `SUMMARIZER_MODEL_ID` |
| `embedding` | 벡터 임베딩 | `EMBEDDING_MODEL_ID` |
| `videoAnalysis` | 영상 분석 | `BEDROCK_VIDEO_MODEL_ID` |

**방법 1: models.json 수정 후 재배포 (권장)**

```bash
# models.json 수정 후
pnpm nx deploy @idp-v2/infra
```

**방법 2: Lambda 환경변수 직접 수정**

재배포 없이 즉시 변경하려면 Lambda Console에서 환경변수를 수정합니다.

1. **Lambda Console** > 해당 함수 선택 (예: `IDP-V2-*-SegmentAnalyzer`)
2. **Configuration** > **Environment variables** > **Edit**
3. 환경변수 값 수정 후 **Save**

> **주의**: Lambda 환경변수를 직접 수정하면 다음 CDK 배포 시 models.json 값으로 덮어쓰여집니다.

---

## 문서 처리

### 지원하는 파일 형식은 무엇인가요?

문서(PDF, DOC, TXT), 이미지(PNG, JPG, GIF, TIFF), 영상(MP4, MOV, AVI), 음성(MP3, WAV, FLAC) 파일을 최대 500MB까지 지원합니다.

| 파일 타입 | 지원 포맷 | 전처리 |
|-----------|-----------|--------|
| 문서 | PDF, DOC, TXT | PaddleOCR + BDA (선택) + PDF 텍스트 추출 |
| 이미지 | PNG, JPG, GIF, TIFF | PaddleOCR + BDA (선택) |
| 영상 | MP4, MOV, AVI | AWS Transcribe + BDA (선택) |
| 음성 | MP3, WAV, FLAC | AWS Transcribe |

### 대용량 문서(수천 페이지)도 처리할 수 있나요?

네. Step Functions + DynamoDB 기반의 세그먼트 처리 방식으로 대용량 문서를 지원합니다. Step Functions 페이로드 제한(256KB)을 우회하기 위해 DynamoDB를 중간 저장소로 사용하며, Distributed Map을 통해 최대 30개 세그먼트를 동시에 분석합니다.

### OCR 엔진은 어떤 것을 사용하나요? 차이점은?

| OCR 엔진 | 설명 |
|----------|------|
| **PaddleOCR** | SageMaker에서 실행되는 오픈소스 OCR. 80개 이상 언어 지원. 텍스트 추출에 최적화 |
| **Bedrock Data Automation (BDA)** | AWS 관리형 서비스. 문서 구조(테이블, 양식 등)를 함께 분석. 프로젝트 설정에서 선택 가능 |

> 상세 내용은 [PaddleOCR on SageMaker](../ocr/OCR_ko.md)를 참고하세요.

### 영상/음성 파일은 어떻게 분석되나요?

1. **AWS Transcribe**가 음성을 텍스트로 변환합니다
2. 영상의 경우 **TwelveLabs Pegasus 1.2**가 시각적 내용을 분석합니다
3. 트랜스크립션 + 시각 분석 결과를 결합하여 세그먼트를 생성합니다
4. ReAct Agent가 각 세그먼트를 심층 분석합니다

---

## AI 분석

### 분석 결과가 부정확하면 어떻게 하나요?

여러 수준에서 결과를 수정할 수 있습니다.

- **Q&A 재생성**: 특정 세그먼트의 Q&A를 커스텀 지시사항과 함께 재생성
- **Q&A 추가/삭제**: 개별 Q&A 항목을 수동으로 추가하거나 삭제
- **전체 재분석**: 문서 전체를 새로운 지시사항으로 재분석

### 문서 분석 프롬프트를 커스터마이징할 수 있나요?

네. 프로젝트 설정에서 문서 분석 프롬프트를 수정할 수 있습니다. 이 프롬프트는 ReAct Agent가 세그먼트를 분석할 때 사용됩니다. 프로젝트의 도메인이나 분석 목적에 맞게 커스터마이징하면 더 정확한 결과를 얻을 수 있습니다.

### 어떤 AI 모델을 사용하나요?

| 모델 | 용도 |
|------|------|
| **Claude Sonnet 4.5** | 세그먼트 분석 (Vision ReAct Agent), AI 채팅 |
| **Claude Haiku 4.5** | 문서 요약 |
| **Amazon Nova Embed Text v1** | 벡터 임베딩 (1024d) |
| **TwelveLabs Pegasus 1.2** | 영상 분석 |
| **Cohere Rerank v3.5** | 검색 결과 리랭킹 |

---

## AI 채팅

### 채팅에서 문서 내용을 기반으로 답변하나요?

네. AI Agent가 MCP 도구를 통해 프로젝트에 업로드된 문서를 자동으로 검색합니다. 벡터 검색과 전문 검색(FTS)을 결합한 하이브리드 검색을 수행하고, Cohere Rerank로 결과를 재정렬하여 가장 관련성 높은 내용을 기반으로 답변합니다.

### 커스텀 에이전트는 무엇인가요?

프로젝트별로 시스템 프롬프트를 설정한 맞춤 에이전트를 생성할 수 있습니다. 예를 들어, 법률 문서 분석 전용 에이전트, 기술 문서 요약 전용 에이전트 등을 만들어 사용할 수 있습니다. 대화 중에 에이전트를 전환할 수도 있습니다.

### 에이전트가 사용할 수 있는 도구는 무엇인가요?

| 도구 | 설명 |
|------|------|
| search_documents | 프로젝트 문서 하이브리드 검색 |
| save/load/edit_markdown | 마크다운 파일 생성 및 편집 |
| create_pdf, extract_pdf_text/tables | PDF 생성 및 텍스트/테이블 추출 |
| create_docx, extract_docx_text/tables | Word 문서 생성 및 텍스트/테이블 추출 |
| generate_image | AI 이미지 생성 |
| code_interpreter | Python 코드 실행 |

### 채팅에 이미지나 문서를 첨부할 수 있나요?

네. 채팅 입력창에 이미지나 문서를 첨부하여 멀티모달 입력을 사용할 수 있습니다. AI Agent가 첨부된 파일의 내용을 분석하여 답변합니다.

---

## 보안

### 인증은 어떻게 처리되나요?

Amazon Cognito OIDC 인증을 사용합니다. 프론트엔드에서 Cognito를 통해 로그인하면 JWT 토큰이 발급되고, 백엔드 API 호출 시 토큰이 자동으로 포함됩니다. MCP 도구 호출은 IAM SigV4 인증을 사용합니다.

### 데이터는 어디에 저장되나요?

| 데이터 | 저장소 |
|--------|--------|
| 원본 파일, 세그먼트 이미지 | Amazon S3 |
| 벡터 임베딩, 검색 인덱스 | LanceDB (S3 Express One Zone) |
| 프로젝트/워크플로우 메타데이터 | Amazon DynamoDB |
| 채팅 세션, 에이전트 프롬프트, 아티팩트 | Amazon S3 |
| WebSocket 연결 정보 | Amazon ElastiCache Redis |

### LanceDB 데이터를 직접 확인할 수 있나요?

LanceDB는 S3 Express One Zone에 저장되어 직접 접근이 어렵습니다. CloudShell에서 Lambda를 통해 조회할 수 있습니다.

**테이블 목록 조회**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "list_tables", "params": {}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**특정 프로젝트 레코드 수 조회**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "count", "params": {"project_id": "YOUR_PROJECT_ID"}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**특정 워크플로우의 세그먼트 조회**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "get_segments", "params": {"project_id": "YOUR_PROJECT_ID", "workflow_id": "YOUR_WORKFLOW_ID"}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

**검색 (하이브리드: 벡터 + 키워드)**

```bash
aws lambda invoke --function-name idp-v2-lancedb-service \
    --payload '{"action": "search", "params": {"project_id": "YOUR_PROJECT_ID", "query": "검색어", "limit": 5}}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>/dev/null | jq .
```

---

## 라이선스

이 프로젝트는 [Amazon Software License](../../LICENSE)의 하에 라이선스됩니다.
