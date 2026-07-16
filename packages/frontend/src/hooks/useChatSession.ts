import { useState, useCallback, useRef, useEffect } from 'react';
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
import type {
  ReasoningLevel,
  LlmModel,
} from '../components/ChatPanel/ModelSelectorPrompt';
import { DEFAULT_MODEL_ID } from '../components/ChatPanel/models';
import type { BidiModelType } from './useVoiceChat';

const DEFAULT_REASONING: ReasoningLevel = 'medium';

// Remembers, per session id, the model LAST USED IN THIS BROWSER (localStorage
// only - NOT synced across browsers/devices, and lost if localStorage is
// cleared). Reopening a session on the same browser resumes with that model;
// otherwise the caller falls back to the catalog default. Accurate cross-device
// restore would require storing model_id in server session metadata (separate
// work).
const SESSION_MODEL_KEY = 'idp.sessionModels';

/** Read the whole session->model map, clearing the stored value if it is
 *  corrupted (invalid JSON) or not a plain object, so a bad value can't cause
 *  repeated parse failures on every access. */
function readSessionModelMap(): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_MODEL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      localStorage.removeItem(SESSION_MODEL_KEY);
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    // Corrupted JSON (raw was present but unparseable): drop it so subsequent
    // reads don't keep failing. Guard removeItem itself in case storage throws.
    if (raw !== null) {
      try {
        localStorage.removeItem(SESSION_MODEL_KEY);
      } catch {
        // storage unavailable - nothing more we can do
      }
    }
    return {};
  }
}

/** The model last used for this session in THIS browser, or null. Non-string
 *  entries are ignored. */
function loadSessionModel(sessionId: string): string | null {
  const value = readSessionModelMap()[sessionId];
  return typeof value === 'string' ? value : null;
}

function saveSessionModel(sessionId: string, modelId: string): void {
  try {
    const map = readSessionModelMap();
    if (map[sessionId] === modelId) return;
    map[sessionId] = modelId;
    localStorage.setItem(SESSION_MODEL_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable / quota - non-fatal, model just won't persist.
  }
}

function deleteSessionModel(sessionId: string): void {
  try {
    const map = readSessionModelMap();
    if (!(sessionId in map)) return;
    delete map[sessionId];
    localStorage.setItem(SESSION_MODEL_KEY, JSON.stringify(map));
  } catch {
    // non-fatal
  }
}

// Typewriter buffer for streamed answer text. The model streams text in uneven
// bursts (a big chunk, then a network/model gap, then more), which renders as a
// stuttering caret if drawn as-is. We buffer incoming text and reveal it at a
// steady fixed interval so bursts and gaps are absorbed and the caret moves
// smoothly. Char-based reveal (not word) so it works for Korean/CJK too. Only
// the on-screen streamingBlocks text is buffered; the final message content
// (pendingMessagesRef) is accumulated immediately for accuracy.
const TYPE_TICK_MS = 30; // reveal timer interval (~33 fps)
const TYPE_DRAIN_MS = 350; // aim to empty the current backlog over this window
const TYPE_MIN_CPS = 45; // floor chars/sec so a tiny trickle still moves
const TYPE_MAX_STEP = 24; // cap chars/tick so a huge burst doesn't dump at once

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
  models?: readonly LlmModel[];
  /** True once the catalog API has responded. Restoring a session's remembered
   *  model waits for this so the initial fallback list can't wrongly drop a
   *  custom (SSM-only) model. */
  modelsLoaded?: boolean;
}

