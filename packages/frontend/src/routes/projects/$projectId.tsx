import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { useAwsClient } from '../../hooks/useAwsClient';
import { useWebSocket } from '../../contexts/WebSocketContext';
import CubeLoader from '../../components/CubeLoader';
import ConfirmModal from '../../components/ConfirmModal';
import ProjectSettingsModal, {
  CARD_COLORS,
} from '../../components/ProjectSettingsModal';
import ProjectNavBar from '../../components/ProjectNavBar';
import ChatPanel, { type AttachedFile } from '../../components/ChatPanel';
import SidePanel from '../../components/SidePanel';
import WorkflowDetailModal from '../../components/WorkflowDetailModal';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../../components/ui/resizable';
import AgentSelectModal from '../../components/AgentSelectModal';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import ArtifactViewer from '../../components/ArtifactViewer';
import SystemPromptModal from '../../components/SystemPromptModal';
import { useSetSidebarSessions } from '../../contexts/SidebarSessionContext';
import { BidiModelType } from '../../hooks/useVoiceChat';
import VoiceModelSettingsModal, {
  getStoredVoiceModelConfig,
} from '../../components/VoiceModelSettingsModal';

// Custom hooks
import { useProjectData } from '../../hooks/useProjectData';
import { usePanelLayout } from '../../hooks/usePanelLayout';
import { useSystemPrompts } from '../../hooks/useSystemPrompts';
import { useChatSession } from '../../hooks/useChatSession';
import { useVoiceChatManager } from '../../hooks/useVoiceChatManager';
import { useAgents } from '../../hooks/useAgents';
import { useArtifacts } from '../../hooks/useArtifacts';
import { useDocuments } from '../../hooks/useDocuments';

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { fetchApi, getPresignedDownloadUrl, bidiAgentRuntimeArn, userId } =
    useAwsClient();
  const { sendMessage, status: wsStatus } = useWebSocket();

  // --- Hook initialization (respecting dependency order) ---

  // 1. Independent hooks
  const projectData = useProjectData({ fetchApi, projectId });
  const panelLayout = usePanelLayout();
  const { systemPromptTabs } = useSystemPrompts({ fetchApi });

  // 2. Chat session (provides handleNewSession, setMessages, setStreamingBlocks)
  const chatSession = useChatSession({ projectId });

  // 3. Voice chat manager (needs setMessages, setStreamingBlocks)
  const [selectedVoiceModel, setSelectedVoiceModel] = useState<BidiModelType>(
    () => getStoredVoiceModelConfig().modelType,
  );
  const voiceChatManager = useVoiceChatManager({
    currentSessionId: chatSession.currentSessionId,
    projectId,
    userId: userId || '',
    selectedVoiceModel,
    setMessages: chatSession.setMessages,
    setStreamingBlocks: chatSession.setStreamingBlocks,
  });

  // 4. Agents (needs handleNewSession)
  const agentsHook = useAgents({
    fetchApi,
    projectId,
    onNewSession: useCallback(() => {
      chatSession.handleNewSession();
      agentsHook_setSelectedAgent(null);
      chatSession.setResearchMode(false);
      voiceChatManager.setVoiceChatMode(false);
      voiceChatManager.voiceChatDisconnectRef.current();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatSession.handleNewSession]),
  });

  // Workaround: we need a stable reference for the agent setter
  // that is used in the onNewSession callback above.
  // Since useAgents returns setSelectedAgent, we keep a local alias.
  const agentsHook_setSelectedAgent = agentsHook.setSelectedAgent;

  // 5. Artifacts (needs panel layout)
  const artifactsHook = useArtifacts({
    fetchApi,
    getPresignedDownloadUrl,
    projectId,
    sidePanelCollapsed: panelLayout.sidePanelCollapsed,
    setSidePanelCollapsed: panelLayout.setSidePanelCollapsed,
  });

  // 6. Documents (needs wsStatus)
  const documentsHook = useDocuments({
    fetchApi,
    projectId,
    wsStatus,
  });

  // --- System prompt modal state ---
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  // --- Subscribe to project WebSocket notifications ---
  useEffect(() => {
    if (wsStatus === 'connected') {
      sendMessage({ action: 'subscribe', projectId });
    }
  }, [projectId, sendMessage, wsStatus]);

  // --- Reset chat state when project changes ---
  useEffect(() => {
    chatSession.setCurrentSessionId(nanoid(33));
    chatSession.setMessages([]);
    chatSession.setInputMessage('');
    chatSession.setSending(false);
    chatSession.setStreamingBlocks([]);
    agentsHook.setSelectedAgent(null);
    artifactsHook.setSelectedArtifact(null);
    voiceChatManager.setVoiceChatMode(false);
    chatSession.pendingMessagesRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // --- Initial data load ---
  useEffect(() => {
    const load = async () => {
      projectData.setLoading(true);
      await Promise.all([
        projectData.loadProject(),
        documentsHook.loadDocuments(),
        documentsHook.loadWorkflows(),
        chatSession.loadSessions(),
        agentsHook.loadAgents(),
        artifactsHook.loadArtifacts(),
      ]);
      projectData.setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectData.loadProject,
    documentsHook.loadDocuments,
    documentsHook.loadWorkflows,
    chatSession.loadSessions,
    agentsHook.loadAgents,
    artifactsHook.loadArtifacts,
  ]);

  // Fetch real step progress for in-progress workflows on page load (once)
  useEffect(() => {
    documentsHook.fetchProgressOnLoad(projectData.loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData.loading, documentsHook.fetchProgressOnLoad]);

  // --- Ctrl+Shift+S keyboard shortcut for system prompt modal ---
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

  // --- Wrapped callbacks for ChatPanel/Sidebar compatibility ---

  // handleNewSession that also resets voice/agent state
  const handleNewSession = useCallback(() => {
    chatSession.handleNewSession();
    agentsHook.setSelectedAgent(null);
    chatSession.setResearchMode(false);
    voiceChatManager.setVoiceChatMode(false);
    voiceChatManager.voiceChatDisconnectRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSession.handleNewSession]);

  // handleSessionSelect with agent/voice context
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      chatSession.handleSessionSelect(sessionId, {
        agents: agentsHook.agents,
        setSelectedAgent: agentsHook.setSelectedAgent,
        setVoiceChatMode: voiceChatManager.setVoiceChatMode,
        setSelectedVoiceModel,
        voiceChatDisconnect: voiceChatManager.voiceChat.disconnect,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatSession.handleSessionSelect, agentsHook.agents],
  );

  // handleSessionDelete with voice/agent context
  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      await chatSession.handleSessionDelete(sessionId, {
        voiceChatDisconnect: voiceChatManager.voiceChat.disconnect,
        setVoiceChatMode: voiceChatManager.setVoiceChatMode,
        setSelectedAgent: agentsHook.setSelectedAgent,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatSession.handleSessionDelete],
  );

  // handleSendMessage wrapper passing selectedAgent
  const handleSendMessage = useCallback(
    (files: AttachedFile[], message?: string) => {
      chatSession.handleSendMessage(files, message, agentsHook.selectedAgent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatSession.handleSendMessage, agentsHook.selectedAgent],
  );

  // handleResearchMessage wrapper passing selectedAgent
  const handleResearchMessage = useCallback(
    (files: AttachedFile[], message?: string) => {
      chatSession.handleResearchMessage(
        files,
        message,
        agentsHook.selectedAgent,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatSession.handleResearchMessage, agentsHook.selectedAgent],
  );

  // --- Sidebar sessions sync ---
  useSetSidebarSessions(
    useMemo(
      () => ({
        sessions: chatSession.sessions,
        currentSessionId: chatSession.currentSessionId,
        onSessionSelect: handleSessionSelect,
        onSessionRename: chatSession.handleSessionRename,
        onSessionDelete: handleSessionDelete,
        onNewSession: handleNewSession,
        hasMoreSessions: !!chatSession.sessionsNextCursor,
        loadingMoreSessions: chatSession.loadingMoreSessions,
        onLoadMoreSessions: chatSession.loadMoreSessions,
      }),
      [
        chatSession.sessions,
        chatSession.currentSessionId,
        handleSessionSelect,
        chatSession.handleSessionRename,
        handleSessionDelete,
        handleNewSession,
        chatSession.sessionsNextCursor,
        chatSession.loadingMoreSessions,
        chatSession.loadMoreSessions,
      ],
    ),
  );

  // --- Render ---

  const projectColorObj =
    CARD_COLORS[(projectData.project?.color ?? 0) % CARD_COLORS.length] ||
    CARD_COLORS[0];

  if (projectData.loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <CubeLoader />
      </div>
    );
  }

  if (!projectData.project) {
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
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Ambient background glow (dark mode) */}
      <div
        className="absolute inset-0 hidden dark:block pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 800px 400px at 50% 0%, ${projectColorObj.glow}, transparent)`,
        }}
      />

      {/* Navigation Bar */}
      <ProjectNavBar
        project={projectData.project}
        onSettingsClick={() => projectData.setShowProjectSettings(true)}
      />

      {/* Main Content - 2 Column Resizable Layout */}
      <div className="flex-1 min-h-0 flex">
        <ResizablePanelGroup
          key={panelLayout.sidePanelCollapsed ? 'sl' : 'se'}
          orientation="horizontal"
          defaultSize={(() => {
            const sizes = panelLayout.sidePanelSizeBeforeCollapse.current;
            if (panelLayout.sidePanelCollapsed) {
              return [sizes[0] + sizes[1]];
            }
            return sizes;
          })()}
          onResizeEnd={panelLayout.handlePanelResizeEnd}
          onCollapse={(details: { panelId: string }) => {
            if (details.panelId === 'side') {
              panelLayout.setSidePanelCollapsed(true);
            }
          }}
          panels={(() => {
            const panels: {
              id: string;
              minSize: number;
              maxSize: number;
              collapsible?: boolean;
            }[] = [];
            panels.push({ id: 'chat', minSize: 40, maxSize: 100 });
            if (!panelLayout.sidePanelCollapsed) {
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
                projectName={projectData.project?.name}
                projectDescription={projectData.project?.description}
                projectColor={projectData.project?.color ?? 0}
                messages={chatSession.messages}
                inputMessage={chatSession.inputMessage}
                sending={chatSession.sending}
                streamingBlocks={chatSession.streamingBlocks}
                loadingHistory={chatSession.loadingHistory}
                agents={agentsHook.agents}
                selectedAgent={agentsHook.selectedAgent}
                artifacts={artifactsHook.artifacts}
                documents={documentsHook.documents}
                onInputChange={chatSession.setInputMessage}
                onSendMessage={handleSendMessage}
                onAgentSelect={agentsHook.handleAgentSelect}
                onAgentClick={() => agentsHook.setShowAgentModal(true)}
                onNewChat={handleNewSession}
                onArtifactView={artifactsHook.handleArtifactSelect}
                onSourceClick={documentsHook.handleSourceClick}
                loadingSourceKey={documentsHook.loadingSourceKey}
                scrollPositionRef={chatSession.chatScrollPositionRef}
                voiceChat={{
                  available: !!bidiAgentRuntimeArn,
                  state: voiceChatManager.voiceChat.state,
                  audioLevel: {
                    input: voiceChatManager.voiceChat.inputAudioLevel,
                    output: voiceChatManager.voiceChat.outputAudioLevel,
                  },
                  mode: voiceChatManager.voiceChatMode,
                  selectedModel: selectedVoiceModel,
                  onModeChange: voiceChatManager.setVoiceChatMode,
                  onConnect: voiceChatManager.handleVoiceChatConnect,
                  onDisconnect: voiceChatManager.voiceChat.disconnect,
                  onText: voiceChatManager.handleVoiceChatText,
                  onToggleMic: voiceChatManager.voiceChat.toggleMic,
                  onSettings: () =>
                    voiceChatManager.setShowVoiceModelSettings(true),
                  onModelSelect: voiceChatManager.handleVoiceModelSelect,
                }}
                research={
                  chatSession.researchAgentRuntimeArn
                    ? {
                        mode: chatSession.researchMode,
                        onModeChange: chatSession.setResearchMode,
                        onResearch: handleResearchMessage,
                      }
                    : undefined
                }
              />
            </div>
          </ResizablePanel>

          {!panelLayout.sidePanelCollapsed && (
            <>
              <ResizableHandle id="chat:side" />

              {/* Right - Documents & Artifacts */}
              <ResizablePanel id="side">
                <div className="h-full relative">
                  <SidePanel
                    artifacts={artifactsHook.artifacts}
                    currentArtifactId={
                      artifactsHook.selectedArtifact?.artifact_id
                    }
                    onArtifactSelect={artifactsHook.handleArtifactSelect}
                    onArtifactDownload={artifactsHook.handleArtifactDownload}
                    onArtifactDelete={artifactsHook.handleArtifactDelete}
                    onCollapse={() => panelLayout.setSidePanelCollapsed(true)}
                    documents={documentsHook.documents}
                    workflows={documentsHook.workflows}
                    workflowProgressMap={documentsHook.workflowProgressMap}
                    uploading={documentsHook.uploading}
                    onAddDocument={() => documentsHook.setShowUploadModal(true)}
                    onRefreshDocuments={documentsHook.loadDocuments}
                    onViewWorkflow={documentsHook.loadWorkflowDetail}
                    onDeleteDocument={documentsHook.handleDeleteDocument}
                  />
                  {/* Artifact Viewer - overlays SidePanel */}
                  {artifactsHook.selectedArtifact && (
                    <ArtifactViewer
                      artifact={artifactsHook.selectedArtifact}
                      onClose={artifactsHook.handleArtifactViewerClose}
                      onDownload={artifactsHook.handleArtifactDownload}
                      getPresignedUrl={getPresignedDownloadUrl}
                    />
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {/* Collapsed Side Bar */}
        {panelLayout.sidePanelCollapsed && (
          <div
            className="side-collapsed-bar"
            onClick={panelLayout.expandSidePanel}
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
              <span>{documentsHook.documents.length}</span>
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
              <span>{artifactsHook.artifacts.length}</span>
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
      {documentsHook.selectedWorkflow && (
        <WorkflowDetailModal
          workflow={documentsHook.selectedWorkflow}
          projectColor={projectData.project?.color ?? 0}
          loadingWorkflow={documentsHook.loadingWorkflow}
          onClose={() => {
            documentsHook.setSelectedWorkflow(null);
            documentsHook.setInitialSegmentIndex(0);
          }}
          onReanalyze={documentsHook.handleReanalyze}
          reanalyzing={documentsHook.reanalyzing}
          onRegenerateQa={documentsHook.handleRegenerateQa}
          onAddQa={documentsHook.handleAddQa}
          onDeleteQa={documentsHook.handleDeleteQa}
          initialSegmentIndex={documentsHook.initialSegmentIndex}
          onLoadSegment={documentsHook.handleLoadSegment}
        />
      )}

      {/* Project Settings Modal */}
      <ProjectSettingsModal
        project={projectData.project}
        isOpen={projectData.showProjectSettings}
        onClose={() => projectData.setShowProjectSettings(false)}
        onSave={projectData.handleProjectSave}
      />

      {/* Delete Document Confirmation Modal */}
      <ConfirmModal
        isOpen={!!documentsHook.deleteTarget}
        onClose={() => documentsHook.setDeleteTarget(null)}
        onConfirm={documentsHook.confirmDeleteDocument}
        title={t('documents.deleteConfirm')}
        message={documentsHook.deleteTarget?.name || ''}
        confirmText={t('common.delete')}
        variant="danger"
        loading={documentsHook.deleting}
      />

      {/* Agent Select Modal */}
      <AgentSelectModal
        isOpen={agentsHook.showAgentModal}
        agents={agentsHook.agents}
        selectedAgentName={agentsHook.selectedAgent?.name || null}
        loading={agentsHook.loadingAgents}
        onClose={() => agentsHook.setShowAgentModal(false)}
        onSelect={agentsHook.handleAgentSelect}
        onCreate={agentsHook.handleAgentCreate}
        onUpdate={agentsHook.handleAgentUpdate}
        onDelete={agentsHook.handleAgentDelete}
        onLoadDetail={agentsHook.loadAgentDetail}
      />

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={documentsHook.showUploadModal}
        uploading={documentsHook.uploading}
        projectLanguage={projectData.project?.language || undefined}
        projectOcrModel={projectData.project?.ocr_model || undefined}
        projectOcrOptions={projectData.project?.ocr_options || undefined}
        projectDocumentPrompt={
          projectData.project?.document_prompt || undefined
        }
        onClose={() => documentsHook.setShowUploadModal(false)}
        onUpload={documentsHook.processFiles}
      />

      {/* System Prompt Modal (Ctrl+Shift+S) */}
      <SystemPromptModal
        isOpen={showSystemPrompt}
        onClose={() => setShowSystemPrompt(false)}
        tabs={systemPromptTabs}
      />

      {/* Voice Model Settings Modal */}
      <VoiceModelSettingsModal
        isOpen={voiceChatManager.showVoiceModelSettings}
        onClose={() => voiceChatManager.setShowVoiceModelSettings(false)}
        selectedModel={selectedVoiceModel}
        onSave={() => {
          if (voiceChatManager.voiceChat.state.status === 'connected') {
            voiceChatManager.voiceChat.disconnect();
            setTimeout(() => {
              voiceChatManager.handleVoiceChatConnect();
            }, 500);
          }
        }}
      />
    </div>
  );
}
