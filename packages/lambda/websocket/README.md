# WebSocket Messages

## Actions

### sessions

세션 생성/수정/삭제 이벤트

```json
{
  "action": "sessions",
  "data": {
    "event": "created" | "updated" | "deleted",
    "sessionId": "string",
    "sessionName": "string",
    "timestamp": "string (ISO 8601)"
  }
}
```

### artifacts

아티팩트 생성/수정/삭제 이벤트

```json
{
  "action": "artifacts",
  "data": {
    "event": "created" | "updated" | "deleted",
    "artifactId": "string",
    "artifactFileName": "string",
    "timestamp": "string (ISO 8601)"
  }
}
```

---

# Valkey Keys

## 키 구조

| Key | Type | Description |
|-----|------|-------------|
| `ws:conn:{connectionId}` | String | connectionId → `{userSub}:{username}` 매핑 |
| `ws:username:{username}` | Set | username → connectionId(s) 매핑 |

## 사용 방법

### Connect (저장)

```typescript
await valkey.set(KEYS.conn(connectionId), `${userSub}:${username}`);
await valkey.sadd(KEYS.username(username), connectionId);
```

### 조회

```typescript
// username으로 모든 connectionId 가져오기
const connectionIds = await valkey.smembers(KEYS.username(username));

// connectionId로 userSub, username 가져오기
const value = await valkey.get(KEYS.conn(connectionId));
const [userSub, username] = value?.split(':') ?? [];

// 모든 connectionId 가져오기
const keys = await valkey.scanAll({ match: 'ws:conn:*' });
const connectionIds = keys.map(k => k.replace('ws:conn:', ''));
```

### Disconnect (삭제)

```typescript
const value = await valkey.get(KEYS.conn(connectionId));
await valkey.del(KEYS.conn(connectionId));

if (value) {
  const [, username] = value.split(':');
  await valkey.srem(KEYS.username(username), connectionId);
}
```
