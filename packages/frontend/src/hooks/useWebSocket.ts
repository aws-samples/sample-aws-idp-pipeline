import { useCallback, useEffect, useRef, useState } from 'react';
import { useRuntimeConfig } from './useRuntimeConfig';

export type EventType =
  | 'WORKFLOW_STARTED'
  | 'STEP_START'
  | 'STEP_COMPLETE'
  | 'STEP_ERROR'
  | 'SEGMENT_PROGRESS'
  | 'WORKFLOW_COMPLETE'
  | 'WORKFLOW_ERROR';

export interface WebSocketMessage {
  event: EventType;
  workflow_id: string;
  step?: string;
  message?: string;
  error?: string;
  completed?: number;
  total?: number;
  project_id?: string;
  document_id?: string;
  file_name?: string;
  summary?: string;
  segment_count?: number;
  [key: string]: unknown;
}

interface UseWebSocketOptions {
  workflowId: string | null;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useWebSocket({
  workflowId,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
}: UseWebSocketOptions) {
  const runtimeConfig = useRuntimeConfig();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [wsEndpoint, setWsEndpoint] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (runtimeConfig?.websocketEndpoint) {
      const httpEndpoint = runtimeConfig.websocketEndpoint;
      const wsEndpointUrl = httpEndpoint
        .replace('https://', 'wss://')
        .replace('http://', 'ws://');
      setWsEndpoint(wsEndpointUrl);
    }
  }, [runtimeConfig]);

  const connect = useCallback(() => {
    if (!wsEndpoint || !workflowId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${wsEndpoint}?workflow_id=${workflowId}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setIsConnected(true);
      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage;
        onMessage?.(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      onDisconnect?.();
      wsRef.current = null;
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      onError?.(error);
    };

    wsRef.current = ws;
  }, [wsEndpoint, workflowId, onMessage, onConnect, onDisconnect, onError]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (wsEndpoint && workflowId) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [wsEndpoint, workflowId, connect, disconnect]);

  return {
    isConnected,
    connect,
    disconnect,
  };
}
