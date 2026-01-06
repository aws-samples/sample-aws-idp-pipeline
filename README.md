# idp-v2

## Prerequisites

### mise

이 프로젝트는 [mise](https://mise.jdx.dev/)를 사용하여 task를 관리합니다.

```bash
# mise 설치 (macOS)
brew install mise
```

### 환경 설정

`.env.local.example`을 참고하여 `.env.local` 파일을 생성합니다.

```bash
cp .env.local.example .env.local
```

`.env.local` 파일을 열어 AWS 프로필과 리전을 설정합니다.

## Tasks

### deploy

CDK 스택을 배포합니다. 실행 시 fzf를 통해 스택을 선택할 수 있습니다.

```bash
mise run deploy
```
