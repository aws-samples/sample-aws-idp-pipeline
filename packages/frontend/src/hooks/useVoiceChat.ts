import { useState, useRef, useCallback, useEffect } from 'react';
import { useAwsClient } from './useAwsClient';
import { useAudioCapture } from './useAudioCapture';
import { useAudioPlayback } from './useAudioPlayback';
import { createSignedWebSocketUrl } from '../lib/websocket-signer';

export type DisconnectReason = 'user' | 'timeout' | 'error' | null;

export interface VoiceChatState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  isListening: boolean;
  isSpeaking: boolean;
  disconnectReason: DisconnectReason;
}

type TranscriptCallback = (
  text: string,
  role: string,
  isFinal: boolean,
) => void;

type ToolUseCallback = (
  toolName: string,
  toolUseId: string,
  status: 'started' | 'success' | 'error',
) => void;

type ResponseStartCallback = () => void;
type ResponseCompleteCallback = () => void;

const SESSION_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

export type BidiModelType = 'nova_sonic' | 'gemini' | 'openai';

export interface VoiceModelConfig {
  modelType: BidiModelType;
  apiKey?: string; // Current API key for the selected model
  voice?: string;
  // Stored API keys per provider (for localStorage persistence)
  apiKeys?: {
    gemini?: string;
    openai?: string;
  };
}

export interface UseVoiceChatOptions {
  sessionId: string;
  projectId: string;
  userId: string;
}

export interface UseVoiceChatReturn {
  state: VoiceChatState;
  connect: (modelConfig?: VoiceModelConfig) => Promise<void>;
  disconnect: () => void;
  sendText: (text: string) => void;
  toggleMic: () => void;
  inputAudioLevel: number;
  outputAudioLevel: number;
  onTranscript: (cb: TranscriptCallback) => () => void;
  onToolUse: (cb: ToolUseCallback) => () => void;
  onResponseStart: (cb: ResponseStartCallback) => () => void;
  onResponseComplete: (cb: ResponseCompleteCallback) => () => void;
}

function extractRegionFromArn(arn: string): string {
  return arn.split(':')[3];
}

