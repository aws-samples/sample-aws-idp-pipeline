# WebSocket 실시간 메시지 아키텍처

프론트엔드는 **앱 전역에 단 하나의 WebSocket 연결**을 유지하며, 백엔드의 여러 이벤트 소스가 이 연결을 통해 실시간 메시지를 push한다. 이 문서는 연결 관리, 메시지 전달 경로, 메시지 종류(action), 연결 상태 저장소(Valkey)를 정리한다.

## 1. 전역 연결은 1개

WebSocket 연결은 `WebSocketProvider`가 관리하며, 라우터(`App`)보다 상위에 위치하므로 **앱 생명주기 동안 단일 연결이 유지**된다. 페이지(라우트)를 이동해도 재연결되지 않는다.

```
RuntimeConfigProvider
  └ CognitoAuth
      └ WebSocketProvider   ← 전역 WebSocket 연결 (단일)
          └ ToastProvider
              └ App (router)
```

- 정의: `packages/frontend/src/main.tsx:41-53`
- Provider 구현: `packages/frontend/src/contexts/WebSocketContext.tsx`
  - 소켓 인스턴스는 `wsRef` 하나로 보관 (`WebSocketContext.tsx:48`)
  - `useAuth()`의 `id_token`과 `websocketUrl`이 준비되면 자동 연결 (`WebSocketContext.tsx:252-260`)
  - 인증: Cognito Identity Pool → AWS 자격 증명 → SigV4 서명 URL (`createSignedWebSocketUrl`, `lib/websocket-signer.ts`)
  - 안정화: 지수 백오프 재연결(최대 5회), 30초 하트비트(ping), 탭 가시성 복귀 시 재연결

### 구독(pub/sub) 방식

컴포넌트/훅은 개별 소켓을 만들지 않고 전역 연결을 **action 단위로 구독**한다.

```ts
// 특정 action 메시지 구독
useWebSocketMessage('workflow', handleWorkflowMessage);

// 프로젝트 진입 시 서버측 라우팅 대상으로 자기 연결을 등록
sendMessage({ action: 'subscribe', projectId });
```

- 구독 API: `useWebSocket()` / `useWebSocketMessage(action, cb)` (`WebSocketContext.tsx:301-319`)
- 수신 메시지는 `action`별로 등록된 콜백에만 분배 (`WebSocketContext.tsx:183-187`)

## 2. 메시지 전달 경로는 2개

프론트로 메시지를 push하는 서버측 경로는 두 가지다. 둘 다 최종적으로 API Gateway WebSocket의 `PostToConnection`으로 나간다.

```
[경로 A] DynamoDB Stream 기반 (자동)
  BackendTable Stream ──filter──▶ WorkflowStream Lambda ──▶ PostToConnection
  actions: workflow / step / document

[경로 B] SQS 기반 (명시적 발행)
  agent/worker/session 워커 ──▶ WebsocketMessageQueue(SQS) ──▶ websocket-broker Lambda ──▶ PostToConnection
  actions: sessions / artifacts
```

두 경로 모두 **연결 조회는 DynamoDB가 아니라 Valkey(ElastiCache)** 로 하며, 대상 연결에만 선택적으로 보낸다(전체 브로드캐스트 아님).

### 경로 A — DynamoDB Stream

DB의 상태 변화가 곧 화면에 반영되는 경로. 백엔드가 push를 직접 호출하지 않아도, DB만 바뀌면 자동으로 전달된다.

```
BackendTable (StreamViewType.NEW_AND_OLD_IMAGES)
   │  storage-stack.ts:120-124
   │
   │  EventSource 필터 (아래 3종만 Lambda로 전달)
   │  workflow-stream.ts:80-105
   │    - PK begins_with DOC#  + SK begins_with WF#
   │    - PK begins_with WEB#  + SK begins_with WF#
   │    - PK begins_with WF#   + SK = STEP
   ▼
WorkflowStream Lambda  (packages/lambda/workflow-stream/src/index.ts)
   │  - getRecordType()로 레코드 분기 (index.ts:31-47)
   │  - OldImage/NewImage 비교 → 의미 있는 변화만 선별 (status diff 등)
   │  - getConnectionIdsByProject(projectId) 로 대상 조회 (valkey.ts:9-13)
   ▼
PostToConnection → API Gateway WebSocket (websocket.ts)
   actions: workflow / step / document
```

- CDK construct: `packages/common/constructs/src/app/workflow-stream.ts`
- 스택 배선: `packages/infra/src/stacks/websocket-stack.ts:101-108`
- **스트림이 켜진 테이블은 `BackendTable` 하나뿐이며, 이를 소비하는 Lambda도 `WorkflowStream` 하나뿐이다.**

### 경로 B — SQS (websocket-broker)

백엔드/워커가 특정 시점에 명시적으로 발행하는 경로.

```
agent / worker / session 워커
   │  action:'sessions' / 'artifacts' 메시지를 SQS로 발행
   ▼
WebsocketMessageQueue (SQS)   storage-stack.ts:181-188
   ▼
websocket-broker Lambda  (packages/lambda/websocket-broker/src/index.ts)
   │  username 있으면 해당 사용자 연결에만, 없으면 전체 연결에 브로드캐스트
   │  (index.ts:43-45)
   ▼
PostToConnection → API Gateway WebSocket
   actions: sessions / artifacts
```

- 입력 메시지: `{ username: string | null, message: { action, data }, projectId? }`
- `username === null`이면 모든 연결에 브로드캐스트 (`index.ts:5-26, 43-45`)
- `sessions`의 `created` 이벤트 시 세션 목록 캐시 무효화 (`index.ts:33-41`)