export function useChatSession({
  projectId,
  models,
  modelsLoaded,
}: UseChatSessionOptions) {
  const { t } = useTranslation();
  const { fetchApi, invokeAgent } = useAwsClient();
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
  const pendingMessagesRef = useRef<ChatMessage[]>([]);
  const toolUseMapRef = useRef<Map<string, string>>(new Map());
  const toolInputMapRef = useRef<Map<string, Record<string, unknown>>>(
    new Map(),
  );
  const forceNewTextBlockRef = useRef(false);
  const chatScrollPositionRef = useRef(0);
  const streamingBlocksRef = useRef<StreamingBlock[]>([]);
  // Controls the in-flight agent request so the user can stop generation.
  const abortControllerRef = useRef<AbortController | null>(null);
  // Typewriter buffer: text received from the stream but not yet revealed, the
  // amount already shown, and the reveal timer.
  const typePendingRef = useRef('');
  const typeShownRef = useRef('');
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set by handleStreamEvent so stream teardown (end/abort/error) can drain and
  // stop the typewriter without re-declaring the closure.
  const flushTypewriterRef = useRef<(() => void) | null>(null);

  // Selected chat model + per-model reasoning level. Sent with each turn and
  // remembered across turns within a session.
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [reasonings, setReasonings] = useState<Record<string, ReasoningLevel>>(
    {},
  );
  // A model remembered for a just-opened session, held until the catalog loads
  // so we validate against the real catalog (not the initial fallback).
  const pendingModelRestoreRef = useRef<string | null>(null);

  // Keep stable refs of the catalog for use inside callbacks/effects.
  const modelsRef = useRef(models);
  modelsRef.current = models;

  // The catalog default is the first entry (matches models.ts DEFAULT_MODEL_ID
  // ordering); fall back to the built-in constant if the catalog is empty.
  const catalogDefaultId = models?.[0]?.value ?? DEFAULT_MODEL_ID;
  const isModelInCatalog = useCallback(
    (id: string) => !!modelsRef.current?.some((m) => m.value === id),
    [],
  );

  // Deferred validation: if a session was opened before the catalog loaded, we
  // stashed its remembered model; once loaded, drop it to the catalog default
  // if it's no longer offered (removed, or a model from another browser).
  useEffect(() => {
    if (!modelsLoaded) return;
    const pending = pendingModelRestoreRef.current;
    if (pending === null) return;
    pendingModelRestoreRef.current = null;
    if (!isModelInCatalog(pending)) {
      setModelId(catalogDefaultId);
    }
  }, [modelsLoaded, catalogDefaultId, isModelInCatalog]);

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

  const handleNewSession = useCallback((persistModelId?: string) => {
    const newSessionId = nanoid(33);
    setCurrentSessionId(newSessionId);
    setMessages([]);
    // Remember the chosen model against the new session id immediately (used
    // when a model change starts a fresh chat), so it's restored even before
    // the first message is sent.
    if (persistModelId) {
      saveSessionModel(newSessionId, persistModelId);
    }
    // Voice chat and agent reset are handled by the parent
    return newSessionId;
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

      // Restore the model last used for this session IN THIS BROWSER. Validate
      // against the current catalog: a remembered model that's no longer in the
      // catalog (removed, or another browser) falls back to the catalog default.
      // If the catalog hasn't loaded yet, stash the candidate and let the
      // deferred effect validate it once loaded (so the initial fallback list
      // can't wrongly drop a custom SSM-only model).
      const remembered = loadSessionModel(sessionId);
      if (!remembered) {
        pendingModelRestoreRef.current = null;
        setModelId(catalogDefaultId);
      } else if (modelsLoaded) {
        pendingModelRestoreRef.current = null;
        setModelId(
          isModelInCatalog(remembered) ? remembered : catalogDefaultId,
        );
      } else {
        // Defer validation until the catalog loads.
        pendingModelRestoreRef.current = remembered;
        setModelId(remembered);
      }

      const session = sessions.find((s) => s.session_id === sessionId);

      if (session?.agent_id?.startsWith('voice')) {
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
      } else if (
        session?.agent_id &&
        session.agent_id !== 'default' &&
        session.agent_id !== 'research'
      ) {
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
              input?: Record<string, unknown>;
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
          const toolIdToInput = new Map<string, Record<string, unknown>>();
          for (const msg of response.messages) {
            for (const item of msg.content) {
              if (item.type === 'tool_use' && item.tool_use_id && item.name) {
                toolIdToName.set(item.tool_use_id, item.name);
                if (item.input) {
                  toolIdToInput.set(item.tool_use_id, item.input);
                }
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
                  const isGraphResult =
                    toolName?.includes('graph_traverse') ||
                    toolName?.includes('graph_keyword');
                  if (sources && !isGraphResult) {
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
                    toolInput:
                      toolIdToInput.get(toolResultItem.tool_use_id || '') ||
                      undefined,
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
    [
      fetchApi,
      projectId,
      showToast,
      t,
      sessions,
      catalogDefaultId,
      modelsLoaded,
      isModelInCatalog,
    ],
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
      // Drop this session's remembered model from localStorage too.
      deleteSessionModel(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      if (sessionId === currentSessionId) {
        opts.voiceChatDisconnect();
        opts.setVoiceChatMode(false);
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

    // Write the currently-revealed text into the active (last) streaming text
    // block. Called by the reveal timer as it advances typeShownRef.
    const paintTypewriter = () => {
      const shown = typeShownRef.current;
      updateBlocks((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === 'text') {
          if (last.content === shown) return prev;
          return [...prev.slice(0, -1), { type: 'text', content: shown }];
        }
        return [...prev, { type: 'text', content: shown }];
      });
    };

    const stopTypeTimer = () => {
      if (typeTimerRef.current !== null) {
        clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
    };

    // Fixed-interval reveal: each tick advances by a near-constant amount
    // (scaled just enough to keep a large backlog from lagging), so bursts and
    // network gaps are absorbed and the caret moves steadily.
    const typeTick = () => {
      const backlog =
        typePendingRef.current.length - typeShownRef.current.length;
      if (backlog > 0) {
        const perTick = Math.min(
          TYPE_MAX_STEP,
          Math.max(
            Math.ceil((TYPE_MIN_CPS * TYPE_TICK_MS) / 1000),
            Math.ceil((backlog * TYPE_TICK_MS) / TYPE_DRAIN_MS),
          ),
        );
        typeShownRef.current = typePendingRef.current.slice(
          0,
          typeShownRef.current.length + perTick,
        );
        paintTypewriter();
      } else {
        stopTypeTimer();
      }
    };

    // Reveal all buffered text at once and stop the timer. Called before any
    // non-text event (to preserve order) and at stream end.
    const flushTypewriter = () => {
      stopTypeTimer();
      if (typePendingRef.current !== typeShownRef.current) {
        typeShownRef.current = typePendingRef.current;
        paintTypewriter();
      }
    };
    // Expose flush so stream teardown (end/abort) can drain the buffer.
    flushTypewriterRef.current = flushTypewriter;

    // Any non-text event must appear after all text received so far. Drain the
    // typewriter buffer into the active text block, then reset it so the next
    // text run types from empty.
    if (event.type !== 'text') {
      flushTypewriter();
      typePendingRef.current = '';
      typeShownRef.current = '';
    }

    switch (event.type) {
      case 'text':
        if (event.content && typeof event.content === 'string') {
          const text = event.content;
          const forceNew = forceNewTextBlockRef.current;
          forceNewTextBlockRef.current = false;

          // A forced break (after a tool block) starts a fresh text block:
          // flush the previous buffer into it, then reset the typewriter so the
          // new block types from empty.
          if (forceNew) {
            flushTypewriter();
            typePendingRef.current = '';
            typeShownRef.current = '';
            updateBlocks((prev) => [...prev, { type: 'text', content: '' }]);
          }

          // Buffer the on-screen text and let the timer reveal it steadily.
          typePendingRef.current += text;
          if (typeTimerRef.current === null) {
            typeTimerRef.current = setInterval(typeTick, TYPE_TICK_MS);
          }

          // Accumulate the final message content immediately (not buffered), so
          // the persisted/committed answer is always complete and correct.
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

        // Try to parse the streamed input (comes as an incrementally built JSON string)
        if (toolUseId && typeof event.input === 'string') {
          try {
            const parsed = JSON.parse(event.input) as Record<string, unknown>;
            toolInputMapRef.current.set(toolUseId, parsed);
          } catch {
            // Incomplete JSON - ignore until complete
          }
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
        const isGraphTool =
          capturedToolName?.includes('graph_traverse') ||
          capturedToolName?.includes('graph_keyword');
        if (toolResultType === 'text' && sources && !isGraphTool) {
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
          const toolInput = resultToolUseId
            ? toolInputMapRef.current.get(resultToolUseId)
            : undefined;
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
              toolInput,
            },
          ];
        });

        const savedToolInput = resultToolUseId
          ? toolInputMapRef.current.get(resultToolUseId)
          : undefined;
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
          toolInput: savedToolInput,
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
      toolInputMapRef.current.clear();
      forceNewTextBlockRef.current = false;
      // Reset the typewriter buffer for the new turn.
      if (typeTimerRef.current !== null) {
        clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
      typePendingRef.current = '';
      typeShownRef.current = '';

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

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Remember the model used for this session so reopening it later resumes
        // with the same model.
        saveSessionModel(currentSessionId, modelId);

        // Only send a reasoning level for models that support it; models like
        // Sonnet 4.6 have no effort control, so we omit reasoning entirely.
        const selectedModel = models?.find((m) => m.value === modelId);
        const reasoningToSend =
          selectedModel?.supportsReasoning === false
            ? undefined
            : (reasonings[modelId] ?? DEFAULT_REASONING);

        await invokeAgent(
          contentBlocks,
          currentSessionId,
          projectId,
          handleStreamEvent,
          selectedAgent?.agent_id,
          undefined,
          abortController.signal,
          modelId,
          reasoningToSend,
        );

        // Stream ended: drain any text still in the typewriter buffer so the
        // final frame is complete before we tear down streaming state.
        flushTypewriterRef.current?.();

        // pending has all messages in order (text + tool_result + stage)
        let pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];

        // Fallback: if pending is empty, rebuild from streaming blocks ref
        if (pending.length === 0 && streamingBlocksRef.current.length > 0) {
          pending = blocksToMessages(streamingBlocksRef.current);
        }

        setMessages((prev) => [...prev, ...pending]);
      } catch (error) {
        // Stop the typewriter (abort/error): reveal whatever was buffered.
        flushTypewriterRef.current?.();

        // Preserve any content accumulated before the error/stop
        let partial = pendingMessagesRef.current;
        pendingMessagesRef.current = [];
        if (partial.length === 0 && streamingBlocksRef.current.length > 0) {
          partial = blocksToMessages(streamingBlocksRef.current);
        }

        // User pressed Stop: keep the partial response, no error bubble.
        const isAbort =
          abortControllerRef.current?.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError');
        if (isAbort) {
          setMessages((prev) => [...prev, ...partial]);
        } else {
          console.error('Failed to send message:', error);
          const errorMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, ...partial, errorMessage]);
        }
      }
      abortControllerRef.current = null;
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
      modelId,
      reasonings,
      models,
    ],
  );

  // Stop the in-flight response. Aborting closes the HTTP stream, which the
  // agent runtime turns into a graceful cancellation; the partial response is
  // kept (handled in handleSendMessage's catch).
  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Clear the typewriter reveal timer on unmount.
  useEffect(() => {
    return () => {
      if (typeTimerRef.current !== null) {
        clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
    };
  }, []);

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
    pendingMessagesRef,
    chatScrollPositionRef,
    loadSessions,
    handleNewSession,
    loadMoreSessions,
    handleSessionSelect,
    handleSessionRename,
    handleSessionDelete,
    handleStreamEvent,
    handleSendMessage,
    stopStreaming,
    modelId,
    setModelId,
    reasonings,
    setReasonings,
  };
}
