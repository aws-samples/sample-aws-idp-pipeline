import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import {
  useAwsClient,
  StreamEvent,
  ContentBlock,
  ToolResultContent,
} from './useAwsClient';
import { useToast } from '../components/Toast';
import { useWebSocketMessage } from '../contexts/WebSocketContext';
import type {
  ChatMessage,
  ChatSession,
  ChatAttachment,
  Agent,
} from '../types/project';
import type {
  StreamingBlock,
  AttachedFile,
} from '../components/ChatPanel/types';
import type { BidiModelType } from './useVoiceChat';

interface UseChatSessionOptions {
  projectId: string;
}

export function useChatSession({ projectId }: UseChatSessionOptions) {
  const { t } = useTranslation();
  const { fetchApi, invokeAgent, researchAgentRuntimeArn } = useAwsClient();
  const { showToast } = useToast();

  // AgentCore requires session ID >= 33 chars
  const [currentSessionId, setCurrentSessionId] = useState(() => nanoid(33));
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsNextCursor, setSessionsNextCursor] = useState<string | null>(
    null,
  );
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<StreamingBlock[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const pendingMessagesRef = useRef<ChatMessage[]>([]);
  const toolUseNameStackRef = useRef<string[]>([]);
  const chatScrollPositionRef = useRef(0);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchApi<{
        sessions: ChatSession[];
        next_cursor: string | null;
      }>(`chat/projects/${projectId}/sessions`);
      setSessions(
        data.sessions.sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
      );
      setSessionsNextCursor(data.next_cursor);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setSessions([]);
      setSessionsNextCursor(null);
    }
  }, [fetchApi, projectId]);

  const handleSessionMessage = useCallback(
    (data: {
      event: string;
      sessionId: string;
      sessionName: string;
      timestamp: string;
    }) => {
      if (data.event === 'created') {
        loadSessions();
      }
    },
    [loadSessions],
  );

  useWebSocketMessage('sessions', handleSessionMessage);

  const handleNewSession = useCallback(() => {
    const newSessionId = nanoid(33);
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setResearchMode(false);
    // Voice chat and agent reset are handled by the parent
  }, []);

  const loadMoreSessions = useCallback(async () => {
    if (!sessionsNextCursor || loadingMoreSessions) return;

    setLoadingMoreSessions(true);
    try {
      const data = await fetchApi<{
        sessions: ChatSession[];
        next_cursor: string | null;
      }>(`chat/projects/${projectId}/sessions?cursor=${sessionsNextCursor}`);

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.session_id));
        const newSessions = data.sessions.filter(
          (s) => !existingIds.has(s.session_id),
        );
        return [...prev, ...newSessions].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
      });
      setSessionsNextCursor(data.next_cursor);
    } catch (error) {
      console.error('Failed to load more sessions:', error);
    } finally {
      setLoadingMoreSessions(false);
    }
  }, [fetchApi, projectId, sessionsNextCursor, loadingMoreSessions]);

  const handleSessionSelect = useCallback(
    async (
      sessionId: string,
      opts: {
        agents: Agent[];
        setSelectedAgent: (agent: Agent | null) => void;
        setVoiceChatMode: (mode: boolean) => void;
        setSelectedVoiceModel: (model: BidiModelType) => void;
        voiceChatDisconnect: () => void;
      },
    ) => {
      setCurrentSessionId(sessionId);
      setMessages([]);
      setLoadingHistory(true);

      const session = sessions.find((s) => s.session_id === sessionId);

      if (session?.agent_id?.startsWith('voice')) {
        setResearchMode(false);
        opts.setVoiceChatMode(true);
        opts.setSelectedAgent(null);
        const modelType = session.agent_id.replace(
          'voice_',
          '',
        ) as BidiModelType;
        if (
          modelType === 'nova_sonic' ||
          modelType === 'gemini' ||
          modelType === 'openai'
        ) {
          opts.setSelectedVoiceModel(modelType);
        } else {
          opts.setSelectedVoiceModel('nova_sonic');
        }
      } else if (session?.agent_id === 'research') {
        setResearchMode(true);
        opts.setVoiceChatMode(false);
        opts.setSelectedAgent(null);
      } else if (session?.agent_id && session.agent_id !== 'default') {
        setResearchMode(false);
        opts.setVoiceChatMode(false);
        const agent = opts.agents.find(
          (a) => a.agent_id === session.agent_id || a.name === session.agent_id,
        );
        if (agent) {
          opts.setSelectedAgent(agent);
        } else {
          showToast(
            'warning',
            t(
              'agent.notFound',
              'Agent "{{name}}" not found. Using default agent.',
              {
                name: session.agent_id,
              },
            ),
          );
          opts.setSelectedAgent(null);
        }
      } else {
        setResearchMode(false);
        opts.setVoiceChatMode(false);
        opts.setSelectedAgent(null);
      }

      try {
        const response = await fetchApi<{
          session_id: string;
          messages: {
            role: string;
            content: {
              type: string;
              text?: string;
              format?: string;
              source?: string;
              s3_url?: string | null;
              name?: string;
              content?: {
                type: string;
                text?: string;
                format?: string;
                source?: string;
                s3_url?: string | null;
              }[];
            }[];
          }[];
        }>(`chat/projects/${projectId}/sessions/${sessionId}`);

        if (response.messages.length === 0) {
          showToast(
            'warning',
            t('chat.emptySession', 'This session has no messages'),
          );
          setCurrentSessionId(nanoid(33));
        } else {
          const loadedMessages: ChatMessage[] = response.messages.map(
            (msg, idx) => {
              const toolResultItem = msg.content.find(
                (item) => item.type === 'tool_result',
              );

              if (
                toolResultItem?.content?.length === 1 &&
                toolResultItem.content[0].type === 'text' &&
                toolResultItem.content[0].text &&
                !toolResultItem.content[0].text.includes('\n') &&
                toolResultItem.content[0].text.length < 100
              ) {
                const voiceToolName = toolResultItem.content[0].text;
                return {
                  id: `history-${idx}`,
                  role: 'assistant' as const,
                  content: voiceToolName,
                  timestamp: new Date(),
                  isToolUse: true,
                  toolUseName: voiceToolName,
                  toolUseStatus: 'success',
                };
              }

              if (toolResultItem && toolResultItem.content) {
                const nestedContent = toolResultItem.content;

                const textContent = nestedContent
                  .filter(
                    (item) =>
                      (item.type === 'text' || (!item.type && item.text)) &&
                      item.text,
                  )
                  .map((item) => item.text)
                  .join('\n');

                let artifact = undefined;
                let toolResultType: 'image' | 'artifact' | 'text' = 'text';
                let sources:
                  | { document_id: string; segment_id: string }[]
                  | undefined = undefined;

                try {
                  const parsed = JSON.parse(textContent);
                  if (parsed.artifact_id && parsed.filename) {
                    artifact = {
                      artifact_id: parsed.artifact_id,
                      filename: parsed.filename,
                      url: parsed.url || '',
                      s3_key: parsed.s3_key,
                      s3_bucket: parsed.s3_bucket,
                      created_at: parsed.created_at,
                    };
                    toolResultType = 'artifact';
                  } else if (parsed.answer && Array.isArray(parsed.sources)) {
                    const referencedIds = new Set<string>();
                    const idPattern = /document_id[=:]?\s*([0-9a-f-]{36})/gi;
                    let m;
                    while ((m = idPattern.exec(parsed.answer)) !== null) {
                      referencedIds.add(m[1]);
                    }
                    sources =
                      referencedIds.size > 0
                        ? parsed.sources.filter((s: { document_id: string }) =>
                            referencedIds.has(s.document_id),
                          )
                        : parsed.sources;
                  }
                } catch {
                  // Not JSON
                }

                const imageAttachments: ChatAttachment[] = nestedContent
                  .filter(
                    (item) =>
                      item.type === 'image' && (item.s3_url || item.source),
                  )
                  .map((item, imgIdx) => ({
                    id: `history-${idx}-tool-img-${imgIdx}`,
                    type: 'image' as const,
                    name: `generated-${imgIdx + 1}.${item.format || 'png'}`,
                    preview: item.s3_url
                      ? item.s3_url
                      : `data:image/${item.format || 'png'};base64,${item.source}`,
                  }));

                if (imageAttachments.length > 0) {
                  toolResultType = 'image';
                }

                let historyDisplayContent = textContent;
                if (sources) {
                  try {
                    const parsed = JSON.parse(textContent);
                    historyDisplayContent = parsed.answer || textContent;
                  } catch {
                    // Not JSON
                  }
                }

                let inferredToolName: string | undefined;
                if (sources) {
                  inferredToolName = 'search___summarize';
                } else if (
                  textContent.startsWith('Found') &&
                  textContent.includes('search results')
                ) {
                  inferredToolName = 'search';
                } else if (toolResultType === 'image') {
                  inferredToolName = 'generate_image';
                } else if (
                  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(textContent.trim())
                ) {
                  inferredToolName = 'current_time';
                } else if (textContent.trim().startsWith('Result:')) {
                  inferredToolName = 'calculator';
                } else if (textContent.startsWith('Agent handoff completed')) {
                  inferredToolName = 'handoff_to_user';
                } else if (
                  toolResultType === 'text' &&
                  !artifact &&
                  textContent.length > 500 &&
                  !textContent.startsWith('{') &&
                  (textContent.match(/^#{1,3}\s/gm) || []).length >= 2
                ) {
                  inferredToolName = 'research_agent';
                } else if (
                  toolResultType === 'text' &&
                  !artifact &&
                  textContent.length > 500 &&
                  !textContent.startsWith('{')
                ) {
                  inferredToolName = 'fetch_content';
                }

                return {
                  id: `history-${idx}`,
                  role: 'assistant' as const,
                  content:
                    toolResultType === 'artifact' ? '' : historyDisplayContent,
                  attachments:
                    imageAttachments.length > 0 ? imageAttachments : undefined,
                  timestamp: new Date(),
                  isToolResult: true,
                  toolResultType,
                  artifact,
                  sources,
                  toolName: inferredToolName,
                };
              }

              const textContent = msg.content
                .filter((item) => item.type === 'text' && item.text)
                .map((item) => item.text)
                .join('\n');

              const imageAttachments: ChatAttachment[] = msg.content
                .filter(
                  (item) =>
                    item.type === 'image' && (item.s3_url || item.source),
                )
                .map((item, imgIdx) => ({
                  id: `history-${idx}-img-${imgIdx}`,
                  type: 'image' as const,
                  name: `image-${imgIdx + 1}.${item.format || 'png'}`,
                  preview: item.s3_url
                    ? item.s3_url
                    : `data:image/${item.format || 'png'};base64,${item.source}`,
                }));

              const documentAttachments: ChatAttachment[] = msg.content
                .filter((item) => item.type === 'document' && item.name)
                .map((item, docIdx) => {
                  const baseName = item.name || `document-${docIdx + 1}`;
                  const hasExtension = /\.[a-zA-Z0-9]+$/.test(baseName);
                  const finalName =
                    hasExtension || !item.format
                      ? baseName
                      : `${baseName}.${item.format}`;
                  return {
                    id: `history-${idx}-doc-${docIdx}`,
                    type: 'document' as const,
                    name: finalName,
                    preview: null,
                  };
                });

              const allAttachments = [
                ...imageAttachments,
                ...documentAttachments,
              ];

              return {
                id: `history-${idx}`,
                role: msg.role as 'user' | 'assistant',
                content: textContent,
                attachments:
                  allAttachments.length > 0 ? allAttachments : undefined,
                timestamp: new Date(),
              };
            },
          );

          const merged: ChatMessage[] = [];
          for (const msg of loadedMessages) {
            const prev = merged[merged.length - 1];
            if (
              prev &&
              prev.role === msg.role &&
              !prev.isToolUse &&
              !prev.isToolResult &&
              !prev.isStageResult &&
              !msg.isToolUse &&
              !msg.isToolResult &&
              !msg.isStageResult &&
              !prev.attachments &&
              !msg.attachments
            ) {
              prev.content += msg.content;
            } else {
              merged.push({ ...msg });
            }
          }
          setMessages(merged);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
        showToast('error', t('chat.loadError', 'Failed to load conversation'));
        setCurrentSessionId(nanoid(33));
      } finally {
        setLoadingHistory(false);
      }
    },
    [fetchApi, projectId, showToast, t, sessions],
  );

  const handleSessionRename = useCallback(
    async (sessionId: string, newName: string) => {
      await fetchApi(`chat/projects/${projectId}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_name: newName }),
      });
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === sessionId ? { ...s, session_name: newName } : s,
        ),
      );
    },
    [fetchApi, projectId],
  );

  const handleSessionDelete = useCallback(
    async (
      sessionId: string,
      opts: {
        voiceChatDisconnect: () => void;
        setVoiceChatMode: (mode: boolean) => void;
        setSelectedAgent: (agent: Agent | null) => void;
      },
    ) => {
      await fetchApi(`chat/projects/${projectId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      if (sessionId === currentSessionId) {
        opts.voiceChatDisconnect();
        opts.setVoiceChatMode(false);
        setResearchMode(false);
        opts.setSelectedAgent(null);
        setCurrentSessionId(nanoid(33));
        setMessages([]);
        setStreamingBlocks([]);
      }
    },
    [fetchApi, projectId, currentSessionId],
  );

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'text':
        if (event.content && typeof event.content === 'string') {
          const text = event.content;
          setStreamingBlocks((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === 'text') {
              return [
                ...prev.slice(0, -1),
                { type: 'text', content: last.content + text },
              ];
            }
            return [...prev, { type: 'text', content: text }];
          });
        }
        break;
      case 'tool_use': {
        const toolName = event.name ?? '';
        toolUseNameStackRef.current.push(toolName);
        setStreamingBlocks((prev) => {
          const alreadyExists = prev.some(
            (b) => b.type === 'tool_use' && b.name === toolName,
          );
          if (alreadyExists) return prev;
          return [...prev, { type: 'tool_use', name: toolName }];
        });
        break;
      }
      case 'tool_result': {
        const capturedToolName = toolUseNameStackRef.current.pop() || '';

        if (!Array.isArray(event.content)) break;
        const contents = event.content as ToolResultContent[];

        const textContent = contents
          .filter(
            (item) =>
              (item.type === 'text' || (!item.type && item.text)) && item.text,
          )
          .map((item) => item.text)
          .join('\n');

        let artifact = undefined;
        let toolResultType: 'image' | 'artifact' | 'text' = 'text';
        let sources: { document_id: string; segment_id: string }[] | undefined =
          undefined;

        try {
          const parsed = JSON.parse(textContent);
          if (parsed.artifact_id && parsed.filename) {
            artifact = {
              artifact_id: parsed.artifact_id,
              filename: parsed.filename,
              url: parsed.url || '',
              s3_key: parsed.s3_key,
              s3_bucket: parsed.s3_bucket,
              created_at: parsed.created_at,
            };
            toolResultType = 'artifact';
          } else if (parsed.answer && Array.isArray(parsed.sources)) {
            const referencedIds = new Set<string>();
            const idPattern = /document_id[=:]?\s*([0-9a-f-]{36})/gi;
            let m;
            while ((m = idPattern.exec(parsed.answer)) !== null) {
              referencedIds.add(m[1]);
            }
            sources =
              referencedIds.size > 0
                ? parsed.sources.filter((s: { document_id: string }) =>
                    referencedIds.has(s.document_id),
                  )
                : parsed.sources;
          }
        } catch {
          // Not JSON
        }

        const imageAttachments: ChatAttachment[] = contents
          .filter(
            (item) =>
              (item.type === 'image' || (!item.type && item.image)) &&
              (item.s3_url || item.source || item.image?.source?.bytes),
          )
          .map((item, imgIdx) => {
            const fmt = item.format || item.image?.format || 'png';
            const base64Data = item.source || item.image?.source?.bytes || '';
            return {
              id: `stream-tool-img-${crypto.randomUUID()}-${imgIdx}`,
              type: 'image' as const,
              name: `generated-${imgIdx + 1}.${fmt}`,
              preview: item.s3_url
                ? item.s3_url
                : `data:image/${fmt};base64,${base64Data}`,
            };
          });

        if (imageAttachments.length > 0) {
          toolResultType = 'image';
        }

        if (!textContent && imageAttachments.length === 0) break;

        let displayContent: string | undefined;
        if (toolResultType === 'text' && sources) {
          try {
            const parsed = JSON.parse(textContent);
            displayContent = parsed.answer || textContent;
          } catch {
            displayContent = textContent;
          }
        } else if (toolResultType === 'text') {
          displayContent = textContent;
        }

        setStreamingBlocks((prev) => {
          let lastToolIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].type === 'tool_use') {
              lastToolIdx = i;
              break;
            }
          }
          const withoutToolUse =
            lastToolIdx >= 0
              ? [...prev.slice(0, lastToolIdx), ...prev.slice(lastToolIdx + 1)]
              : prev;
          return [
            ...withoutToolUse,
            {
              type: 'tool_result' as const,
              resultType: toolResultType,
              content: displayContent,
              images:
                imageAttachments.length > 0
                  ? imageAttachments
                      .filter((a) => a.preview != null)
                      .map((a) => ({
                        src: a.preview as string,
                        alt: a.name,
                      }))
                  : undefined,
              sources,
              toolName: capturedToolName || undefined,
            },
          ];
        });

        const toolResultMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            toolResultType === 'artifact' ? '' : displayContent || textContent,
          attachments:
            imageAttachments.length > 0 ? imageAttachments : undefined,
          timestamp: new Date(),
          isToolResult: true,
          toolResultType,
          artifact,
          sources,
          toolName: capturedToolName || undefined,
        };
        pendingMessagesRef.current.push(toolResultMessage);
        break;
      }
      case 'stage_start': {
        const stage = event.stage ?? '';
        setStreamingBlocks((prev) => [...prev, { type: 'stage_start', stage }]);
        break;
      }
      case 'stage_complete': {
        const stage = event.stage ?? '';
        const result = event.result ?? '';
        pendingMessagesRef.current.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result,
          timestamp: new Date(),
          isStageResult: true,
          stageName: stage,
        });
        setStreamingBlocks((prev) => {
          const idx = prev.findIndex(
            (b) => b.type === 'stage_start' && b.stage === stage,
          );
          if (idx >= 0) {
            return [
              ...prev.slice(0, idx),
              { type: 'stage_complete' as const, stage, result },
              ...prev.slice(idx + 1),
            ];
          }
          return [...prev, { type: 'stage_complete' as const, stage, result }];
        });
        break;
      }
      case 'complete':
        setStreamingBlocks((prev) =>
          prev.filter((b) => b.type !== 'tool_use' && b.type !== 'stage_start'),
        );
        break;
    }
  }, []);

  const handleSendMessage = useCallback(
    async (
      files: AttachedFile[],
      message: string | undefined,
      selectedAgent: Agent | null,
    ) => {
      const messageContent = message ?? inputMessage;
      if ((!messageContent.trim() && files.length === 0) || sending) return;

      const attachments: ChatAttachment[] = files.map((f) => ({
        id: f.id,
        type: f.type === 'image' ? 'image' : 'document',
        name: f.file.name,
        preview: f.preview,
      }));

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: messageContent.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputMessage('');
      setSending(true);
      setStreamingBlocks([]);
      pendingMessagesRef.current = [];

      try {
        const contentBlocks: ContentBlock[] = [];

        const usedDocNames = new Set<string>();
        const getUniqueDocName = (originalName: string): string => {
          let name = originalName;
          let counter = 1;
          while (usedDocNames.has(name)) {
            const dotIndex = originalName.lastIndexOf('.');
            if (dotIndex > 0) {
              name = `${originalName.slice(0, dotIndex)}_${counter}${originalName.slice(dotIndex)}`;
            } else {
              name = `${originalName}_${counter}`;
            }
            counter++;
          }
          usedDocNames.add(name);
          return name;
        };

        for (const attachedFile of files) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64Data = result.split(',')[1];
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(attachedFile.file);
          });

          if (attachedFile.type === 'image') {
            let format =
              attachedFile.file.type.split('/')[1] ||
              attachedFile.file.name.split('.').pop()?.toLowerCase() ||
              'png';
            if (format === 'jpeg') format = 'jpg';
            contentBlocks.push({
              image: { format, source: { base64 } },
            });
          } else {
            const format =
              attachedFile.file.name.split('.').pop()?.toLowerCase() || 'txt';
            const uniqueName = getUniqueDocName(attachedFile.file.name);
            contentBlocks.push({
              document: { format, name: uniqueName, source: { base64 } },
            });
          }
        }

        if (userMessage.content) {
          contentBlocks.push({ text: userMessage.content });
        }

        const response = await invokeAgent(
          contentBlocks,
          currentSessionId,
          projectId,
          handleStreamEvent,
          selectedAgent?.agent_id,
        );

        const pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, ...pending, assistantMessage]);
      } catch (error) {
        console.error('Failed to send message:', error);
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
      setSending(false);
      setStreamingBlocks([]);
      loadSessions();
    },
    [
      inputMessage,
      sending,
      invokeAgent,
      currentSessionId,
      projectId,
      handleStreamEvent,
      loadSessions,
    ],
  );

  const handleResearchMessage = useCallback(
    async (
      files: AttachedFile[],
      message: string | undefined,
      selectedAgent: Agent | null,
    ) => {
      if (!researchAgentRuntimeArn) {
        showToast('error', t('chat.researchNotAvailable'));
        return;
      }

      const messageContent = message ?? inputMessage;
      if ((!messageContent.trim() && files.length === 0) || sending) return;

      const attachments: ChatAttachment[] = files.map((f) => ({
        id: f.id,
        type: f.type === 'image' ? 'image' : 'document',
        name: f.file.name,
        preview: f.preview,
      }));

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: messageContent.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputMessage('');
      setSending(true);
      setStreamingBlocks([]);
      pendingMessagesRef.current = [];

      try {
        const contentBlocks: ContentBlock[] = [];

        const usedDocNames = new Set<string>();
        const getUniqueDocName = (originalName: string): string => {
          let name = originalName;
          let counter = 1;
          while (usedDocNames.has(name)) {
            const dotIndex = originalName.lastIndexOf('.');
            if (dotIndex > 0) {
              name = `${originalName.slice(0, dotIndex)}_${counter}${originalName.slice(dotIndex)}`;
            } else {
              name = `${originalName}_${counter}`;
            }
            counter++;
          }
          usedDocNames.add(name);
          return name;
        };

        for (const attachedFile of files) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64Data = result.split(',')[1];
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(attachedFile.file);
          });

          if (attachedFile.type === 'image') {
            let format =
              attachedFile.file.type.split('/')[1] ||
              attachedFile.file.name.split('.').pop()?.toLowerCase() ||
              'png';
            if (format === 'jpeg') format = 'jpg';
            contentBlocks.push({
              image: { format, source: { base64 } },
            });
          } else {
            const format =
              attachedFile.file.name.split('.').pop()?.toLowerCase() || 'txt';
            const uniqueName = getUniqueDocName(attachedFile.file.name);
            contentBlocks.push({
              document: { format, name: uniqueName, source: { base64 } },
            });
          }
        }

        if (userMessage.content) {
          contentBlocks.push({ text: userMessage.content });
        }

        const response = await invokeAgent(
          contentBlocks,
          currentSessionId,
          projectId,
          handleStreamEvent,
          selectedAgent?.agent_id,
          researchAgentRuntimeArn,
        );

        const pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, ...pending, assistantMessage]);
      } catch (error) {
        console.error('Failed to send research message:', error);
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
      setSending(false);
      setStreamingBlocks([]);
      loadSessions();
    },
    [
      inputMessage,
      sending,
      invokeAgent,
      currentSessionId,
      projectId,
      handleStreamEvent,
      loadSessions,
      researchAgentRuntimeArn,
      showToast,
      t,
    ],
  );

  return {
    currentSessionId,
    setCurrentSessionId,
    sessions,
    setSessions,
    sessionsNextCursor,
    loadingMoreSessions,
    messages,
    setMessages,
    inputMessage,
    setInputMessage,
    sending,
    setSending,
    streamingBlocks,
    setStreamingBlocks,
    loadingHistory,
    researchMode,
    setResearchMode,
    pendingMessagesRef,
    chatScrollPositionRef,
    researchAgentRuntimeArn,
    loadSessions,
    handleNewSession,
    loadMoreSessions,
    handleSessionSelect,
    handleSessionRename,
    handleSessionDelete,
    handleStreamEvent,
    handleSendMessage,
    handleResearchMessage,
  };
}
