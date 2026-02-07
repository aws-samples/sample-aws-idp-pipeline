<p align="center">
  <img src="../assets/logo.png" alt="AWS IDP Logo" width="120">
</p>
<h1 align="center">Sample AWS IDP Pipeline</h1>

<p align="center">
  <strong>비정형 데이터를 위한 AI 기반 지능형 문서 처리(IDP) 프로토타입</strong>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/License-Amazon_Software_License-green.svg" alt="License">
  <img src="https://img.shields.io/badge/AWS_CDK-2.230.x-FF9900?logo=amazonaws" alt="AWS CDK">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Nx-22.x-143055?logo=nx&logoColor=white" alt="Nx">
  <img src="https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-0.123+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/AWS-Bedrock-FF9900?logo=amazon&logoColor=white" alt="Amazon Bedrock">
  <img src="https://img.shields.io/badge/AWS-Bedrock_Agent_Core-FF9900?logo=amazon&logoColor=white" alt="Bedrock AgentCore">
  <img src="https://img.shields.io/badge/Strands_Agents-1.23.x-FF9900?logo=amazon&logoColor=white" alt="Strands Agents">
</p>


<p align="center">
  <a href="../../README.md">English</a> | <strong>한국어</strong> | <a href="README_ja.md">日本語</a>
</p>

<p align="center">
  <a href="#기능">기능</a> |
  <a href="#아키텍처">아키텍처</a> |
  <a href="#시작하기">시작하기</a> |
  <a href="#배포">배포</a> |
  <a href="#지원-모델">모델</a>
</p>

---

## 개요

비정형 데이터를 실행 가능한 인사이트로 변환하는 AI 기반 IDP 프로토타입입니다. **문서, 비디오, 오디오, 이미지**를 분석하고, 하이브리드 검색(벡터 + 키워드)과 대화형 AI 인터페이스를 제공합니다. AWS CDK로 구축된 Nx 모노레포 구조이며, 실시간 워크플로우 상태 알림을 지원합니다.

> [!CAUTION]
> 개발 중인 버전입니다. 프로덕션에 배포하지 마세요.

> [!NOTE]
> 이것은 AWS 샘플 프로젝트입니다. 실험, 평가 및 개발 목적으로 설계되었습니다.

<p align="center">
  <img src="../assets/main-screen.png" alt="Main Screen" width="900">
</p>

## 기능

- **지능형 문서 처리 (IDP)**
  - Bedrock Data Automation (BDA)을 활용한 문서 분석
  - [PaddleOCR (SageMaker) 기반 OCR 처리](../ocr/OCR_ko.md)
  - AWS Transcribe를 통한 오디오/비디오 텍스트 변환
  - 파일 유형 자동 감지 및 적절한 전처리 파이프라인 라우팅

- **[AI 기반 분석](../analysis/ANALYSIS_ko.md)**
  - Claude Sonnet 4.5 Vision ReAct Agent로 세그먼트별 심층 분석
  - Claude Haiku 4.5로 문서 요약 생성
  - Nova Embed로 1024차원 벡터 임베딩

- **[하이브리드 검색](../vectordb/VECTORDB_ko.md)**
  - LanceDB 벡터 검색 + FTS(Full-Text Search)
  - Kiwi 한국어 형태소 분석기 기반 키워드 추출
  - Bedrock Cohere Rerank v3.5로 결과 재순위화

- **AI 챗봇 (Agent Core)**
  - Bedrock Agent Core 기반 IDP Agent / Research Agent
  - MCP Gateway를 통한 도구 호출 (검색, 아티팩트 관리)
  - S3 기반 세션 관리로 대화 맥락 유지

- **실시간 알림**
  - WebSocket API + ElastiCache Redis로 실시간 상태 업데이트
  - DynamoDB Streams 기반 워크플로우 이벤트 감지
  - 단계별 진행률, 아티팩트 변경, 세션 상태 실시간 반영

