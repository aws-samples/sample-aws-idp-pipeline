import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import {
  useAwsClient,
  StreamEvent,
  ContentBlock,
  ToolResultContent,
} from '../../hooks/useAwsClient';
import { useToast } from '../../components/Toast';
import {
  useWebSocketMessage,
  useWebSocket,
} from '../../contexts/WebSocketContext';
import CubeLoader from '../../components/CubeLoader';
import ConfirmModal from '../../components/ConfirmModal';
import ProjectSettingsModal, {
  Project,
} from '../../components/ProjectSettingsModal';
import ProjectNavBar from '../../components/ProjectNavBar';
import ChatPanel, {
  AttachedFile,
  type StreamingBlock,
} from '../../components/ChatPanel';
import SidePanel from '../../components/SidePanel';
import WorkflowDetailModal from '../../components/WorkflowDetailModal';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../../components/ui/resizable';
import {
  Document,
  DocumentUploadResponse,
  SegmentData,
  Workflow,
  WorkflowDetail,
  ChatMessage,
  ChatAttachment,
  ChatSession,
  StepStatus,
  WorkflowProgress,
  Agent,
  Artifact,
  ArtifactsResponse,
} from '../../types/project';
import AgentSelectModal from '../../components/AgentSelectModal';
import DocumentUploadModal, {
  type DocumentProcessingOptions,
} from '../../components/DocumentUploadModal';
import ArtifactViewer from '../../components/ArtifactViewer';
import SystemPromptModal from '../../components/SystemPromptModal';
import { useSetSidebarSessions } from '../../contexts/SidebarSessionContext';
import { useVoiceChat, BidiModelType } from '../../hooks/useVoiceChat';
import VoiceModelSettingsModal, {
  getStoredVoiceModelConfig,
} from '../../components/VoiceModelSettingsModal';

interface DocumentWorkflows {
  document_id: string;
  document_name: string;
  workflows: {
    workflow_id: string;
    status: string;
    file_name: string;
    file_uri: string;
    language: string | null;
    created_at: string;
    updated_at: string;
  }[];
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const {
    fetchApi,
    invokeAgent,
    getPresignedDownloadUrl,
    researchAgentRuntimeArn,
    bidiAgentRuntimeArn,
    userId,
  } = useAwsClient();
  const { showToast } = useToast();
  const { sendMessage, status: wsStatus } = useWebSocket();

  // Subscribe to project WebSocket notifications
  useEffect(() => {
    if (wsStatus === 'connected') {
      sendMessage({ action: 'subscribe', projectId });
    }
    // No need to unsubscribe on cleanup - server handles it on disconnect
  }, [projectId, sendMessage, wsStatus]);

  // Reset chat state when project changes
  useEffect(() => {
    setCurrentSessionId(nanoid(33));
    setMessages([]);
    setInputMessage('');
    setSending(false);
    setStreamingBlocks([]);
    setSelectedAgent(null);
    setSelectedArtifact(null);
    setVoiceChatMode(false);
    pendingMessagesRef.current = [];
    progressFetchedRef.current = false;
  }, [projectId]);

