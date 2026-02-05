import { useState, useRef, useCallback, useEffect } from 'react';
import { useAwsClient } from './useAwsClient';
import { useAudioCapture } from './useAudioCapture';
import { useAudioPlayback } from './useAudioPlayback';
import { createSignedWebSocketUrl } from '../lib/websocket-signer';

export interface NovaSonicState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  isListening: boolean;
  isSpeaking: boolean;
}

type TranscriptCallback = (
  text: string,
  role: string,
  isFinal: boolean,
) => void;

const SESSION_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

export interface UseNovaSonicOptions {
  sessionId: string;
  projectId: string;
  userId: string;
}

export interface UseNovaSonicReturn {
  state: NovaSonicState;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendText: (text: string) => void;
  toggleMic: () => void;
  inputAudioLevel: number;
  outputAudioLevel: number;
  onTranscript: (cb: TranscriptCallback) => () => void;
}

function extractRegionFromArn(arn: string): string {
  return arn.split(':')[3];
}

export function useNovaSonic(options: UseNovaSonicOptions): UseNovaSonicReturn {
  const { sessionId, projectId, userId } = options;
  const { bidiAgentRuntimeArn, getCredentials } = useAwsClient();
  const [state, setState] = useState<NovaSonicState>({
    status: 'idle',
    isListening: false,
    isSpeaking: false,
  });
  const [inputAudioLevel, setInputAudioLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptCallbacksRef = useRef<Set<TranscriptCallback>>(new Set());

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

  const disconnect = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const ws = wsRef.current;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop' }));
      }
      ws.close();
      wsRef.current = null;
    }

    capture.stopCapture();
    playback.stop();

    setState({ status: 'idle', isListening: false, isSpeaking: false });
  }, [capture, playback]);

  const connect = useCallback(async () => {
    console.log('[NovaSonic] connect called, arn:', bidiAgentRuntimeArn);
    if (!bidiAgentRuntimeArn) {
      console.log('[NovaSonic] ERROR: no bidiAgentRuntimeArn');
      setState((s) => ({ ...s, status: 'error' }));
      return;
    }

    setState((s) => ({ ...s, status: 'connecting' }));
    console.log('[NovaSonic] status set to connecting');

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

      console.log('[NovaSonic] Creating WebSocket...');
      const ws = new WebSocket(signedUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[NovaSonic] WebSocket opened');
        // Send config as first message
        ws.send(
          JSON.stringify({
            voice: 'tiffany',
            system_prompt: '',
            browser_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            // Session info for transcript persistence
            session_id: sessionId,
            project_id: projectId,
            user_id: userId,
          }),
        );
        setState({
          status: 'connected',
          isListening: false,
          isSpeaking: false,
        });

        // Auto-start mic capture on connect
        console.log('[NovaSonic] Starting mic capture...');
        capture
          .startCapture()
          .then(() => {
            console.log('[NovaSonic] Mic capture started successfully');
            setState((s) => ({ ...s, isListening: true }));
          })
          .catch((err) => {
            console.log('[NovaSonic] Mic capture failed:', err);
          });

        // Auto-timeout after 8 minutes
        timeoutRef.current = setTimeout(() => {
          disconnect();
        }, SESSION_TIMEOUT_MS);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'audio':
              playback.enqueueAudio(data.audio, data.sample_rate);
              setState((s) => ({ ...s, isSpeaking: true }));
              break;

            case 'transcript':
              for (const cb of transcriptCallbacksRef.current) {
                cb(data.text, data.role, data.is_final);
              }
              break;

            case 'response_start':
              setState((s) => ({ ...s, isSpeaking: true }));
              break;

            case 'response_complete':
              setState((s) => ({ ...s, isSpeaking: false }));
              break;

            case 'interruption':
              playback.stop();
              setState((s) => ({ ...s, isSpeaking: false }));
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = (err) => {
        console.log('[NovaSonic] WebSocket error:', err);
        setState((s) => ({ ...s, status: 'error' }));
      };

      ws.onclose = (event) => {
        console.log('[NovaSonic] WebSocket closed:', event.code, event.reason);
        if (wsRef.current === ws) {
          capture.stopCapture();
          playback.stop();
          setState({ status: 'idle', isListening: false, isSpeaking: false });
          wsRef.current = null;
        }
      };
    } catch (err) {
      console.log('[NovaSonic] Connect error:', err);
      setState({ status: 'error', isListening: false, isSpeaking: false });
    }
  }, [
    bidiAgentRuntimeArn,
    getCredentials,
    capture,
    playback,
    disconnect,
    sessionId,
    projectId,
    userId,
  ]);

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text }));
    }
  }, []);

  const toggleMic = useCallback(() => {
    console.log(
      '[NovaSonic] toggleMic called, isCapturing:',
      capture.isCapturing,
    );
    if (capture.isCapturing) {
      capture.stopCapture();
      setState((s) => ({ ...s, isListening: false }));
    } else {
      capture.startCapture().then(() => {
        console.log('[NovaSonic] capture started');
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
    };
  }, []);

  // Debug: log audio levels periodically
  useEffect(() => {
    if (!state.isListening) return;
    const interval = setInterval(() => {
      console.log('[NovaSonic] inputAudioLevel:', inputAudioLevel);
    }, 1000);
    return () => clearInterval(interval);
  }, [state.isListening, inputAudioLevel]);

  return {
    state,
    connect,
    disconnect,
    sendText,
    toggleMic,
    inputAudioLevel,
    outputAudioLevel: playback.audioLevel,
    onTranscript,
  };
}