## 아키텍처

![Architecture](..//assets/architecture.png)

### CDK 스택 구조

```
@idp-v2/infra
├── VpcStack              - VPC (10.0.0.0/16, 2 AZ, NAT Gateway)
├── StorageStack          - S3 버킷, DynamoDB 테이블, ElastiCache Redis
├── EventStack            - S3 EventBridge, SQS 큐, 파일 유형 감지 Lambda
├── BdaStack              - Bedrock Data Automation 소비자
├── OcrStack              - PaddleOCR SageMaker 비동기 엔드포인트
├── TranscribeStack       - AWS Transcribe 소비자
├── WorkflowStack         - Step Functions 워크플로우 (Distributed Map)
├── WebsocketStack        - WebSocket API, 실시간 알림
├── WorkerStack           - WebSocket 메시지 처리
├── McpStack              - MCP Gateway (검색, 아티팩트 도구)
├── AgentStack            - Bedrock Agent Core (IDP Agent, Research Agent)
└── ApplicationStack      - Backend (ECS Fargate), Frontend (CloudFront), Cognito
```

### 핵심 워크플로우

#### 1. 문서 업로드 및 분석 파이프라인

사용자가 Presigned URL로 S3에 문서를 업로드하면, EventBridge가 ObjectCreated 이벤트를 감지합니다. Type Detection Lambda가 파일 유형을 판별하여 SQS로 라우팅하며, OCR(PaddleOCR/SageMaker)과 Transcribe는 자동 실행되고 BDA는 옵션으로 실행됩니다. 전처리 완료 후 Step Functions 워크플로우가 세그먼트 분할, AI 분석, 벡터 임베딩, 문서 요약을 순차적으로 수행합니다.

```
S3 Upload (Presigned URL)
  → EventBridge (ObjectCreated)
    → Type Detection Lambda
      ├─ OCR Queue     → PaddleOCR (SageMaker)    ── 자동 실행
      ├─ BDA Queue     → Bedrock Data Automation   ── 옵션
      └─ Transcribe Queue → AWS Transcribe          ── 자동 실행

  → Step Functions Workflow
      Segment Prep ─→ Wait for Preprocess ─→ Build Segments
        ─→ Distributed Map (max 30)
            ├─ Segment Analyzer (Claude Sonnet 4.5 Vision)
            └─ Analysis Finalizer → SQS → LanceDB Writer
        ─→ Document Summarizer (Claude Haiku 4.5)
            → Vector Embedding (Nova 1024d) → LanceDB
```

#### 2. 실시간 알림 (WebSocket)

워크플로우 진행 상태가 DynamoDB에 기록되면, DynamoDB Streams가 변경을 감지합니다. VPC 내부의 WorkflowStream Lambda가 Redis에서 활성 연결을 조회한 후 WebSocket API로 이벤트를 푸시하여, 프론트엔드에서 실시간으로 상태를 반영합니다.

```
DynamoDB Streams (상태 변경 감지)
  → WorkflowStream Lambda (VPC)
    → Redis (연결 조회)
      → WebSocket API → Frontend
        ├─ 단계별 진행률
        ├─ 아티팩트 변경
        └─ 세션 상태 업데이트
```

#### 3. AI 채팅 (Agent Core)

사용자 질문이 API Gateway를 통해 Bedrock Agent Core로 전달됩니다. IDP Agent와 Research Agent가 MCP Gateway를 통해 도구를 호출하며, Search Tool로 하이브리드 검색을 수행하고 Artifact Tool로 결과물을 관리합니다. 세션 히스토리는 S3에 저장되어 대화 맥락이 유지됩니다.

```
User Query
  → API Gateway REST (SigV4)
    → Bedrock Agent Core Runtime
      ├─ IDP Agent (Claude Sonnet 4.5)
      └─ Research Agent
          → MCP Gateway
            ├─ Search Tool Lambda → Backend API → Hybrid Search (Vector + FTS + Rerank)
            └─ Artifact Tool Lambda → S3
          → S3 (Session Load/Save)
```

#### 4. 백엔드 API (HTTP)

API Gateway HTTP(IAM 인증)에서 VPC Link를 통해 Private ALB를 거쳐 ECS Fargate의 FastAPI로 연결됩니다. 프로젝트/문서 관리, 워크플로우 조회, 하이브리드 검색, 채팅 세션, 커스텀 에이전트, 아티팩트 관리 등 모든 데이터 접근을 담당합니다.

```
API Gateway HTTP (IAM Auth)
  → VPC Link → Private ALB → ECS Fargate (FastAPI)
    ├─ DynamoDB     ── 프로젝트/문서 CRUD, 워크플로우 상태
    ├─ LanceDB      ── 하이브리드 검색 (Vector + FTS)
    ├─ Bedrock      ── Cohere Rerank v3.5
    ├─ S3           ── Presigned URL, 세션 (DuckDB), 에이전트
    ├─ Redis        ── 쿼리 캐시
    ├─ Step Functions ── 재분석 트리거
    └─ Lambda       ── QA Regenerator
```

### 주요 설계 결정

| 결정 | 이유 |
|------|------|
| Step Functions 페이로드 → DynamoDB 중간 저장소 | Step Functions 256KB 페이로드 제한 우회 |
| 세그먼트 인덱스만 워크플로우에 전달 | 3000+ 페이지 문서 지원 |
| LanceDB + S3 Express One Zone | 벡터 검색 최적화 저지연 스토리지 |
| SageMaker Auto-scaling 0→1 | 비용 최적화 (사용하지 않을 때 Scale-to-zero) |
| ElastiCache Redis | WebSocket 연결 상태 관리 (DynamoDB TTL 대비 고속) |
| DuckDB로 S3 직접 쿼리 | 세션/에이전트 데이터 복사 없이 조회 |
| VPC Link + Private ALB | 백엔드를 인터넷에 노출하지 않음 |
| Distributed Map (max 30 동시성) | Lambda 동시성 제한과 병렬성의 균형 |

## 시작하기

### 사전 요구 사항

- [Node.js](https://nodejs.org/) v18 이상
- [pnpm](https://pnpm.io/) v8 이상
- [Python](https://www.python.org/) 3.12
- [AWS CLI](https://aws.amazon.com/cli/) (자격 증명 설정 필요)
- [AWS CDK](https://aws.amazon.com/cdk/) v2
- [mise](https://mise.jdx.dev/) (태스크 관리)

### 설치

```bash
# 저장소 복제
git clone https://github.com/aws-samples/sample-aws-idp-pipeline.git
cd sample-aws-idp-pipeline

# 의존성 설치
pnpm install

# 환경 변수 설정
cp .env.local.example .env.local
# .env.local 파일을 열어 AWS 프로필과 리전 설정
```

### 로컬 개발

```bash
# 프론트엔드 개발 서버
pnpm nx serve @idp-v2/frontend

# 에이전트 로컬 실행
pnpm nx serve idp_v2.idp_agent
```

## 배포

> **Quick Deploy**: CloudShell + CodeBuild를 이용하여 단일 스크립트로 전체 파이프라인을 배포할 수 있습니다. [Quick Deploy Guide](../deployment/DEPLOYMENT_ko.md)를 참고하세요.

### mise를 사용한 배포 (권장)

```bash
# mise 설치 (macOS)
brew install mise

# 스택 선택 배포 (fzf로 선택)
mise run deploy

# 전체 빌드
pnpm build:all
```

### CDK 직접 배포

```bash
# CDK 부트스트랩 (최초 1회)
pnpm nx synth @idp-v2/infra

# 전체 배포
pnpm nx deploy @idp-v2/infra

# 핫스왑 배포 (개발용)
pnpm nx deploy @idp-v2/infra --hotswap

# 리소스 삭제
pnpm nx destroy @idp-v2/infra
```

### 주요 명령어

```bash
# 빌드
pnpm build:all                              # 전체 빌드
pnpm nx build @idp-v2/infra                 # 단일 패키지 빌드

# 테스트
pnpm nx test @idp-v2/infra                  # 테스트 실행
pnpm nx test @idp-v2/infra --update         # 스냅샷 업데이트

# 린트
pnpm nx lint @idp-v2/infra                  # 린트
pnpm nx lint @idp-v2/infra --configuration=fix  # 자동 수정
```

## 지원 모델

### AI 분석 모델

| 모델 | 용도 | 설명 |
|------|------|------|
| Claude Sonnet 4.5 | 세그먼트 분석 / 에이전트 | Vision ReAct Agent, 심층 문서 분석 |
| Claude Haiku 4.5 | 문서 요약 | 경량 모델, 빠른 요약 생성 |
| Nova Embed Text v1 | 벡터 임베딩 | 1024차원 텍스트 임베딩 |
| Cohere Rerank v3.5 | 검색 재순위 | 하이브리드 검색 결과 최적화 |

### 전처리 모델

| 모델 | 용도 | 설명 |
|------|------|------|
| PaddleOCR | OCR | SageMaker g5.xlarge, Auto-scaling 0→1 |
| Bedrock Data Automation | 문서 분석 | 비동기 문서 구조 분석 (옵션) |
| AWS Transcribe | 음성 변환 | 오디오/비디오 텍스트 변환 |

## 프로젝트 구조

```
sample-aws-idp-pipeline/
├── packages/
│   ├── agents/                    # AI 에이전트
│   │   ├── idp-agent/             # IDP Agent (Strands SDK)
│   │   └── research-agent/        # Research Agent
│   ├── backend/app/               # FastAPI 백엔드
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── ddb/                   # DynamoDB 모듈
│   │   ├── routers/               # API 라우터
│   │   └── services/              # 비즈니스 로직
│   ├── common/constructs/src/     # 재사용 CDK 구성 요소
│   ├── frontend/src/              # React SPA
│   │   ├── routes/                # 페이지 라우트
│   │   └── components/            # React 컴포넌트
│   └── infra/src/
│       ├── stacks/                # 12개 CDK 스택
│       ├── functions/             # Python Lambda 함수
│       │   ├── step-functions/    # 워크플로우 함수
│       │   ├── shared/            # 공유 모듈
│       │   ├── websocket/         # WebSocket 핸들러
│       │   └── lancedb-writer/    # LanceDB 작성기
│       └── lambda-layers/         # Lambda 레이어
├── docs/                          # 문서
└── README.md
```

## 기술 스택

### 인프라 (TypeScript)
- AWS CDK 2.230.x + Nx 22.x
- AWS Step Functions (워크플로우 오케스트레이션)
- AWS Lambda + Lambda Layers
- API Gateway HTTP / REST / WebSocket

### 백엔드 (Python)
- FastAPI (ECS Fargate, ARM64)
- LanceDB + S3 Express One Zone (벡터 스토리지)
- DynamoDB (One Table Design)
- Kiwi (한국어 형태소 분석기)
- DuckDB (S3 직접 쿼리)

### 프론트엔드 (TypeScript)
- React 19 + TanStack Router
- Tailwind CSS
- AWS SDK (S3 업로드)
- Cognito OIDC 인증
- WebSocket 클라이언트

### AI / ML
- Bedrock Agent Core (Strands SDK, ReAct 패턴)
- Bedrock Claude Sonnet 4.5 / Haiku 4.5
- Bedrock Nova Embed (1024차원)
- Bedrock Cohere Rerank v3.5
- PaddleOCR (SageMaker)
- AWS Transcribe

---

## 라이선스

이 프로젝트는 [Amazon Software License](../../LICENSE)에 따라 라이선스가 부여됩니다.