  // AgentCore requires session ID >= 33 chars
  const [currentSessionId, setCurrentSessionId] = useState(() => nanoid(33));
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsNextCursor, setSessionsNextCursor] = useState<string | null>(
    null,
  );
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const sidePanelSizeBeforeCollapse = useRef<number[]>([70, 30]);
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<StreamingBlock[]>([]);
  const pendingMessagesRef = useRef<ChatMessage[]>([]);
  const toolUseNameStackRef = useRef<string[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowDetail | null>(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [workflowProgressMap, setWorkflowProgressMap] = useState<
    Record<string, WorkflowProgress>
  >({});
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [initialSegmentIndex, setInitialSegmentIndex] = useState(0);
  const [loadingSourceKey, setLoadingSourceKey] = useState<string | null>(null);
  const progressFetchedRef = useRef(false);
  const sidePanelAutoExpandedRef = useRef(false);
  const chatScrollPositionRef = useRef(0);
  const [researchMode, setResearchMode] = useState(false);
  const [voiceChatMode, setVoiceChatMode] = useState(false);
  const [showVoiceModelSettings, setShowVoiceModelSettings] = useState(false);
  const [selectedVoiceModel, setSelectedVoiceModel] = useState<BidiModelType>(
    () => getStoredVoiceModelConfig().modelType,
  );

  // Voice Chat voice chat
  const voiceChat = useVoiceChat({
    sessionId: currentSessionId,
    projectId,
    userId: userId || '',
  });

  // Keep ref to voiceChat.disconnect for stable callback
  const voiceChatDisconnectRef = useRef(voiceChat.disconnect);
  voiceChatDisconnectRef.current = voiceChat.disconnect;

  // Connect Voice Chat with stored voice model config
  const handleVoiceChatConnect = useCallback(() => {
    const config = getStoredVoiceModelConfig();
    // Use the currently selected model from submenu
    config.modelType = selectedVoiceModel;
    // Set apiKey from the stored apiKeys for the selected model
    if (config.apiKeys) {
      config.apiKey = config.apiKeys[selectedVoiceModel as 'gemini' | 'openai'];
    }
    voiceChat.connect(config);
  }, [voiceChat, selectedVoiceModel]);

  // Handle voice model selection from submenu
  const handleVoiceModelSelect = useCallback(
    (modelType: BidiModelType) => {
      setSelectedVoiceModel(modelType);

      // For gemini/openai, check if API key exists
      if (modelType === 'gemini' || modelType === 'openai') {
        const config = getStoredVoiceModelConfig();
        const apiKey = config.apiKeys?.[modelType];
        if (!apiKey) {
          // No API key, open settings modal to prompt user to enter it
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
  // Uses actual last message in the array (not a ref) to decide append vs create,
  // so ordering is always correct regardless of event timing.
  useEffect(() => {
    /** Check if the last message can be appended to (same role, plain text) */
    const canAppendTo = (
      msg: (typeof messages)[number] | undefined,
      role: string,
    ) =>
      msg &&
      msg.role === role &&
      !msg.isToolUse &&
      !msg.isToolResult &&
      !msg.isStageResult;

    const unsubscribe = voiceChat.onTranscript((text, role, isFinal) => {
      const chatRole = role === 'user' ? 'user' : 'assistant';

      // Model-specific transcript handling:
      // - Gemini: is_final=false only (completely ignore is_final=true)
      // - Nova Sonic: is_final=false only, but is_final=true creates msg if role changed (ordering)
      // - OpenAI: is_final=true only (ignore is_final=false)

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

  // Handle Voice Chat tool use events - add to messages for correct ordering
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

  // Handle Voice Chat text input - add user message and send to WebSocket
  // If not connected, auto-connect first and queue the message
  const pendingVoiceTextRef = useRef<string | null>(null);

  const handleVoiceChatText = useCallback(
    (text: string) => {
      // Add user message to chat immediately
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
        // Queue message and auto-connect
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

  // Disconnect Voice Chat on page leave
  useEffect(() => {
    return () => {
      voiceChat.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Clear streaming blocks when Voice Chat connects or disconnects
  useEffect(() => {
    if (
      voiceChat.state.status === 'idle' ||
      voiceChat.state.status === 'error' ||
      voiceChat.state.status === 'connecting'
    ) {
      setStreamingBlocks([]);
    }
  }, [voiceChat.state.status]);

  // Persist panel sizes in localStorage
  const panelStorageKey = 'idp-panel-sizes-v2';
  const savedPanelSizes = useMemo(() => {
    try {
      const raw = localStorage.getItem(panelStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 2) {
          return parsed as number[];
        }
      }
    } catch {
      // ignore
    }
    return [70, 30];
  }, []);

  // Keep ref in sync with initial saved sizes
  useEffect(() => {
    sidePanelSizeBeforeCollapse.current = savedPanelSizes;
  }, [savedPanelSizes]);

  const handlePanelResizeEnd = useCallback(
    (details: { size: number[] }) => {
      try {
        localStorage.setItem(panelStorageKey, JSON.stringify(details.size));
        if (!sidePanelCollapsed && details.size.length === 2) {
          sidePanelSizeBeforeCollapse.current = details.size;
        }
      } catch {
        // ignore
      }
    },
    [sidePanelCollapsed],
  );

  // Ctrl+Shift+S keyboard shortcut for system prompt modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        setShowSystemPrompt(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadSystemPrompt = useCallback(async () => {
    try {
      const data = await fetchApi<{ content: string }>('prompts/system');
      return data.content;
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveSystemPrompt = useCallback(
    async (content: string) => {
      await fetchApi('prompts/system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      showToast('success', t('systemPrompt.saveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadVoiceSystemPrompt = useCallback(async () => {
    try {
      const data = await fetchApi<{ content: string }>('prompts/voice-system');
      return data.content;
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveVoiceSystemPrompt = useCallback(
    async (content: string) => {
      await fetchApi('prompts/voice-system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      showToast('success', t('voiceSystemPrompt.saveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadWebcrawlerPrompt = useCallback(async () => {
    try {
      const data = await fetchApi<{ content: string }>('prompts/webcrawler');
      return data.content;
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveWebcrawlerPrompt = useCallback(
    async (content: string) => {
      await fetchApi('prompts/webcrawler', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      showToast('success', t('systemPrompt.webcrawlerSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const SEPARATOR = '\n---\n';

  const loadAnalysisDocPrompt = useCallback(async () => {
    try {
      const [system, userQuery, image] = await Promise.all([
        fetchApi<{ content: string }>('prompts/analysis/system'),
        fetchApi<{ content: string }>('prompts/analysis/user-query'),
        fetchApi<{ content: string }>('prompts/analysis/image'),
      ]);
      return [system.content, userQuery.content, image.content].join(SEPARATOR);
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveAnalysisDocPrompt = useCallback(
    async (content: string) => {
      const parts = content.split(SEPARATOR);
      const keys = ['system', 'user-query', 'image'];
      await Promise.all(
        keys.map((key, i) =>
          fetchApi(`prompts/analysis/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts[i] || '' }),
          }),
        ),
      );
      showToast('success', t('systemPrompt.analysisDocSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadAnalysisVideoPrompt = useCallback(async () => {
    try {
      const [system, userQuery, video] = await Promise.all([
        fetchApi<{ content: string }>('prompts/analysis/video-system'),
        fetchApi<{ content: string }>('prompts/analysis/video-user-query'),
        fetchApi<{ content: string }>('prompts/analysis/video'),
      ]);
      return [system.content, userQuery.content, video.content].join(SEPARATOR);
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveAnalysisVideoPrompt = useCallback(
    async (content: string) => {
      const parts = content.split(SEPARATOR);
      const keys = ['video-system', 'video-user-query', 'video'];
      await Promise.all(
        keys.map((key, i) =>
          fetchApi(`prompts/analysis/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts[i] || '' }),
          }),
        ),
      );
      showToast('success', t('systemPrompt.analysisVideoSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadAnalysisTextPrompt = useCallback(async () => {
    try {
      const [system, userQuery] = await Promise.all([
        fetchApi<{ content: string }>('prompts/analysis/text-system'),
        fetchApi<{ content: string }>('prompts/analysis/text-user-query'),
      ]);
      return [system.content, userQuery.content].join(SEPARATOR);
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveAnalysisTextPrompt = useCallback(
    async (content: string) => {
      const parts = content.split(SEPARATOR);
      const keys = ['text-system', 'text-user-query'];
      await Promise.all(
        keys.map((key, i) =>
          fetchApi(`prompts/analysis/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts[i] || '' }),
          }),
        ),
      );
      showToast('success', t('systemPrompt.analysisTextSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  // Memoize system prompt tabs to avoid infinite loop in SystemPromptModal
  const systemPromptTabs = useMemo(
    () => [
      {
        type: 'chat' as const,
        onLoad: loadSystemPrompt,
        onSave: saveSystemPrompt,
      },
      {
        type: 'voice' as const,
        onLoad: loadVoiceSystemPrompt,
        onSave: saveVoiceSystemPrompt,
      },
      {
        type: 'webcrawler' as const,
        onLoad: loadWebcrawlerPrompt,
        onSave: saveWebcrawlerPrompt,
      },
      {
        type: 'analysis-doc' as const,
        onLoad: loadAnalysisDocPrompt,
        onSave: saveAnalysisDocPrompt,
      },
      {
        type: 'analysis-video' as const,
        onLoad: loadAnalysisVideoPrompt,
        onSave: saveAnalysisVideoPrompt,
      },
      {
        type: 'analysis-text' as const,
        onLoad: loadAnalysisTextPrompt,
        onSave: saveAnalysisTextPrompt,
      },
    ],
    [
      loadSystemPrompt,
      saveSystemPrompt,
      loadVoiceSystemPrompt,
      saveVoiceSystemPrompt,
      loadWebcrawlerPrompt,
      saveWebcrawlerPrompt,
      loadAnalysisDocPrompt,
      saveAnalysisDocPrompt,
      loadAnalysisVideoPrompt,
      saveAnalysisVideoPrompt,
      loadAnalysisTextPrompt,
      saveAnalysisTextPrompt,
    ],
  );

  const loadProject = useCallback(async () => {
    try {
      const data = await fetchApi<Project>(`projects/${projectId}`);
      setProject(data);
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  }, [fetchApi, projectId]);

  const loadDocuments = useCallback(async () => {
    try {
      const data = await fetchApi<Document[]>(
        `projects/${projectId}/documents`,
      );
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
      setDocuments([]);
    }
  }, [fetchApi, projectId]);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await fetchApi<DocumentWorkflows[]>(
        `projects/${projectId}/workflows`,
      );
      const allWorkflows: Workflow[] = data.flatMap((doc) =>
        doc.workflows.map((wf) => ({
          ...wf,
          document_id: doc.document_id,
        })),
      );
      setWorkflows(allWorkflows);
    } catch (error) {
      console.error('Failed to load workflows:', error);
      setWorkflows([]);
    }
  }, [fetchApi, projectId]);

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
    setSelectedAgent(null);
    setResearchMode(false);
    setVoiceChatMode(false);
    voiceChatDisconnectRef.current();
  }, []);

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const data = await fetchApi<Agent[]>(`projects/${projectId}/agents`);
      setAgents(data);
    } catch (error) {
      console.error('Failed to load agents:', error);
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, [fetchApi, projectId]);

  const loadArtifacts = useCallback(async () => {
    try {
      const data = await fetchApi<ArtifactsResponse>(
        `artifacts?project_id=${projectId}`,
      );
      setArtifacts(data.items);
    } catch (error) {
      console.error('Failed to load artifacts:', error);
      setArtifacts([]);
    }
  }, [fetchApi, projectId]);

  // WebSocket artifact event handler
  const handleArtifactMessage = useCallback(
    (data: {
      event: string;
      artifactId: string;
      artifactFileName: string;
      timestamp: string;
    }) => {
      if (data.event === 'created') {
        // Refresh artifacts list when a new artifact is created
        loadArtifacts();
      }
    },
    [loadArtifacts],
  );

  useWebSocketMessage('artifacts', handleArtifactMessage);

  // WebSocket workflow status change handler
  const handleWorkflowMessage = useCallback(
    (data: {
      event: string;
      workflowId: string;
      documentId: string;
      projectId: string;
      status: string;
      previousStatus?: string;
      timestamp: string;
    }) => {
      // Only handle events for this project
      if (data.projectId !== projectId) {
        return;
      }

      if (data.event === 'status_changed') {
        if (data.status === 'in_progress') {
          // Create/update progress entry when workflow starts
          setWorkflowProgressMap((prev) => {
            const existing = prev[data.documentId];
            return {
              ...prev,
              [data.documentId]: {
                workflowId: data.workflowId,
                documentId: data.documentId,
                fileName: existing?.fileName || '',
                status: 'in_progress',
                currentStep:
                  existing?.currentStep ||
                  t('workflow.starting', 'Starting...'),
                stepMessage: '',
                segmentProgress: existing?.segmentProgress || null,
                error: null,
                steps: existing?.steps || {},
              },
            };
          });

          // Merge workflow into workflows state
          setWorkflows((prev) => {
            if (prev.some((w) => w.workflow_id === data.workflowId))
              return prev;
            return [
              ...prev,
              {
                workflow_id: data.workflowId,
                document_id: data.documentId,
                status: 'in_progress',
                file_name: '',
                file_uri: '',
                language: null,
                created_at: data.timestamp,
                updated_at: data.timestamp,
              },
            ];
          });
        } else if (data.status === 'completed' || data.status === 'failed') {
          // Update progress status
          setWorkflowProgressMap((prev) => {
            if (!prev[data.documentId]) return prev;
            return {
              ...prev,
              [data.documentId]: {
                ...prev[data.documentId],
                status: data.status as 'completed' | 'failed',
              },
            };
          });

          // Refresh documents after a delay for DynamoDB eventual consistency
          setTimeout(() => {
            loadDocuments();
          }, 1500);
        }

        loadWorkflows();
      }
    },
    [projectId, loadDocuments, loadWorkflows, t],
  );

  useWebSocketMessage('workflow', handleWorkflowMessage);

  // Step labels for display
  const stepLabels = useMemo<Record<string, string>>(
    () => ({
      segment_prep: t('workflow.steps.segmentPrep'),
      webcrawler: t('workflow.steps.webcrawler'),
      bda_processor: t('workflow.steps.bdaProcessing'),
      format_parser: t('workflow.steps.formatParsing'),
      paddleocr_processor: t('workflow.steps.paddleocrProcessing'),
      transcribe: t('workflow.steps.transcription'),
      segment_builder: t('workflow.steps.buildingSegments'),
      segment_analyzer: t('workflow.steps.segmentAiAnalysis'),
      document_summarizer: t('workflow.steps.documentSummary'),
    }),
    [t],
  );

  // Fetch document progress from API
  const fetchDocumentProgress = useCallback(async () => {
    try {
      const progressData = await fetchApi<
        {
          document_id: string;
          workflow_id: string;
          status: string;
          current_step: string;
          steps: Record<string, { status: string; label: string }>;
        }[]
      >(`projects/${projectId}/documents/progress`);

      setWorkflowProgressMap((prev) => {
        const newMap = { ...prev };
        for (const progress of progressData) {
          const doc = documents.find(
            (d) => d.document_id === progress.document_id,
          );

          const steps: Record<string, StepStatus> = {};
          if (progress.steps) {
            for (const [key, val] of Object.entries(progress.steps)) {
              steps[key] = {
                status: val.status as StepStatus['status'],
                label: stepLabels[key] || val.label,
              };
            }
          }

          const currentStepLabel = progress.current_step
            ? stepLabels[progress.current_step] || progress.current_step
            : '';

          newMap[progress.document_id] = {
            workflowId: progress.workflow_id,
            documentId: progress.document_id,
            fileName: doc?.name || prev[progress.document_id]?.fileName || '',
            status: progress.status as WorkflowProgress['status'],
            currentStep: currentStepLabel,
            stepMessage: '',
            segmentProgress: null,
            error: progress.status === 'failed' ? 'Workflow failed' : null,
            steps,
          };
        }
        return newMap;
      });
    } catch (error) {
      console.error('Failed to fetch document progress:', error);
    }
  }, [fetchApi, projectId, documents, stepLabels]);

  // Sync state on WebSocket reconnect to catch missed messages
  const fetchProgressRef = useRef(fetchDocumentProgress);
  const loadWorkflowsRef = useRef(loadWorkflows);
  const loadDocumentsRef = useRef(loadDocuments);
  fetchProgressRef.current = fetchDocumentProgress;
  loadWorkflowsRef.current = loadWorkflows;
  loadDocumentsRef.current = loadDocuments;

  const prevWsStatusRef = useRef(wsStatus);
  const wsConnectedOnceRef = useRef(false);
  useEffect(() => {
    const wasDisconnected = prevWsStatusRef.current !== 'connected';
    prevWsStatusRef.current = wsStatus;

    if (wsStatus === 'connected') {
      if (wasDisconnected && wsConnectedOnceRef.current) {
        // Actual reconnect - sync state
        fetchProgressRef.current();
        loadWorkflowsRef.current();
      }
      wsConnectedOnceRef.current = true;
    }
  }, [wsStatus]);

  // WebSocket step progress handler - refetch progress on any step change
  const handleStepMessage = useCallback(
    (data: {
      event: string;
      workflowId: string;
      documentId: string;
      projectId: string;
      stepName: string;
      status: string;
      previousStatus?: string;
      currentStep?: string;
      timestamp: string;
    }) => {
      // Only handle events for this project
      if (data.projectId !== projectId) {
        return;
      }

      if (data.event === 'step_changed') {
        // Refetch progress from API to get complete state
        fetchDocumentProgress();
      }
    },
    [projectId, fetchDocumentProgress],
  );

  useWebSocketMessage('step', handleStepMessage);

  const loadAgentDetail = useCallback(
    async (agentId: string): Promise<Agent | null> => {
      try {
        return await fetchApi<Agent>(
          `projects/${projectId}/agents/${encodeURIComponent(agentId)}`,
        );
      } catch (error) {
        console.error('Failed to load agent detail:', error);
        return null;
      }
    },
    [fetchApi, projectId],
  );

  const handleAgentCreate = useCallback(
    async (name: string, content: string) => {
      await fetchApi(`projects/${projectId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      await loadAgents();
    },
    [fetchApi, projectId, loadAgents],
  );

  const handleAgentUpdate = useCallback(
    async (agentId: string, content: string) => {
      // Get current agent to preserve name
      const agent = agents.find((a) => a.agent_id === agentId);
      if (!agent) return;

      await fetchApi(
        `projects/${projectId}/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: agent.name, content }),
        },
      );
      await loadAgents();
    },
    [fetchApi, projectId, loadAgents, agents],
  );

  const handleAgentDelete = useCallback(
    async (agentId: string) => {
      await fetchApi(
        `projects/${projectId}/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'DELETE',
        },
      );
      await loadAgents();
      // Reset to default if deleted agent was selected
      if (selectedAgent?.agent_id === agentId) {
        setSelectedAgent(null);
        handleNewSession();
      }
    },
    [fetchApi, projectId, loadAgents, selectedAgent, handleNewSession],
  );

  const handleAgentSelect = useCallback(
    (agentName: string | null) => {
      // Start new session first (this resets selectedAgent to null)
      handleNewSession();

      // Then set the agent after session reset
      if (agentName === null) {
        setSelectedAgent(null);
      } else {
        const agent = agents.find((a) => a.name === agentName);
        setSelectedAgent(agent || null);
      }
    },
    [agents, handleNewSession],
  );

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
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      setMessages([]);
      setLoadingHistory(true);

      // Match agent from session
      const session = sessions.find((s) => s.session_id === sessionId);

      // Check if this is a voice session (voice_nova_sonic, voice_gemini, voice_openai)
      // Also handle legacy 'voice' agent_id for backward compatibility
      if (session?.agent_id?.startsWith('voice')) {
        setResearchMode(false);
        setVoiceChatMode(true);
        setSelectedAgent(null);
        // Extract model type from agent_id (e.g., "voice_gemini" -> "gemini")
        const modelType = session.agent_id.replace(
          'voice_',
          '',
        ) as BidiModelType;
        if (
          modelType === 'nova_sonic' ||
          modelType === 'gemini' ||
          modelType === 'openai'
        ) {
          setSelectedVoiceModel(modelType);
        } else {
          // Legacy 'voice' or unknown - default to nova_sonic
          setSelectedVoiceModel('nova_sonic');
        }
      } else if (session?.agent_id === 'research') {
        // Research mode session
        setResearchMode(true);
        setVoiceChatMode(false);
        setSelectedAgent(null);
      } else if (session?.agent_id && session.agent_id !== 'default') {
        setResearchMode(false);
        setVoiceChatMode(false);
        const agent = agents.find(
          (a) => a.agent_id === session.agent_id || a.name === session.agent_id,
        );
        if (agent) {
          setSelectedAgent(agent);
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
          setSelectedAgent(null);
        }
      } else {
        setResearchMode(false);
        setVoiceChatMode(false);
        setSelectedAgent(null);
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
              // For tool_result type
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
              // Check if this is a tool_result message
              const toolResultItem = msg.content.find(
                (item) => item.type === 'tool_result',
              );

              if (toolResultItem && toolResultItem.content) {
                // Handle tool_result - show as assistant message
                const nestedContent = toolResultItem.content;

                // Extract text from nested content
                const textContent = nestedContent
                  .filter(
                    (item) =>
                      (item.type === 'text' || (!item.type && item.text)) &&
                      item.text,
                  )
                  .map((item) => item.text)
                  .join('\n');

                // Check if this is an artifact result (JSON with artifact_id)
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
                  // Not JSON, continue with normal processing
                }

                // Extract images from nested content
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

                // Extract answer text when sources are present
                let historyDisplayContent = textContent;
                if (sources) {
                  try {
                    const parsed = JSON.parse(textContent);
                    historyDisplayContent = parsed.answer || textContent;
                  } catch {
                    // Not JSON, use raw text
                  }
                }

                // Infer tool name from content structure
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

              // Extract text content
              const textContent = msg.content
                .filter((item) => item.type === 'text' && item.text)
                .map((item) => item.text)
                .join('\n');

              // Extract image attachments
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

              // Extract document attachments
              const documentAttachments: ChatAttachment[] = msg.content
                .filter((item) => item.type === 'document' && item.name)
                .map((item, docIdx) => {
                  const baseName = item.name || `document-${docIdx + 1}`;
                  // If name doesn't have an extension, append format
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
          setMessages(loadedMessages);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
        showToast('error', t('chat.loadError', 'Failed to load conversation'));
        setCurrentSessionId(nanoid(33));
      } finally {
        setLoadingHistory(false);
      }
    },
    [fetchApi, projectId, showToast, t, sessions, agents],
  );

  const handleSessionRename = useCallback(
    async (sessionId: string, newName: string) => {
      await fetchApi(`chat/projects/${projectId}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_name: newName }),
      });
      // Update local state
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === sessionId ? { ...s, session_name: newName } : s,
        ),
      );
    },
    [fetchApi, projectId],
  );

  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      await fetchApi(`chat/projects/${projectId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      // Remove from local state
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      // If deleted session was current, start new conversation
      if (sessionId === currentSessionId) {
        voiceChat.disconnect();
        setVoiceChatMode(false);
        setResearchMode(false);
        setSelectedAgent(null);
        setCurrentSessionId(nanoid(33));
        setMessages([]);
        setStreamingBlocks([]);
      }
    },
    [fetchApi, projectId, currentSessionId],
  );

  const handleArtifactDelete = useCallback(
    async (artifactId: string) => {
      await fetchApi(`artifacts/${artifactId}`, {
        method: 'DELETE',
      });
      setArtifacts((prev) => prev.filter((a) => a.artifact_id !== artifactId));
      // Close viewer if deleted artifact was being viewed
      if (selectedArtifact?.artifact_id === artifactId) {
        setSelectedArtifact(null);
      }
    },
    [fetchApi, selectedArtifact],
  );

  const handleArtifactSelect = useCallback(
    (artifactId: string) => {
      const artifact = artifacts.find((a) => a.artifact_id === artifactId);
      if (artifact) {
        if (sidePanelCollapsed) {
          setSidePanelCollapsed(false);
          sidePanelAutoExpandedRef.current = true;
        }
        setSelectedArtifact(artifact);
      }
    },
    [artifacts, sidePanelCollapsed],
  );

  const handleArtifactDownload = useCallback(
    async (artifact: Artifact) => {
      try {
        const presignedUrl = await getPresignedDownloadUrl(
          artifact.s3_bucket,
          artifact.s3_key,
        );

        const response = await fetch(presignedUrl);

        if (!response.ok) {
          if (response.status === 404 || response.status === 403) {
            showToast(
              'error',
              t(
                'chat.artifactNotFound',
                'File not found. It may have been deleted.',
              ),
            );
            return;
          }
          throw new Error(`Download failed: ${response.status}`);
        }

        const blob = await response.blob();

        if (blob.type.includes('xml')) {
          const text = await blob.text();
          if (text.includes('NoSuchKey')) {
            showToast(
              'error',
              t(
                'chat.artifactNotFound',
                'File not found. It may have been deleted.',
              ),
            );
            return;
          }
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = artifact.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Failed to download artifact:', error);
        showToast('error', t('chat.downloadFailed', 'Download failed'));
      }
    },
    [getPresignedDownloadUrl, showToast, t],
  );

  const loadWorkflowDetail = useCallback(
    async (documentId: string, workflowId: string) => {
      setLoadingWorkflow(true);
      try {
        const data = await fetchApi<WorkflowDetail>(
          `documents/${documentId}/workflows/${workflowId}`,
        );
        setSelectedWorkflow(data);
      } catch (error) {
        console.error('Failed to load workflow detail:', error);
        showToast(
          'error',
          t('workflow.loadError', 'Failed to load workflow details'),
        );
      }
      setLoadingWorkflow(false);
    },
    [fetchApi, showToast, t],
  );

  const loadSegment = useCallback(
    async (
      documentId: string,
      workflowId: string,
      segmentIndex: number,
    ): Promise<SegmentData> => {
      const data = await fetchApi<SegmentData>(
        `documents/${documentId}/workflows/${workflowId}/segments/${segmentIndex}`,
      );
      return data;
    },
    [fetchApi],
  );

  // Memoized callback for WorkflowDetailModal to prevent infinite re-renders
  const handleLoadSegment = useCallback(
    (segmentIndex: number) => {
      if (!selectedWorkflow) return Promise.reject('No workflow selected');
      return loadSegment(
        selectedWorkflow.document_id,
        selectedWorkflow.workflow_id,
        segmentIndex,
      );
    },
    [loadSegment, selectedWorkflow],
  );

  const handleReanalyze = useCallback(
    async (userInstructions: string) => {
      if (!selectedWorkflow) return;

      setReanalyzing(true);
      try {
        await fetchApi<{
          workflow_id: string;
          execution_arn: string;
          status: string;
        }>(
          `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/reanalyze`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_instructions: userInstructions }),
          },
        );
        showToast('success', t('workflow.reanalyzeStarted'));
        setSelectedWorkflow(null);
        // Refresh workflows list
        loadWorkflows();
      } catch (error) {
        console.error('Failed to start re-analysis:', error);
        showToast('error', t('workflow.reanalyzeFailed'));
      } finally {
        setReanalyzing(false);
      }
    },
    [fetchApi, selectedWorkflow, showToast, t, loadWorkflows],
  );

  const handleRegenerateQa = useCallback(
    async (
      segmentIndex: number,
      qaIndex: number,
      question: string,
      userInstructions: string,
    ) => {
      if (!selectedWorkflow) throw new Error('No workflow selected');

      const result = await fetchApi<{
        analysis_query: string;
        content: string;
      }>(
        `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/segments/${segmentIndex}/regenerate-qa`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            qa_index: qaIndex,
            question,
            user_instructions: userInstructions,
          }),
        },
      );

      return result;
    },
    [fetchApi, selectedWorkflow],
  );

  const handleAddQa = useCallback(
    async (
      segmentIndex: number,
      question: string,
      userInstructions: string,
    ) => {
      if (!selectedWorkflow) throw new Error('No workflow selected');

      const result = await fetchApi<{
        analysis_query: string;
        content: string;
        qa_index: number;
      }>(
        `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/segments/${segmentIndex}/add-qa`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            user_instructions: userInstructions,
          }),
        },
      );

      return result;
    },
    [fetchApi, selectedWorkflow],
  );

  const handleDeleteQa = useCallback(
    async (segmentIndex: number, qaIndex: number) => {
      if (!selectedWorkflow) throw new Error('No workflow selected');

      const result = await fetchApi<{
        deleted: boolean;
        deleted_query: string;
        qa_index: number;
      }>(
        `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/segments/${segmentIndex}/qa/${qaIndex}`,
        {
          method: 'DELETE',
        },
      );

      return result;
    },
    [fetchApi, selectedWorkflow],
  );

  const handleSourceClick = useCallback(
    async (documentId: string, segmentId: string) => {
      const workflow = workflows.find((w) => w.document_id === documentId);
      if (!workflow) return;
      const segIdx = parseInt(segmentId.split('_').pop() || '0', 10);
      setInitialSegmentIndex(segIdx);
      setLoadingSourceKey(`${documentId}:${segmentId}`);
      await loadWorkflowDetail(documentId, workflow.workflow_id);
      setLoadingSourceKey(null);
    },
    [workflows, loadWorkflowDetail],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([
        loadProject(),
        loadDocuments(),
        loadWorkflows(),
        loadSessions(),
        loadAgents(),
        loadArtifacts(),
      ]);
      setLoading(false);
    };
    load();
  }, [
    loadProject,
    loadDocuments,
    loadWorkflows,
    loadSessions,
    loadAgents,
    loadArtifacts,
  ]);

  // Fetch real step progress for in-progress workflows on page load (once)
  useEffect(() => {
    if (loading) return;
    if (progressFetchedRef.current) return;

    const inProgressWorkflows = workflows.filter(
      (w) => w.status === 'in_progress' || w.status === 'processing',
    );
    if (inProgressWorkflows.length === 0) return;

    progressFetchedRef.current = true;
    fetchProgressRef.current();
  }, [loading, workflows]);

  // Handle workflow completion/failure - clear completed/failed after delay
  useEffect(() => {
    const completedDocIds = Object.entries(workflowProgressMap)
      .filter(
        ([, progress]) =>
          progress.status === 'completed' || progress.status === 'failed',
      )
      .map(([docId]) => docId);

    if (completedDocIds.length === 0) return;

    loadDocumentsRef.current();
    loadWorkflowsRef.current();
    const timeout = setTimeout(() => {
      setWorkflowProgressMap((prev) => {
        const newMap = { ...prev };
        for (const docId of completedDocIds) {
          delete newMap[docId];
        }
        return newMap;
      });
    }, 5000);
    return () => clearTimeout(timeout);
  }, [workflowProgressMap]);

  const processFiles = async (
    files: File[],
    options: DocumentProcessingOptions,
  ) => {
    if (files.length === 0) return;

    const maxSize = 500 * 1024 * 1024; // 500MB
    const uploadedDocuments: { documentId: string; fileName: string }[] = [];

    setUploading(true);
    setShowUploadModal(false);
    try {
      for (const file of Array.from(files)) {
        // Check file size
        if (file.size > maxSize) {
          console.error(`File ${file.name} exceeds 500MB limit`);
          continue;
        }

        // Step 1: Request presigned URL from backend
        const uploadInfo = await fetchApi<DocumentUploadResponse>(
          `projects/${projectId}/documents`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_name: file.name,
              content_type: file.type || 'application/octet-stream',
              file_size: file.size,
              use_bda: options.use_bda,
              use_ocr: options.use_ocr,
              ocr_model: options.ocr_model,
              ocr_options: options.ocr_options,
              document_prompt: options.document_prompt,
            }),
          },
        );

        uploadedDocuments.push({
          documentId: uploadInfo.document_id,
          fileName: file.name,
        });

        // Immediately add document to list (optimistic update)
        setDocuments((prev) => [
          ...prev,
          {
            document_id: uploadInfo.document_id,
            name: file.name,
            file_type: file.type || 'application/octet-stream',
            file_size: file.size,
            status: 'uploading',
            use_bda: options.use_bda,
            started_at: new Date().toISOString(),
            ended_at: null,
          },
        ]);

        // Set initial progress for this document
        setWorkflowProgressMap((prev) => ({
          ...prev,
          [uploadInfo.document_id]: {
            workflowId: '',
            documentId: uploadInfo.document_id,
            fileName: file.name,
            status: 'pending',
            currentStep: t('workflow.uploading', 'Uploading...'),
            stepMessage: '',
            segmentProgress: null,
            error: null,
          },
        }));

        // Step 2: Upload file directly to S3 using presigned URL
        const uploadResponse = await fetch(uploadInfo.upload_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${file.name} to S3`);
        }

        // Step 3: Update document status to uploaded (workflow will change to in_progress/completed)
        await fetchApi(
          `projects/${projectId}/documents/${uploadInfo.document_id}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'uploaded' }),
          },
        );
      }
      await loadDocuments();
    } catch (error) {
      console.error('Failed to upload document:', error);
    }
    setUploading(false);
  };

  const handleDeleteDocument = (documentId: string) => {
    const doc = documents.find((d) => d.document_id === documentId);
    if (doc) {
      setDeleteTarget(doc);
    }
  };

  const confirmDeleteDocument = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchApi(
        `projects/${projectId}/documents/${deleteTarget.document_id}`,
        {
          method: 'DELETE',
        },
      );
      await loadDocuments();
      setDeleteTarget(null);
    } catch (error) {
      console.error('Failed to delete document:', error);
    } finally {
      setDeleting(false);
    }
  };

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
        // Capture tool name synchronously from stack (pushed during tool_use)
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
            // Filter sources to only those actually referenced in the answer
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

        // Skip empty tool results
        if (!textContent && imageAttachments.length === 0) break;

        // Determine display content for the streaming block
        let displayContent: string | undefined;
        if (toolResultType === 'text' && sources) {
          // Search result with sources - show the answer part
          try {
            const parsed = JSON.parse(textContent);
            displayContent = parsed.answer || textContent;
          } catch {
            displayContent = textContent;
          }
        } else if (toolResultType === 'text') {
          displayContent = textContent;
        }

        // Remove tool_use block and add tool_result in a single update
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
    async (files: AttachedFile[], message?: string) => {
      // Use provided message or fall back to inputMessage state
      const messageContent = message ?? inputMessage;
      if ((!messageContent.trim() && files.length === 0) || sending) return;

      // Convert AttachedFile to ChatAttachment for display
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
        // Convert files to ContentBlock[]
        const contentBlocks: ContentBlock[] = [];

        // Track document names to ensure uniqueness (Bedrock requires unique names)
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

        // Process attached files
        for (const attachedFile of files) {
          // Use FileReader for reliable base64 encoding
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // Remove data URL prefix (e.g., "data:image/png;base64,")
              const base64Data = result.split(',')[1];
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(attachedFile.file);
          });

          if (attachedFile.type === 'image') {
            // Extract and normalize format (jpeg -> jpg for backend compatibility)
            let format =
              attachedFile.file.type.split('/')[1] ||
              attachedFile.file.name.split('.').pop()?.toLowerCase() ||
              'png';
            if (format === 'jpeg') format = 'jpg';
            contentBlocks.push({
              image: {
                format,
                source: { base64 },
              },
            });
          } else {
            // Document type
            const format =
              attachedFile.file.name.split('.').pop()?.toLowerCase() || 'txt';
            const uniqueName = getUniqueDocName(attachedFile.file.name);
            contentBlocks.push({
              document: {
                format,
                name: uniqueName,
                source: { base64 },
              },
            });
          }
        }

        // Add text message if present
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
      // Refresh sessions list after sending a message
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
      selectedAgent,
    ],
  );

  const handleResearchMessage = useCallback(
    async (files: AttachedFile[], message?: string) => {
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
              image: {
                format,
                source: { base64 },
              },
            });
          } else {
            const format =
              attachedFile.file.name.split('.').pop()?.toLowerCase() || 'txt';
            const uniqueName = getUniqueDocName(attachedFile.file.name);
            contentBlocks.push({
              document: {
                format,
                name: uniqueName,
                source: { base64 },
              },
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
      selectedAgent,
      researchAgentRuntimeArn,
      showToast,
      t,
    ],
  );

  useSetSidebarSessions(
    useMemo(
      () => ({
        sessions,
        currentSessionId,
        onSessionSelect: handleSessionSelect,
        onSessionRename: handleSessionRename,
        onSessionDelete: handleSessionDelete,
        onNewSession: handleNewSession,
        hasMoreSessions: !!sessionsNextCursor,
        loadingMoreSessions,
        onLoadMoreSessions: loadMoreSessions,
      }),
      [
        sessions,
        currentSessionId,
        handleSessionSelect,
        handleSessionRename,
        handleSessionDelete,
        handleNewSession,
        sessionsNextCursor,
        loadingMoreSessions,
        loadMoreSessions,
      ],
    ),
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <CubeLoader />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-500">{t('projects.notFound')}</div>
        <Link
          to="/"
          className="text-blue-600 hover:text-blue-700 hover:underline"
        >
          {t('projects.backToProjects')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Navigation Bar */}
      <ProjectNavBar
        project={project}
        onSettingsClick={() => setShowProjectSettings(true)}
        onNewChat={handleNewSession}
      />

      {/* Main Content - 2 Column Resizable Layout */}
      <div className="flex-1 min-h-0 flex">
        <ResizablePanelGroup
          key={sidePanelCollapsed ? 'sl' : 'se'}
          orientation="horizontal"
          defaultSize={(() => {
            const sizes = sidePanelSizeBeforeCollapse.current;
            if (sidePanelCollapsed) {
              return [sizes[0] + sizes[1]];
            }
            return sizes;
          })()}
          onResizeEnd={handlePanelResizeEnd}
          onCollapse={(details: { panelId: string }) => {
            if (details.panelId === 'side') {
              setSidePanelCollapsed(true);
            }
          }}
          panels={(() => {
            const panels: {
              id: string;
              minSize: number;
              maxSize: number;
              collapsible?: boolean;
            }[] = [];
            panels.push({
              id: 'chat',
              minSize: 40,
              maxSize: 100,
            });
            if (!sidePanelCollapsed) {
              panels.push({
                id: 'side',
                minSize: 15,
                maxSize: 45,
                collapsible: true,
              });
            }
            return panels;
          })()}
          className="h-full flex-1 min-w-0"
        >
          {/* Left - Chat Panel */}
          <ResizablePanel id="chat">
            <div className="h-full">
              <ChatPanel
                messages={messages}
                inputMessage={inputMessage}
                sending={sending}
                streamingBlocks={streamingBlocks}
                loadingHistory={loadingHistory}
                agents={agents}
                selectedAgent={selectedAgent}
                artifacts={artifacts}
                documents={documents}
                onInputChange={setInputMessage}
                onSendMessage={handleSendMessage}
                onResearch={
                  researchAgentRuntimeArn ? handleResearchMessage : undefined
                }
                onAgentSelect={handleAgentSelect}
                onAgentClick={() => setShowAgentModal(true)}
                onNewChat={handleNewSession}
                onArtifactView={handleArtifactSelect}
                onSourceClick={handleSourceClick}
                loadingSourceKey={loadingSourceKey}
                scrollPositionRef={chatScrollPositionRef}
                researchMode={researchMode}
                onResearchModeChange={setResearchMode}
                voiceChatAvailable={!!bidiAgentRuntimeArn}
                voiceChatState={voiceChat.state}
                voiceChatAudioLevel={{
                  input: voiceChat.inputAudioLevel,
                  output: voiceChat.outputAudioLevel,
                }}
                voiceChatMode={voiceChatMode}
                selectedVoiceModel={selectedVoiceModel}
                onVoiceChatModeChange={setVoiceChatMode}
                onVoiceChatConnect={handleVoiceChatConnect}
                onVoiceChatDisconnect={voiceChat.disconnect}
                onVoiceChatText={handleVoiceChatText}
                onVoiceChatToggleMic={voiceChat.toggleMic}
                onVoiceChatSettings={() => setShowVoiceModelSettings(true)}
                onVoiceModelSelect={handleVoiceModelSelect}
              />
            </div>
          </ResizablePanel>

          {!sidePanelCollapsed && (
            <>
              <ResizableHandle id="chat:side" />

              {/* Right - Documents & Artifacts */}
              <ResizablePanel id="side">
                <div className="h-full relative">
                  <SidePanel
                    artifacts={artifacts}
                    currentArtifactId={selectedArtifact?.artifact_id}
                    onArtifactSelect={handleArtifactSelect}
                    onArtifactDownload={handleArtifactDownload}
                    onArtifactDelete={handleArtifactDelete}
                    onCollapse={() => setSidePanelCollapsed(true)}
                    documents={documents}
                    workflows={workflows}
                    workflowProgressMap={workflowProgressMap}
                    uploading={uploading}
                    onAddDocument={() => setShowUploadModal(true)}
                    onRefreshDocuments={loadDocuments}
                    onViewWorkflow={loadWorkflowDetail}
                    onDeleteDocument={handleDeleteDocument}
                  />
                  {/* Artifact Viewer - overlays SidePanel */}
                  {selectedArtifact && (
                    <ArtifactViewer
                      artifact={selectedArtifact}
                      onClose={() => {
                        setSelectedArtifact(null);
                        if (sidePanelAutoExpandedRef.current) {
                          setSidePanelCollapsed(true);
                          sidePanelAutoExpandedRef.current = false;
                        }
                      }}
                      onDownload={handleArtifactDownload}
                      getPresignedUrl={getPresignedDownloadUrl}
                    />
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {/* Collapsed Side Bar */}
        {sidePanelCollapsed && (
          <div
            className="side-collapsed-bar"
            onClick={() => {
              setSidePanelCollapsed(false);
              localStorage.setItem(
                panelStorageKey,
                JSON.stringify(sidePanelSizeBeforeCollapse.current),
              );
            }}
            title={t('nav.expand')}
          >
            <div className="docs-collapsed-badge">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>{documents.length}</span>
            </div>
            <span className="docs-collapsed-label">
              {t('documents.title', 'Documents')}
            </span>
            <div className="docs-collapsed-badge mt-2">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
                <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
                <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
              </svg>
              <span>{artifacts.length}</span>
            </div>
            <span className="docs-collapsed-label">
              {t('chat.artifacts', 'Artifacts')}
            </span>
            <div className="docs-collapsed-expand">
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 17l-5-5 5-5" />
                <path d="M18 17l-5-5 5-5" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Workflow Detail Modal */}
      {selectedWorkflow && (
        <WorkflowDetailModal
          workflow={selectedWorkflow}
          projectColor={project?.color ?? 0}
          loadingWorkflow={loadingWorkflow}
          onClose={() => {
            setSelectedWorkflow(null);
            setInitialSegmentIndex(0);
          }}
          onReanalyze={handleReanalyze}
          reanalyzing={reanalyzing}
          onRegenerateQa={handleRegenerateQa}
          onAddQa={handleAddQa}
          onDeleteQa={handleDeleteQa}
          initialSegmentIndex={initialSegmentIndex}
          onLoadSegment={handleLoadSegment}
        />
      )}

      {/* Project Settings Modal */}
      <ProjectSettingsModal
        project={project}
        isOpen={showProjectSettings}
        onClose={() => setShowProjectSettings(false)}
        onSave={async (data) => {
          await fetchApi(`projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (project) {
            setProject({
              ...project,
              ...data,
            });
          }
        }}
      />

      {/* Delete Document Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteDocument}
        title={t('documents.deleteConfirm')}
        message={deleteTarget?.name || ''}
        confirmText={t('common.delete')}
        variant="danger"
        loading={deleting}
      />

      {/* Agent Select Modal */}
      <AgentSelectModal
        isOpen={showAgentModal}
        agents={agents}
        selectedAgentName={selectedAgent?.name || null}
        loading={loadingAgents}
        onClose={() => setShowAgentModal(false)}
        onSelect={handleAgentSelect}
        onCreate={handleAgentCreate}
        onUpdate={handleAgentUpdate}
        onDelete={handleAgentDelete}
        onLoadDetail={loadAgentDetail}
      />

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={showUploadModal}
        uploading={uploading}
        projectOcrModel={project?.ocr_model || undefined}
        projectOcrOptions={project?.ocr_options || undefined}
        projectDocumentPrompt={project?.document_prompt || undefined}
        onClose={() => setShowUploadModal(false)}
        onUpload={processFiles}
      />

      {/* System Prompt Modal (Ctrl+Shift+S) */}
      <SystemPromptModal
        isOpen={showSystemPrompt}
        onClose={() => setShowSystemPrompt(false)}
        tabs={systemPromptTabs}
      />

      {/* Voice Model Settings Modal - only shows settings for currently selected model */}
      <VoiceModelSettingsModal
        isOpen={showVoiceModelSettings}
        onClose={() => setShowVoiceModelSettings(false)}
        selectedModel={selectedVoiceModel}
        onSave={() => {
          // Config is saved in localStorage by the modal
          // If connected, reconnect with new settings (voice change)
          if (voiceChat.state.status === 'connected') {
            voiceChat.disconnect();
            setTimeout(() => {
              handleVoiceChatConnect();
            }, 500);
          }
        }}
      />
    </div>
  );
}
