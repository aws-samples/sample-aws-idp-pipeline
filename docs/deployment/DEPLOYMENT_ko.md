<h1 align="center">Quick Deploy Guide</h1>

<p align="center">
  <strong>CloudShell + CodeBuild를 이용한 원클릭 배포</strong>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/AWS-CloudShell-FF9900?logo=amazonaws&logoColor=white" alt="CloudShell">
  <img src="https://img.shields.io/badge/AWS-CodeBuild-FF9900?logo=amazonaws&logoColor=white" alt="CodeBuild">
  <img src="https://img.shields.io/badge/Time-40--60_min-blue" alt="Deploy Time">
</p>

<p align="center">
  <a href="DEPLOYMENT_en.md">English</a> | <strong>한국어</strong> | <a href="DEPLOYMENT_ja.md">日本語</a>
</p>

---

## 개요

AWS CloudShell에서 단일 스크립트(`deploy.sh`)를 실행하여 전체 IDP 파이프라인을 자동 배포합니다. 스크립트는 CloudFormation으로 CodeBuild 프로젝트를 생성하고, CodeBuild가 CDK를 통해 12개 스택을 순차적으로 배포합니다.

```
deploy.sh 실행 (CloudShell)
  → CloudFormation 스택 생성
    → CodeBuild 프로젝트 프로비저닝
      → CDK Bootstrap
        → VPC 스택 배포
          → 나머지 11개 스택 병렬 배포 (concurrency=4)
            → Cognito 관리자 계정 생성
```

---

## 사전 준비

### 리전 확인

다음 리전에서 배포를 권장합니다:

| 리전 | 설명 |
|------|------|
| **us-east-1** (N. Virginia) | 모든 모델 지원 |
| **us-west-2** (Oregon) | 모든 모델 지원 |

---

## 배포 단계

### Step 1. CloudShell 열기

AWS Console 상단의 CloudShell 아이콘을 클릭하거나, 검색창에 "CloudShell"을 입력하여 접속합니다.

<p align="center">
  <img src="../assets/quick-deploy-cloudshell.png" alt="CloudShell" width="800">
</p>

### Step 2. 배포 스크립트 실행

```bash
git clone https://github.com/aws-samples/sample-aws-idp-pipeline.git
cd sample-aws-idp-pipeline
chmod +x ./deploy.sh
./deploy.sh
```

### Step 3. 관리자 이메일 입력

스크립트가 실행되면 관리자 계정용 이메일 주소를 입력합니다. 이 이메일로 Cognito 사용자가 생성됩니다.

```
===========================================================================
  Sample AWS IDP Pipeline - Automated Deployment
---------------------------------------------------------------------------
  Deploys the full IDP pipeline via CodeBuild.

  Stacks: Vpc, Storage, Event, Bda, Ocr, Transcribe, Workflow,
          Websocket, Worker, Mcp, Agent, Application
===========================================================================

Enter admin user email address: your-email@example.com
```

### Step 4. 설정 확인 및 배포 시작

입력한 설정을 확인하고 `y`를 입력하여 배포를 시작합니다.

```
Configuration:
--------------
Admin Email: your-email@example.com
Repository:  https://github.com/aws-samples/sample-aws-idp-pipeline.git
Version:     main
Stack Name:  sample-aws-idp-pipeline-codebuild

Do you want to proceed with deployment? (y/N): y
```

배포가 시작되면 다음 단계가 자동으로 실행됩니다:

1. CloudFormation 템플릿 다운로드 및 검증
2. CodeBuild 프로젝트 생성 (CloudFormation)
3. CodeBuild 빌드 시작
4. CDK Bootstrap (최초 1회)
5. 12개 스택 순차/병렬 배포
6. Cognito 관리자 계정 생성

---

## 배포 모니터링

### CloudShell에서 확인

스크립트가 CodeBuild 빌드 진행 상태를 실시간으로 표시합니다.

```
Starting CodeBuild: sample-aws-idp-pipeline-deploy ...
Build ID: sample-aws-idp-pipeline-deploy:xxxxxxxx

You can monitor progress in the AWS Console:
  CodeBuild > Build projects > sample-aws-idp-pipeline-deploy

Phase: BUILD
```

### CodeBuild Console에서 확인

더 상세한 로그를 확인하려면 AWS Console에서 CodeBuild 프로젝트를 직접 확인할 수 있습니다.

> **AWS Console** > **CodeBuild** > **Build projects** > **sample-aws-idp-pipeline-deploy**

<p align="center">
  <img src="../assets/quick-deploy-codebuild.png" alt="CodeBuild Console" width="800">
</p>

### CodeBuild 빌드 단계

| 단계 | 내용 | 예상 시간 |
|------|------|-----------|
| INSTALL | Node.js 22, Python 3.13, pnpm, CDK, Docker QEMU 설정 | 2-3분 |
| PRE_BUILD | 소스 클론, 의존성 설치 (`pnpm install`) | 3-5분 |
| BUILD | Lint, Compile, Test, Bundle + CDK 배포 (12개 스택) | 30-50분 |
| POST_BUILD | Cognito 관리자 계정 생성, URL 출력 | 1분 |

---

## 배포 완료

배포가 성공적으로 완료되면 다음과 같은 정보가 표시됩니다.