## 3. WebSocket API 정의

- API: `WebSocketApi 'idp-websocket-api'`, `prod` stage, **IAM Authorizer** (`websocket-stack.ts:54-92`)
- 라우트별 Lambda (`packages/lambda/websocket/src/`)
  - `$connect` → `connect.ts`: userSub→username 매핑 후 연결 등록
  - `$disconnect` → `disconnect.ts`: 연결 정리
  - `$default` → `default.ts`: `subscribe`/`unsubscribe` 액션 처리 (프로젝트 구독 등록/해제)

## 4. Action 목록

| action | 경로 | 트리거 | data 주요 필드 | 생성 위치 |
|--------|------|--------|----------------|-----------|
| `workflow` | A (Stream) | `DOC#`/`WEB#` + `WF#` 레코드의 status 변경 | `event:'status_changed'`, `workflowId`, `documentId`, `projectId`, `status`, `previousStatus` | `workflow-stream/src/index.ts:169-180` |
| `step` | A (Stream) | `WF#` + `STEP` 레코드의 step status / `qa_regen` 변경 | `event:'step_changed'`, `workflowId`, `stepName`, `status`, `currentStep` | `workflow-stream/src/index.ts:246-259, 276-287` |
| `document` | A (Stream) | `PROJ#`/`DOC#` 레코드 REMOVE (삭제) | `event:'deleted'`, `documentId`, `projectId` | `workflow-stream/src/index.ts:319-327` |
| `sessions` | B (SQS) | 세션 생성/수정/삭제 | `event:'created'\|'updated'\|'deleted'`, `sessionId`, `sessionName` | `session_workers/.../name-update.ts` |
| `artifacts` | B (SQS) | 아티팩트 생성/수정/삭제 | `event:'created'\|'updated'\|'deleted'`, `artifactId`, `artifactFileName` | `session_workers/.../artifact_process/index.ts` |
| `subscribe` / `unsubscribe` | (클라이언트 → 서버) | 프론트가 프로젝트 구독 등록/해제 | `projectId` | 프론트 `sendMessage`, 서버 `websocket/src/default.ts:23-37` |
| `ping` | (클라이언트 → 서버) | 30초 하트비트 | — | `WebSocketContext.tsx:176-180` |

## 5. 연결 상태 저장소 (Valkey / ElastiCache Redis)

연결/구독 상태는 Valkey에 저장한다. 키 정의: `packages/lambda/websocket/src/keys.ts`

| Key | Type | 설명 |
|-----|------|------|
| `ws:conn:{connectionId}` | String | connectionId → `{userSub}:{username}` 매핑 |
| `ws:conn:{connectionId}:projects` | Set | connectionId가 구독 중인 projectId 목록 |
| `ws:username:{username}` | Set | username → connectionId(s) (경로 B의 사용자 타깃팅) |
| `ws:project:{projectId}` | Set | projectId → connectionId(s) (경로 A의 프로젝트 타깃팅) |
| `ws:usersub:{sub}` | String | userSub → username 캐시 |

- **연결 시** (`connect.ts:45-46`): `ws:conn:*`, `ws:username:*` 등록
- **구독 시** (`default.ts:24-25`): `ws:project:*`, `ws:conn:*:projects` 등록
- **경로 A 조회** (`workflow-stream/src/valkey.ts:9-13`): `ws:project:{projectId}` → 해당 프로젝트 구독 연결
- **경로 B 조회** (`websocket-broker/src/index.ts:43-45`): `ws:username:{username}` 또는 전체
- **stale 연결 정리**: push 시 `GoneException` 발생하면 해당 연결을 저장소에서 제거

## 6. 메시지가 실제로 전달되는 3단계 필터

"불필요한 메시지가 전 사용자에게 뿌려지는" 구조가 아니다. 3단계로 걸러진다.

1. **스트림 소스 필터** — 관심 레코드(`DOC#/WF#` 등)만 Lambda가 트리거됨 (`workflow-stream.ts:80-105`)
2. **서버측 타깃 라우팅** — projectId(경로 A) 또는 username(경로 B) 기준으로 대상 연결에만 push
3. **프론트 action 구독** — 수신 메시지 중 컴포넌트가 구독한 action만 콜백 실행

## 참고: 템플릿(`TPL#`)은 아직 실시간 경로 없음

- 템플릿 아이템 키: `PK=TPL#{template_id}`, `SK=META` (`packages/backend/app/ddb/templates.py:7-8`)
- `WorkflowStream`의 EventSource 필터에 `TPL#` 조건이 없어 스트림 → Lambda 전달조차 안 됨
- 백엔드 템플릿 코드에도 SQS 발행/websocket push 호출 없음

템플릿 변경을 실시간 반영하려면 두 방법 중 하나가 필요하다.
- **경로 A 확장**: `workflow-stream.ts` 필터에 `TPL#`/`META` 추가 + `index.ts`에 template 핸들러/`action:'template'` 추가
- **경로 B 활용**: 백엔드가 템플릿 이벤트를 `WebsocketMessageQueue`로 발행

## 알려진 불일치 (검증 필요)

`document` action은 핸들러(`index.ts:341-354`)에서 `PROJ#/DOC#` REMOVE를 처리하지만, EventSource 필터(`workflow-stream.ts:80-105`)에는 `PROJ#/DOC#` 조건이 없다. 필터가 서버측에서 이 레코드를 걸러낼 가능성이 있어, document 삭제 메시지가 실제로 프론트에 도달하는지 확인이 필요하다.
