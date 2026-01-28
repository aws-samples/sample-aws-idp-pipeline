import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useAuth } from 'react-oidc-context';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { createSignedWebSocketUrl } from '../lib/websocket-signer';
import type {
  WebSocketStatus,
  WebSocketMessage,
  MessageCallback,
  Unsubscribe,
} from '../types/websocket';

const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_RECONNECT_INTERVAL = 3000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MULTIPLIER = 1.5;

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

interface WebSocketContextValue {
  status: WebSocketStatus;
  subscribe: <T>(action: string, callback: MessageCallback<T>) => Unsubscribe;
  sendMessage: <T>(message: WebSocketMessage<T>) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: PropsWithChildren) {
  const { cognitoProps, websocketUrl } = useRuntimeConfig();
  const { user } = useAuth();

  const [status, setStatus] = useState<WebSocketStatus>('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const pendingCredentialsRef = useRef<Promise<Credentials> | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isManualDisconnectRef = useRef(false);
  const isConnectingRef = useRef(false);
  const subscribersRef = useRef<Map<string, Set<MessageCallback>>>(new Map());

  /** Cognito Identity Pool에서 AWS 자격 증명 획득 */
  const getCredentials = useCallback(async (): Promise<Credentials> => {
    if (!cognitoProps || !user?.id_token) {
      throw new Error('Cognito props or user token not available');
    }

    const cached = credentialsRef.current;
    const isValid =
      cached?.expiration &&
      cached.expiration.getTime() - Date.now() > CREDENTIAL_REFRESH_BUFFER_MS;

    if (isValid) return cached;

    if (pendingCredentialsRef.current) return pendingCredentialsRef.current;

    pendingCredentialsRef.current = fromCognitoIdentityPool({
      clientConfig: { region: cognitoProps.region },
      identityPoolId: cognitoProps.identityPoolId,
      logins: {
        [`cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`]:
          user.id_token,
      },
    })()
      .then((credentials) => {
        credentialsRef.current = credentials;
        return credentials;
      })
      .finally(() => {
        pendingCredentialsRef.current = null;
      });

    return pendingCredentialsRef.current;
  }, [cognitoProps, user]);

  /** WebSocket 연결 종료 */
  const disconnect = useCallback(() => {
    isManualDisconnectRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }

    setStatus('disconnected');
    reconnectAttemptsRef.current = 0;
  }, []);

  /** WebSocket 연결 */
  const connect = useCallback(async () => {
    if (!websocketUrl || !cognitoProps) {
      return;
    }

    // Prevent duplicate connections (especially in React StrictMode)
    if (
      isConnectingRef.current ||
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    isConnectingRef.current = true;
    isManualDisconnectRef.current = false;
    setStatus('connecting');

    const credentials = await getCredentials();
    console.log('WebSocket credentials:', {
      accessKeyId: credentials.accessKeyId,
      hasSessionToken: !!credentials.sessionToken,
    });

    const signedUrl = await createSignedWebSocketUrl({
      websocketUrl,
      credentials,
      region: cognitoProps.region,
    });
    console.log('WebSocket signed URL:', signedUrl);

    const ws = new WebSocket(signedUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      isConnectingRef.current = false;
      setStatus('connected');
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as WebSocketMessage;
      const callbacks = subscribersRef.current.get(message.action);
      callbacks?.forEach((callback) => callback(message.data));
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
    };

    ws.onclose = (event) => {
      isConnectingRef.current = false;
      setStatus('disconnected');
      wsRef.current = null;

      // 비정상 종료 시 재연결 시도
      if (!isManualDisconnectRef.current && event.code !== 1000) {
        if (reconnectAttemptsRef.current >= DEFAULT_MAX_RECONNECT_ATTEMPTS) {
          setStatus('error');
          return;
        }

        const delay =
          DEFAULT_RECONNECT_INTERVAL *
          Math.pow(DEFAULT_BACKOFF_MULTIPLIER, reconnectAttemptsRef.current);

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connect();
        }, delay);
      }
    };
  }, [websocketUrl, cognitoProps, getCredentials]);

  /** 메시지 구독 */
  const subscribe = useCallback(
    <T,>(action: string, callback: MessageCallback<T>): Unsubscribe => {
      if (!subscribersRef.current.has(action)) {
        subscribersRef.current.set(action, new Set());
      }
      const callbacks = subscribersRef.current.get(action);
      callbacks?.add(callback as MessageCallback);

      return () => {
        subscribersRef.current.get(action)?.delete(callback as MessageCallback);
      };
    },
    [],
  );

  /** 메시지 전송 */
  const sendMessage = useCallback(<T,>(message: WebSocketMessage<T>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message);
    }
  }, []);

  /** 자동 연결 */
  useEffect(() => {
    if (user?.id_token && websocketUrl) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [user?.id_token, websocketUrl, connect, disconnect]);

  const value: WebSocketContextValue = {
    status,
    subscribe,
    sendMessage,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

/** WebSocket 상태 접근 훅 */
export function useWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

/** 특정 action 메시지 구독 훅 */
export function useWebSocketMessage<T>(
  action: string,
  callback: MessageCallback<T>,
): void {
  const { subscribe } = useWebSocket();

  useEffect(() => {
    return subscribe(action, callback);
  }, [action, callback, subscribe]);
}