```
===========================================================================
  Deployment Successful
===========================================================================

  Application URL: https://dxxxxxxxxxx.cloudfront.net

  Login Credentials:
     Email:              your-email@example.com
     Temporary Password: TempPass123!

  Next Steps:
     1. Access the application using the URL above
     2. Log in with the credentials
     3. Change your password when prompted

  To destroy all resources:
     aws cloudformation delete-stack --stack-name sample-aws-idp-pipeline-codebuild

===========================================================================
```

### 접속 및 로그인

1. **Application URL**에 접속합니다
2. 이메일의 `@` 앞 부분이 사용자명입니다 (예: `your-email@example.com` → `your-email`)
3. 임시 비밀번호 `TempPass123!`으로 로그인합니다
4. 최초 로그인 시 비밀번호 변경이 요구됩니다

<p align="center">
  <img src="../assets/quick-deploy-login.png" alt="Login Screen" width="800">
</p>

---

## 고급 옵션

### 명령행 옵션

```bash
bash deploy.sh [OPTIONS]

Options:
  --admin-email EMAIL   관리자 이메일 (대화형 입력 생략)
  --repo-url URL        리포지토리 URL (기본: github.com/aws-samples/...)
  --version VERSION     배포할 브랜치 또는 태그 (기본: main)
  --stack-name NAME     CloudFormation 스택 이름 (기본: sample-aws-idp-pipeline-codebuild)
  --info                배포된 애플리케이션 URL 조회
  --help                도움말 표시
```

### 배포 URL 재확인

```bash
bash deploy.sh --info
```

### 특정 버전 배포

```bash
bash deploy.sh --admin-email user@example.com --version v1.0.0
```

---

## 리소스 삭제

### destroy.sh 실행

배포된 모든 리소스를 삭제하려면 `destroy.sh` 스크립트를 실행합니다. 배포와 동일하게 CodeBuild를 통해 12개 스택을 역순으로 삭제합니다.

```bash
cd sample-aws-idp-pipeline
chmod +x ./destroy.sh
./destroy.sh
```

```
===========================================================================
  Sample AWS IDP Pipeline - Automated Destroy
---------------------------------------------------------------------------
  Destroys all IDP pipeline resources via CodeBuild.

  Stacks: Application, Agent, Mcp, Worker, Websocket, Workflow,
          Transcribe, Bda, Ocr, Event, Storage, Vpc
===========================================================================

WARNING: This will permanently delete all IDP pipeline resources.

Do you want to proceed with destroy? (y/N): y
```

삭제가 완료되면 destroy용 CodeBuild 스택도 자동으로 정리됩니다.

### 삭제 실패 시

일부 리소스가 삭제되지 않는 경우가 있습니다 (예: S3 버킷에 데이터가 남아있는 경우, ENI가 아직 사용 중인 경우 등). 이 경우:

1. **AWS Console** > **CloudFormation**에서 `DELETE_FAILED` 상태의 스택을 확인합니다
2. 해당 스택의 **Events** 탭에서 실패 원인을 확인합니다
3. 문제가 되는 리소스를 수동으로 삭제한 후, CloudFormation에서 스택을 다시 삭제합니다

> **참고**: `CDKToolkit` 스택은 향후 재배포를 위해 보존됩니다. 완전히 제거하려면 `aws cloudformation delete-stack --stack-name CDKToolkit`을 실행하세요.

---

## 문제 해결

### CloudShell 세션 타임아웃

CloudShell은 20분간 미사용 시 세션이 종료됩니다. 배포 스크립트 실행 후 CodeBuild가 시작되면, CloudShell 세션이 종료되더라도 CodeBuild 빌드는 계속 진행됩니다. CodeBuild Console에서 진행 상태를 확인할 수 있습니다.

### CodeBuild 빌드 실패

빌드 실패 시 로그를 확인합니다:

```bash
# 최근 빌드 로그 확인
aws logs tail /aws/codebuild/sample-aws-idp-pipeline-deploy --since 10m
```

### 일반적인 실패 원인

| 원인 | 해결 방법 |
|------|-----------|
| Bedrock 모델 액세스 미활성화 | Bedrock Console에서 필요한 모델의 액세스를 활성화 |
| 서비스 할당량 초과 | AWS Support에서 할당량 증가 요청 |
| CDK Bootstrap 실패 | `aws cloudformation delete-stack --stack-name CDKToolkit` 후 재배포 |
| VPC 한도 초과 | 사용하지 않는 VPC를 삭제하거나 할당량 증가 요청 |

---

## 배포 아키텍처

```
CloudShell
  │
  ├─ deploy.sh
  │   ├─ CloudFormation Template 다운로드 (deploy-codebuild.yml)
  │   ├─ CloudFormation Stack 생성
  │   │   └─ CodeBuild Project (IAM Role: PowerUserAccess + IAM)
  │   └─ CodeBuild Build 시작
  │
  └─ CodeBuild (BUILD_GENERAL1_LARGE, amazonlinux 5.0)
      ├─ INSTALL:    Node.js 22, Python 3.13, pnpm, CDK, Docker QEMU (ARM64)
      ├─ PRE_BUILD:  git clone → pnpm install
      ├─ BUILD:      lint + test + bundle → CDK deploy (12 stacks)
      └─ POST_BUILD: Cognito admin user 생성
```

---

## 라이선스

이 프로젝트는 [Amazon Software License](../../LICENSE)의 하에 라이선스됩니다.
