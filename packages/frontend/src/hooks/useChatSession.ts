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

/** Convert streaming blocks to ChatMessage array (fallback when pendingMessagesRef is empty) */
function blocksToMessages(blocks: StreamingBlock[]): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      msgs.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: block.content,
        timestamp: new Date(),
      });
    } else if (block.type === 'tool_result') {
      msgs.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: block.content || '',
        timestamp: new Date(),
        isToolResult: true,
        toolResultType: block.resultType,
        sources: block.sources,
        toolName: block.toolName,
      });
    } else if (block.type === 'stage_complete') {
      msgs.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: block.result,
        timestamp: new Date(),
        isStageResult: true,
        stageName: block.stage,
      });
    }
  }
  return msgs;
}

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
  const toolUseMapRef = useRef<Map<string, string>>(new Map());
  const forceNewTextBlockRef = useRef(false);
  const chatScrollPositionRef = useRef(0);
  const streamingBlocksRef = useRef<StreamingBlock[]>([]);

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
              tool_use_id?: string;
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
          // Build tool_use_id → name map from all messages
          const HIDDEN_TOOLS = [
            'file_read',
            'file_write',
            'file_list',
            'shell',
          ];
          const toolIdToName = new Map<string, string>();
          for (const msg of response.messages) {
            for (const item of msg.content) {
              if (item.type === 'tool_use' && item.tool_use_id && item.name) {
                toolIdToName.set(item.tool_use_id, item.name);
              }
            }
          }

          const loadedMessages: (ChatMessage | null)[] = response.messages.map(
            (msg, idx) => {
              // --- assistant message with tool_use items ---
              const toolUseItems = msg.content.filter(
                (item) => item.type === 'tool_use',
              );
              if (msg.role === 'assistant' && toolUseItems.length > 0) {
                // Check if ALL tool_use items are hidden
                const allHidden = toolUseItems.every((t) =>
                  HIDDEN_TOOLS.includes(t.name || ''),
                );
                // Extract text content alongside tool_use
                const textContent = msg.content
                  .filter((item) => item.type === 'text' && item.text)
                  .map((item) => item.text)
                  .join('\n');
                if (allHidden && !textContent) return null;
                // Show text only (tool indicators are shown via tool_result)
                if (!textContent) return null;
                return {
                  id: `history-${idx}`,
                  role: 'assistant' as const,
                  content: textContent,
                  timestamp: new Date(),
                };
              }

              // --- user message with tool_result items ---
              const toolResultItems = msg.content.filter(
                (item) => item.type === 'tool_result',
              );
              if (msg.role === 'user' && toolResultItems.length > 0) {
                const results: ChatMessage[] = [];
                for (const toolResultItem of toolResultItems) {
                  const toolName =
                    toolIdToName.get(toolResultItem.tool_use_id || '') || '';

                  // Skip hidden tools
                  if (HIDDEN_TOOLS.includes(toolName)) continue;

                  const nestedContent = toolResultItem.content || [];
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
                          ? parsed.sources.filter(
                              (s: { document_id: string }) =>
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

                  let displayContent = textContent;
                  if (sources) {
                    try {
                      const parsed = JSON.parse(textContent);
                      displayContent = parsed.answer || textContent;
                    } catch {
                      // Not JSON
                    }
                  }

                  if (!displayContent && imageAttachments.length === 0)
                    continue;

                  results.push({
                    id: `history-${idx}-tr-${toolResultItem.tool_use_id || ''}`,
                    role: 'assistant' as const,
                    content:
                      toolResultType === 'artifact' ? '' : displayContent,
                    attachments:
                      imageAttachments.length > 0
                        ? imageAttachments
                        : undefined,
                    timestamp: new Date(),
                    isToolResult: true,
                    toolResultType,
                    artifact,
                    sources,
                    toolName: toolName || undefined,
                  });
                }
                // Return first result (others handled via flatMap below)
                if (results.length === 0) return null;
                if (results.length === 1) return results[0];
                // Store extras for flatMap expansion
                (
                  results[0] as ChatMessage & { _extras?: ChatMessage[] }
                )._extras = results.slice(1);
                return results[0];
              }

              // --- Regular text / image / document message ---
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

          // Expand messages with multiple tool_results
          const expandedMessages: (ChatMessage | null)[] =
            loadedMessages.flatMap((msg) => {
              if (!msg) return [null];
              const extras = (msg as ChatMessage & { _extras?: ChatMessage[] })
                ._extras;
              if (extras) {
                delete (msg as ChatMessage & { _extras?: ChatMessage[] })
                  ._extras;
                return [msg, ...extras];
              }
              return [msg];
            });

          const merged: ChatMessage[] = [];
          for (const msg of expandedMessages.filter(Boolean) as ChatMessage[]) {
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
    // Helper: update both streamingBlocks state and ref in sync
    const updateBlocks = (
      updater: (prev: StreamingBlock[]) => StreamingBlock[],
    ) => {
      setStreamingBlocks((prev) => {
        const next = updater(prev);
        streamingBlocksRef.current = next;
        return next;
      });
    };

    switch (event.type) {
      case 'text':
        if (event.content && typeof event.content === 'string') {
          const text = event.content;
          const forceNew = forceNewTextBlockRef.current;
          forceNewTextBlockRef.current = false;
          updateBlocks((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === 'text' && !forceNew) {
              return [
                ...prev.slice(0, -1),
                { type: 'text', content: last.content + text },
              ];
            }
            return [...prev, { type: 'text', content: text }];
          });
          // Also accumulate in pending messages to preserve order
          const pending = pendingMessagesRef.current;
          const lastPending = pending[pending.length - 1];
          if (
            lastPending &&
            !lastPending.isToolResult &&
            !lastPending.isStageResult &&
            !lastPending.isToolUse &&
            !forceNew
          ) {
            lastPending.content += text;
          } else {
            pending.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: text,
              timestamp: new Date(),
            });
          }
        }
        break;
      case 'tool_use': {
        const toolName = event.name ?? '';
        const toolUseId = event.tool_use_id ?? '';

        // Track tool_use_id → name mapping
        if (toolUseId) {
          toolUseMapRef.current.set(toolUseId, toolName);
        }

        // Hide internal tools from the UI
        const HIDDEN_TOOLS = ['file_read', 'file_write', 'file_list'];
        if (HIDDEN_TOOLS.includes(toolName)) {
          forceNewTextBlockRef.current = true;
          break;
        }

        forceNewTextBlockRef.current = true;
        updateBlocks((prev) => {
          // Skip if same toolUseId already shown
          if (
            toolUseId &&
            prev.some((b) => b.type === 'tool_use' && b.toolUseId === toolUseId)
          )
            return prev;
          return [...prev, { type: 'tool_use', name: toolName, toolUseId }];
        });
        break;
      }
      case 'tool_result': {
        const resultToolUseId = event.tool_use_id ?? '';
        const capturedToolName =
          toolUseMapRef.current.get(resultToolUseId) || '';

        // Skip results from hidden internal tools
        const HIDDEN_RESULT_TOOLS = ['file_read', 'file_write', 'file_list'];
        if (HIDDEN_RESULT_TOOLS.includes(capturedToolName)) {
          forceNewTextBlockRef.current = true;
          break;
        }

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

        updateBlocks((prev) => {
          // Find matching tool_use by toolUseId
          const matchIdx = resultToolUseId
            ? prev.findIndex(
                (b) => b.type === 'tool_use' && b.toolUseId === resultToolUseId,
              )
            : -1;
          const withoutToolUse =
            matchIdx >= 0
              ? [...prev.slice(0, matchIdx), ...prev.slice(matchIdx + 1)]
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
              toolUseId: resultToolUseId || undefined,
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
        updateBlocks((prev) => [...prev, { type: 'stage_start', stage }]);
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
        updateBlocks((prev) => {
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
        updateBlocks((prev) =>
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
      streamingBlocksRef.current = [];
      pendingMessagesRef.current = [];
      toolUseMapRef.current.clear();
      forceNewTextBlockRef.current = false;

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

        await invokeAgent(
          contentBlocks,
          currentSessionId,
          projectId,
          handleStreamEvent,
          selectedAgent?.agent_id,
        );

        // pending has all messages in order (text + tool_result + stage)
        let pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];

        // Fallback: if pending is empty, rebuild from streaming blocks ref
        if (pending.length === 0 && streamingBlocksRef.current.length > 0) {
          pending = blocksToMessages(streamingBlocksRef.current);
        }

        setMessages((prev) => [...prev, ...pending]);
      } catch (error) {
        console.error('Failed to send message:', error);
        // Preserve any content accumulated before the error
        let partial = pendingMessagesRef.current;
        pendingMessagesRef.current = [];
        if (partial.length === 0 && streamingBlocksRef.current.length > 0) {
          partial = blocksToMessages(streamingBlocksRef.current);
        }
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, ...partial, errorMessage]);
      }
      setSending(false);
      setStreamingBlocks([]);
      streamingBlocksRef.current = [];
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
      streamingBlocksRef.current = [];
      pendingMessagesRef.current = [];
      toolUseMapRef.current.clear();
      forceNewTextBlockRef.current = false;

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

        await invokeAgent(
          contentBlocks,
          currentSessionId,
          projectId,
          handleStreamEvent,
          selectedAgent?.agent_id,
          researchAgentRuntimeArn,
        );

        let pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];

        // Fallback: if pending is empty, rebuild from streaming blocks ref
        if (pending.length === 0 && streamingBlocksRef.current.length > 0) {
          pending = blocksToMessages(streamingBlocksRef.current);
        }

        setMessages((prev) => [...prev, ...pending]);
      } catch (error) {
        console.error('Failed to send research message:', error);
        let partial = pendingMessagesRef.current;
        pendingMessagesRef.current = [];
        if (partial.length === 0 && streamingBlocksRef.current.length > 0) {
          partial = blocksToMessages(streamingBlocksRef.current);
        }
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, ...partial, errorMessage]);
      }
      setSending(false);
      setStreamingBlocks([]);
      streamingBlocksRef.current = [];
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