export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatReturn {
  const { sessionId, projectId, userId } = options;
  const { bidiAgentRuntimeArn, getCredentials } = useAwsClient();
  const [state, setState] = useState<VoiceChatState>({
    status: 'idle',
    isListening: false,
    isSpeaking: false,
    disconnectReason: null,
  });
  const [inputAudioLevel, setInputAudioLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageCountRef = useRef(0);
  const transcriptCallbacksRef = useRef<Set<TranscriptCallback>>(new Set());
  const toolUseCallbacksRef = useRef<Set<ToolUseCallback>>(new Set());
  const responseStartCallbacksRef = useRef<Set<ResponseStartCallback>>(
    new Set(),
  );
  const responseCompleteCallbacksRef = useRef<Set<ResponseCompleteCallback>>(
    new Set(),
  );
  const pendingDisconnectReasonRef = useRef<DisconnectReason>(null);

  const playback = useAudioPlayback();

  const handleAudioChunk = useCallback((base64Pcm: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'audio', audio: base64Pcm }));
    }
  }, []);

  const handleAudioLevel = useCallback((level: number) => {
    setInputAudioLevel(level);
  }, []);

  const capture = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    onAudioLevel: handleAudioLevel,
  });

  const disconnect = useCallback(
    (reason: DisconnectReason = 'user') => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      const ws = wsRef.current;
      if (ws) {
        pendingDisconnectReasonRef.current = reason;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
        ws.close();
        wsRef.current = null;
      }

      capture.stopCapture();
      playback.stop();

      setState({
        status: 'idle',
        isListening: false,
        isSpeaking: false,
        disconnectReason: reason,
      });
    },
    [capture, playback],
  );

  const connect = useCallback(
    async (modelConfig?: VoiceModelConfig) => {
      console.log('[VoiceChat] connect called, arn:', bidiAgentRuntimeArn);
      if (!bidiAgentRuntimeArn) {
        console.log('[VoiceChat] ERROR: no bidiAgentRuntimeArn');
        setState((s) => ({ ...s, status: 'error' }));
        return;
      }

      setState((s) => ({ ...s, status: 'connecting', disconnectReason: null }));
      console.log('[VoiceChat] status set to connecting');

      try {
        const credentials = await getCredentials();
        const region = extractRegionFromArn(bidiAgentRuntimeArn);
        const encodedArn = encodeURIComponent(bidiAgentRuntimeArn);
        const rawUrl = `wss://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/ws`;

        const signedUrl = await createSignedWebSocketUrl({
          websocketUrl: rawUrl,
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
          },
          region,
          service: 'bedrock-agentcore',
        });

        console.log('[VoiceChat] Creating WebSocket...');
        const ws = new WebSocket(signedUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[VoiceChat] WebSocket opened');
          // Send config as first message
          const config = {
            model_type: modelConfig?.modelType || 'nova_sonic',
            voice: modelConfig?.voice || 'tiffany',
            api_key: modelConfig?.apiKey,
            system_prompt: '',
            browser_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            session_id: sessionId,
            project_id: projectId,
            user_id: userId,
          };
          console.log('[VoiceChat] Sending config:', {
            ...config,
            api_key: config.api_key ? '***' : undefined,
          });
          ws.send(JSON.stringify(config));
          setState({
            status: 'connected',
            isListening: false,
            isSpeaking: false,
            disconnectReason: null,
          });

          // Auto-start mic capture on connect
          console.log('[VoiceChat] Starting mic capture...');
          capture
            .startCapture()
            .then(() => {
              console.log('[VoiceChat] Mic capture started successfully');
              setState((s) => ({ ...s, isListening: true }));
            })
            .catch((err) => {
              console.log('[VoiceChat] Mic capture failed:', err);
            });

          // Auto-timeout after 8 minutes
          timeoutRef.current = setTimeout(() => {
            disconnect();
          }, SESSION_TIMEOUT_MS);

          // Keep-alive ping every 3 seconds to prevent proxy timeout
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              console.log('[VoiceChat] Sending ping');
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 3000);
        };

        ws.onmessage = (event) => {
          messageCountRef.current += 1;
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'audio':
                try {
                  playback.enqueueAudio(data.audio, data.sample_rate);
                  setState((s) => ({ ...s, isSpeaking: true }));
                } catch (audioErr) {
                  console.error('[VoiceChat] Audio playback error:', audioErr);
                }
                break;

              case 'transcript':
                for (const cb of transcriptCallbacksRef.current) {
                  cb(data.text, data.role, data.is_final);
                }
                break;

              case 'response_start':
                setState((s) => ({ ...s, isSpeaking: true }));
                // Notify listeners that assistant started responding
                // This signals that user's turn is complete
                for (const cb of responseStartCallbacksRef.current) {
                  cb();
                }
                break;

              case 'response_complete':
                setState((s) => ({ ...s, isSpeaking: false }));
                // Notify listeners that assistant finished responding
                for (const cb of responseCompleteCallbacksRef.current) {
                  cb();
                }
                break;

              case 'interruption':
                playback.stop();
                setState((s) => ({ ...s, isSpeaking: false }));
                break;

              case 'tool_use':
                console.log('[VoiceChat] tool_use received:', data.tool_name);
                for (const cb of toolUseCallbacksRef.current) {
                  cb(data.tool_name, data.tool_use_id, 'started');
                }
                break;

              case 'tool_result':
                console.log(
                  '[VoiceChat] tool_result received:',
                  data.tool_name,
                  data.status,
                );
                for (const cb of toolUseCallbacksRef.current) {
                  cb(
                    data.tool_name,
                    data.tool_use_id,
                    data.status === 'success' ? 'success' : 'error',
                  );
                }
                break;

              case 'timeout':
                console.log('[VoiceChat] Session timed out:', data.reason);
                pendingDisconnectReasonRef.current = 'timeout';
                ws.close();
                break;

              case 'error':
                console.error('[VoiceChat] Server error:', data.message);
                pendingDisconnectReasonRef.current = 'error';
                break;

              case 'connection_start':
                console.log(
                  '[VoiceChat] Connection started:',
                  data.connection_id,
                );
                break;

              case 'pong':
                console.log('[VoiceChat] Pong received');
                break;

              default:
                console.log(
                  '[VoiceChat] Unknown message type:',
                  data.type,
                  data,
                );
            }
          } catch (parseErr) {
            console.warn('[VoiceChat] Failed to parse message:', parseErr);
          }
        };

        ws.onerror = (err) => {
          console.log('[VoiceChat] WebSocket error:', err);
          setState((s) => ({ ...s, status: 'error' }));
        };

        ws.onclose = (event) => {
          console.log(
            '[VoiceChat] WebSocket closed:',
            event.code,
            event.reason,
            'after',
            messageCountRef.current,
            'messages',
          );
          messageCountRef.current = 0;
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (wsRef.current === ws) {
            capture.stopCapture();
            playback.stop();
            const reason = pendingDisconnectReasonRef.current || 'user';
            pendingDisconnectReasonRef.current = null;
            setState({
              status: 'idle',
              isListening: false,
              isSpeaking: false,
              disconnectReason: reason,
            });
            wsRef.current = null;
          }
        };
      } catch (err) {
        console.log('[VoiceChat] Connect error:', err);
        setState({
          status: 'error',
          isListening: false,
          isSpeaking: false,
          disconnectReason: 'error',
        });
      }
    },
    [
      bidiAgentRuntimeArn,
      getCredentials,
      capture,
      playback,
      disconnect,
      sessionId,
      projectId,
      userId,
    ],
  );

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text }));
    }
  }, []);

  const toggleMic = useCallback(() => {
    console.log(
      '[VoiceChat] toggleMic called, isCapturing:',
      capture.isCapturing,
    );
    if (capture.isCapturing) {
      capture.stopCapture();
      setState((s) => ({ ...s, isListening: false }));
    } else {
      capture.startCapture().then(() => {
        console.log('[VoiceChat] capture started');
        setState((s) => ({ ...s, isListening: true }));
      });
    }
  }, [capture]);

  const onTranscript = useCallback((cb: TranscriptCallback) => {
    transcriptCallbacksRef.current.add(cb);
    return () => {
      transcriptCallbacksRef.current.delete(cb);
    };
  }, []);

  const onToolUse = useCallback((cb: ToolUseCallback) => {
    toolUseCallbacksRef.current.add(cb);
    return () => {
      toolUseCallbacksRef.current.delete(cb);
    };
  }, []);

  const onResponseStart = useCallback((cb: ResponseStartCallback) => {
    responseStartCallbacksRef.current.add(cb);
    return () => {
      responseStartCallbacksRef.current.delete(cb);
    };
  }, []);

  const onResponseComplete = useCallback((cb: ResponseCompleteCallback) => {
    responseCompleteCallbacksRef.current.add(cb);
    return () => {
      responseCompleteCallbacksRef.current.delete(cb);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, []);

  return {
    state,
    connect,
    disconnect,
    sendText,
    toggleMic,
    inputAudioLevel,
    outputAudioLevel: playback.audioLevel,
    onTranscript,
    onToolUse,
    onResponseStart,
    onResponseComplete,
  };
}
