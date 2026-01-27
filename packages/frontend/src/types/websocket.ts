/** WebSocket 연결 상태 */
export type WebSocketStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

/** WebSocket 메시지 기본 타입 */
export interface WebSocketMessage<T = unknown> {
  action: string;
  data?: T;
  projectId?: string;
}

/** 메시지 구독 콜백 타입 */
export type MessageCallback<T = unknown> = (data: T) => void;

/** 구독 해제 함수 타입 */
export type Unsubscribe = () => void;
