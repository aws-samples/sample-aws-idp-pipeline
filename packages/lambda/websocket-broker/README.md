# WebSocket Broker

SQS 메시지를 읽어 WebSocket API Gateway로 전달하는 워커 Lambda입니다.

## 입력 메시지 형식

```json
{
  "username": "string | null",
  "message": {
    "action": "sessions" | "artifacts",
    "data": { ... }
  }
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `username` | `string \| null` | 대상 사용자. `null`이면 모든 연결에 브로드캐스트 |
| `message` | `Message` | WebSocket으로 전달할 메시지 (sessions, artifacts 액션) |

### Message 타입

`@idp-v2/websocket`의 [README.md](../websocket/README.md) 참조
