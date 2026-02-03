# Research Agent

IDP Research Agent - 문서 리서치 및 프레젠테이션 생성 에이전트

## 환경 변수

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `AWS_REGION` | O | AWS 리전 |
| `SESSION_STORAGE_BUCKET_NAME` | O | 세션 저장용 S3 버킷 |
| `AGENT_STORAGE_BUCKET_NAME` | O | 아티팩트 저장용 S3 버킷 |
| `MCP_GATEWAY_URL` | O | MCP Gateway URL |
| `UNSPLASH_ACCESS_KEY` | X | Unsplash API 키 (이미지 검색용) |

## 외부 서비스 설정

### Unsplash API (선택)

PPT 생성 시 이미지 검색 기능을 사용하려면 Unsplash API 키가 필요합니다.

#### 1. API 키 발급

1. https://unsplash.com/developers 접속
2. 계정 생성 또는 로그인
3. "New Application" 클릭
4. 약관 동의 후 앱 생성
5. "Access Key" 복사

#### 2. SSM Parameter Store에 저장

```bash
aws ssm put-parameter \
  --name "/idp-v2/external-service/unsplash/access-key" \
  --value "YOUR_UNSPLASH_ACCESS_KEY" \
  --type "SecureString" \
  --region us-east-1
```

#### 3. 확인

```bash
aws ssm get-parameter \
  --name "/idp-v2/external-service/unsplash/access-key" \
  --with-decryption \
  --region us-east-1
```

#### Rate Limits

- Demo: 50 requests/hour
- Production 승인 후: 5,000 requests/hour

Production 승인은 Unsplash Developer 대시보드에서 신청할 수 있습니다.
