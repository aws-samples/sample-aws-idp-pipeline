import { useState, useCallback, useEffect, useRef } from 'react';
import { useVoiceChat, BidiModelType } from './useVoiceChat';
import { getStoredVoiceModelConfig } from '../components/VoiceModelSettingsModal';
import type { ChatMessage } from '../types/project';

interface UseVoiceChatManagerOptions {
  currentSessionId: string;
  projectId: string;
  userId: string;
  selectedVoiceModel: BidiModelType;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setStreamingBlocks: React.Dispatch<
    React.SetStateAction<
      import('../components/ChatPanel/types').StreamingBlock[]
    >
  >;
}

export function useVoiceChatManager({
  currentSessionId,
  projectId,
  userId,
  selectedVoiceModel,
  setMessages,
  setStreamingBlocks,
}: UseVoiceChatManagerOptions) {
  const [voiceChatMode, setVoiceChatMode] = useState(false);
  const [showVoiceModelSettings, setShowVoiceModelSettings] = useState(false);

  const voiceChat = useVoiceChat({
    sessionId: currentSessionId,
    projectId,
    userId,
  });

  const voiceChatDisconnectRef = useRef(voiceChat.disconnect);
  voiceChatDisconnectRef.current = voiceChat.disconnect;

  const handleVoiceChatConnect = useCallback(() => {
    const config = getStoredVoiceModelConfig();
    config.modelType = selectedVoiceModel;
    if (config.apiKeys) {
      config.apiKey = config.apiKeys[selectedVoiceModel as 'gemini' | 'openai'];
    }
    voiceChat.connect(config);
  }, [voiceChat, selectedVoiceModel]);

  const handleVoiceModelSelect = useCallback(
    (modelType: BidiModelType) => {
      // For gemini/openai, check if API key exists
      if (modelType === 'gemini' || modelType === 'openai') {
        const config = getStoredVoiceModelConfig();
        const apiKey = config.apiKeys?.[modelType];
        if (!apiKey) {
          setShowVoiceModelSettings(true);
          return;
        }
      }

      // If already connected with a different model, disconnect and reconnect
      if (voiceChat.state.status === 'connected') {
        voiceChat.disconnect();
        setTimeout(() => {
          const config = getStoredVoiceModelConfig();
          config.modelType = modelType;
          if (config.apiKeys) {
            config.apiKey = config.apiKeys[modelType as 'gemini' | 'openai'];
          }
          voiceChat.connect(config);
        }, 500);
      }
    },
    [voiceChat],
  );

  // Handle Voice Chat transcripts as chat messages
  useEffect(() => {
    const canAppendTo = (msg: ChatMessage | undefined, role: string) =>
      msg &&
      msg.role === role &&
      !msg.isToolUse &&
      !msg.isToolResult &&
      !msg.isStageResult;

    const unsubscribe = voiceChat.onTranscript((text, role, isFinal) => {
      const chatRole = role === 'user' ? 'user' : 'assistant';

      // Gemini: completely ignore is_final=true
      if (selectedVoiceModel === 'gemini' && isFinal) return;

      // Nova Sonic: is_final=true only used for ordering fallback
      if (selectedVoiceModel === 'nova_sonic' && isFinal) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (canAppendTo(last, chatRole)) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: chatRole,
              content: text,
              timestamp: new Date(),
            },
          ];
        });
        return;
      }

      // Nova Sonic & Gemini: show is_final=false (streaming delta)
      if (
        selectedVoiceModel === 'nova_sonic' ||
        selectedVoiceModel === 'gemini'
      ) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (canAppendTo(last, chatRole)) {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: m.content + text } : m,
            );
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: chatRole,
              content: text,
              timestamp: new Date(),
            },
          ];
        });
        return;
      }

      // OpenAI: show is_final=true only, ignore is_final=false
      if (!isFinal) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (canAppendTo(last, chatRole)) {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: m.content + text } : m,
          );
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: chatRole,
            content: text,
            timestamp: new Date(),
          },
        ];
      });
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceChat.onTranscript, selectedVoiceModel]);

  // Handle Voice Chat tool use events
  useEffect(() => {
    const unsubscribe = voiceChat.onToolUse((toolName, toolUseId, status) => {
      if (status === 'started') {
        setMessages((prev) => [
          ...prev,
          {
            id: toolUseId,
            role: 'assistant',
            content: toolName,
            timestamp: new Date(),
            isToolUse: true,
            toolUseName: toolName,
            toolUseStatus: 'running',
          },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolUseId
              ? { ...m, toolUseStatus: status as 'success' | 'error' }
              : m,
          ),
        );
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceChat.onToolUse]);

  // Handle Voice Chat text input
  const pendingVoiceTextRef = useRef<string | null>(null);

  const handleVoiceChatText = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: new Date(),
        },
      ]);

      if (voiceChat.state.status === 'connected') {
        voiceChat.sendText(text);
      } else {
        pendingVoiceTextRef.current = text;
        if (voiceChat.state.status !== 'connecting') {
          handleVoiceChatConnect();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voiceChat.state.status, voiceChat.sendText, handleVoiceChatConnect],
  );

  // Send pending voice text when connection is established
  useEffect(() => {
    if (voiceChat.state.status === 'connected' && pendingVoiceTextRef.current) {
      voiceChat.sendText(pendingVoiceTextRef.current);
      pendingVoiceTextRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceChat.state.status]);

  // Disconnect Voice Chat on unmount
  useEffect(() => {
    return () => {
      voiceChatDisconnectRef.current();
    };
  }, []);

  // Sync voiceChatMode with connection status
  useEffect(() => {
    if (
      voiceChat.state.status === 'connected' ||
      voiceChat.state.status === 'connecting'
    ) {
      setVoiceChatMode(true);
    }
  }, [voiceChat.state.status]);

  // Clear streaming blocks when Voice Chat state changes
  useEffect(() => {
    if (
      voiceChat.state.status === 'idle' ||
      voiceChat.state.status === 'error' ||
      voiceChat.state.status === 'connecting'
    ) {
      setStreamingBlocks([]);
    }
  }, [voiceChat.state.status, setStreamingBlocks]);

  return {
    voiceChat,
    voiceChatMode,
    setVoiceChatMode,
    showVoiceModelSettings,
    setShowVoiceModelSettings,
    handleVoiceChatConnect,
    handleVoiceModelSelect,
    handleVoiceChatText,
    voiceChatDisconnectRef,
  };
}
