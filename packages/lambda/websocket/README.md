# Valkey Keys

## 키 구조

| Key | Type | Description |
|-----|------|-------------|
| `ws:conn:{connectionId}` | String | connectionId → userSub 매핑 |
| `ws:user:{userSub}` | Set | userSub → connectionId(s) 매핑 |

## 사용 방법

### Connect (저장)

```typescript
await valkey.set(KEYS.conn(connectionId), userSub);
await valkey.sadd(KEYS.user(userSub), connectionId);
```

### 조회

```typescript
// userSub로 모든 connectionId 가져오기
const connectionIds = await valkey.smembers(KEYS.user(userSub));

// connectionId로 userSub 가져오기
const userSub = await valkey.get(KEYS.conn(connectionId));

// 모든 connectionId 가져오기
const keys = await valkey.scanAll({ match: 'ws:conn:*' });
const connectionIds = keys.map(k => k.replace('ws:conn:', ''));
```

### Disconnect (삭제)

```typescript
const userSub = await valkey.get(KEYS.conn(connectionId));
await valkey.del(KEYS.conn(connectionId));

if (userSub) {
  await valkey.srem(KEYS.user(userSub), connectionId);
}
```
