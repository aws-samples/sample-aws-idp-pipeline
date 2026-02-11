import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAwsClient } from '../../hooks/useAwsClient';
import { useToast } from '../Toast';
import ImageModal from '../ImageModal';
import ToolResultDetailModal from '../ToolResultDetailModal';
import ConfirmModal from '../ConfirmModal';
import ChatInputBox from './ChatInputBox';
import VoiceChatPanel from './VoiceChatPanel';
import MessageList from './MessageList';
import WelcomeScreen from './WelcomeScreen';
import type { ChatPanelProps, AttachedFile, ChatArtifact } from './types';

// Re-exports for backward compatibility
export type { AttachedFile, StreamingBlock } from './types';

export default function ChatPanel({
  messages,
  inputMessage,
  sending,
  streamingBlocks,
  loadingHistory = false,
  agents = [],
  selectedAgent,
  artifacts = [],
  documents = [],
  onInputChange,
  onSendMessage,
  onResearch,
  onAgentSelect,
  onAgentClick,
  onNewChat,
  onArtifactView,
  onSourceClick,
  loadingSourceKey,
  scrollPositionRef,
  researchMode: researchModeProp,
  onResearchModeChange,
  voiceChatAvailable,
  voiceChatState,
  voiceChatAudioLevel,
  voiceChatMode: voiceChatModeProp,
  selectedVoiceModel,
  onVoiceChatModeChange,
  onVoiceChatConnect,
  onVoiceChatDisconnect,
  onVoiceChatText,
  onVoiceChatToggleMic,
  onVoiceChatSettings,
  onVoiceModelSelect,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const { getPresignedDownloadUrl } = useAwsClient();
  const { showToast } = useToast();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageCountRef = useRef(messages.length);

  // Attached files state (shared between orchestrator and ChatInputBox)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // Modal states
  const [toolResultDetail, setToolResultDetail] = useState<{
    content: string;
  } | null>(null);
  const [modalImage, setModalImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [downloadingArtifact, setDownloadingArtifact] = useState<string | null>(
    null,
  );
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set(),
  );

  // Research mode: use controlled prop if provided, otherwise internal state
  const [researchModeInternal, setResearchModeInternal] = useState(false);
  const researchMode = researchModeProp ?? researchModeInternal;
  const setResearchMode = useCallback(
    (mode: boolean) => {
      if (onResearchModeChange) {
        onResearchModeChange(mode);
      } else {
        setResearchModeInternal(mode);
      }
    },
    [onResearchModeChange],
  );

  // Voice Chat mode: use controlled prop if provided, otherwise internal state
  const [voiceChatModeInternal, setVoiceChatModeInternal] = useState(false);
  const voiceChatMode = voiceChatModeProp ?? voiceChatModeInternal;
  const setNovaSonicMode = useCallback(
    (mode: boolean) => {
      if (onVoiceChatModeChange) {
        onVoiceChatModeChange(mode);
      } else {
        setVoiceChatModeInternal(mode);
      }
    },
    [onVoiceChatModeChange],
  );

  // Reset modes when loading a session history
  const prevLoadingHistory = useRef(false);
  useEffect(() => {
    if (loadingHistory && !prevLoadingHistory.current) {
      if (!onResearchModeChange) setResearchModeInternal(false);
      if (!onVoiceChatModeChange) setVoiceChatModeInternal(false);
    }
    prevLoadingHistory.current = loadingHistory;
  }, [loadingHistory, onResearchModeChange, onVoiceChatModeChange]);

  // Sync voiceChatMode with connection status
  useEffect(() => {
    if (
      !onVoiceChatModeChange &&
      (voiceChatState?.status === 'connected' ||
        voiceChatState?.status === 'connecting')
    ) {
      setVoiceChatModeInternal(true);
    }
  }, [voiceChatState?.status, onVoiceChatModeChange]);

  // Confirm modals state
  const [showRemoveAgentConfirm, setShowRemoveAgentConfirm] = useState(false);
  const [showNovaSonicDisableConfirm, setShowNovaSonicDisableConfirm] =
    useState(false);
  const [showResearchDisableConfirm, setShowResearchDisableConfirm] =
    useState(false);
  const [pendingAgentChange, setPendingAgentChange] = useState<
    string | null | undefined
  >(undefined);

  // Handle Voice Chat mode disable with confirmation if needed
  const handleNovaSonicDisable = useCallback(() => {
    if (messages.length > 0) {
      setShowNovaSonicDisableConfirm(true);
    } else {
      setNovaSonicMode(false);
      onVoiceChatDisconnect?.();
    }
  }, [messages.length, setNovaSonicMode, onVoiceChatDisconnect]);

  const confirmNovaSonicDisable = useCallback(() => {
    setShowNovaSonicDisableConfirm(false);
    setNovaSonicMode(false);
    onVoiceChatDisconnect?.();
    onNewChat();
  }, [setNovaSonicMode, onVoiceChatDisconnect, onNewChat]);

  // Handle Research mode disable with confirmation if needed
  const handleResearchDisable = useCallback(() => {
    if (messages.length > 0) {
      setShowResearchDisableConfirm(true);
    } else {
      setResearchMode(false);
    }
  }, [messages.length, setResearchMode]);

  const confirmResearchDisable = useCallback(() => {
    setShowResearchDisableConfirm(false);
    setResearchMode(false);
    onNewChat();
  }, [setResearchMode, onNewChat]);

  // Artifact download
  const handleArtifactDownload = useCallback(
    async (artifact: ChatArtifact) => {
      setDownloadingArtifact(artifact.artifact_id);
      try {
        let bucket = artifact.s3_bucket;
        if (!bucket && artifact.url) {
          const urlMatch = artifact.url.match(
            /https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\//,
          );
          bucket = urlMatch?.[1];
        }
        if (!bucket || !artifact.s3_key) {
          throw new Error('Missing bucket or s3_key for artifact');
        }

        const presignedUrl = await getPresignedDownloadUrl(
          bucket,
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
      } finally {
        setDownloadingArtifact(null);
      }
    },
    [getPresignedDownloadUrl, showToast, t],
  );

  // Toggle expand for collapsible sections
  const handleToggleExpand = useCallback((key: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Restore scroll position on remount
  useLayoutEffect(() => {
    if (scrollPositionRef && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollPositionRef.current;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save scroll position continuously
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !scrollPositionRef) return;
    const handleScroll = () => {
      scrollPositionRef.current = el.scrollTop;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [scrollPositionRef]);

  // Smooth-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > messageCountRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    messageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (streamingBlocks.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingBlocks]);

  const hasMessages = messages.length > 0 || sending;

  // Keep focus on input when view changes
  useEffect(() => {
    if (hasMessages && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [hasMessages]);

  // Voice chat panel element
  const voiceChatPanel = voiceChatMode && voiceChatState && (
    <VoiceChatPanel
      voiceChatState={voiceChatState}
      voiceChatAudioLevel={voiceChatAudioLevel}
      onConnect={onVoiceChatConnect}
      onDisconnect={onVoiceChatDisconnect}
      onSettings={onVoiceChatSettings}
    />
  );

  // Input box element
  const inputBox = (
    <ChatInputBox
      inputMessage={inputMessage}
      sending={sending}
      attachedFiles={attachedFiles}
      setAttachedFiles={setAttachedFiles}
      artifacts={artifacts}
      documents={documents}
      agents={agents}
      selectedAgent={selectedAgent}
      researchMode={researchMode}
      voiceChatMode={voiceChatMode}
      voiceChatState={voiceChatState}
      selectedVoiceModel={selectedVoiceModel}
      voiceChatAvailable={voiceChatAvailable}
      onInputChange={onInputChange}
      onSendMessage={onSendMessage}
      onResearch={onResearch}
      onAgentSelect={onAgentSelect}
      onAgentClick={onAgentClick}
      onVoiceChatText={onVoiceChatText}
      onVoiceModelSelect={onVoiceModelSelect}
      onVoiceChatDisconnect={onVoiceChatDisconnect}
      setResearchMode={setResearchMode}
      setNovaSonicMode={setNovaSonicMode}
      handleNovaSonicDisable={handleNovaSonicDisable}
      handleResearchDisable={handleResearchDisable}
      messagesLength={messages.length}
      setPendingAgentChange={(val) => setPendingAgentChange(val)}
      setShowRemoveAgentConfirm={(val) => setShowRemoveAgentConfirm(val)}
      inputRef={inputRef}
      fileInputRef={fileInputRef}
    />
  );

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 overflow-hidden relative">
      {/* Messages Container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loadingHistory ? (
          <div className="flex flex-col items-center justify-center h-full p-6">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-sm">
                {t('chat.loadingHistory', 'Loading conversation...')}
              </span>
            </div>
          </div>
        ) : !hasMessages ? (
          <WelcomeScreen voiceChatPanel={voiceChatPanel} inputBox={inputBox} />
        ) : (
          <MessageList
            messages={messages}
            streamingBlocks={streamingBlocks}
            sending={sending}
            voiceChatMode={voiceChatMode}
            expandedSources={expandedSources}
            onToggleExpand={handleToggleExpand}
            onArtifactView={onArtifactView}
            onArtifactDownload={handleArtifactDownload}
            downloadingArtifact={downloadingArtifact}
            onSourceClick={onSourceClick}
            loadingSourceKey={loadingSourceKey}
            onImageClick={(img) => setModalImage(img)}
            onViewDetails={(content) => setToolResultDetail({ content })}
            documents={documents}
            chatEndRef={chatEndRef}
          />
        )}
      </div>

      {/* Bottom Input */}
      {hasMessages && (
        <div className="p-4">
          <div className="max-w-3xl mx-auto">
            {voiceChatPanel}
            {inputBox}
          </div>
        </div>
      )}

      {/* Image Modal */}
      {modalImage && (
        <ImageModal
          src={modalImage.src}
          alt={modalImage.alt}
          onClose={() => setModalImage(null)}
        />
      )}
      {/* Tool Result Detail Modal */}
      <ToolResultDetailModal
        isOpen={!!toolResultDetail}
        onClose={() => setToolResultDetail(null)}
        content={toolResultDetail?.content ?? ''}
      />
      <ConfirmModal
        isOpen={showRemoveAgentConfirm}
        onClose={() => {
          setShowRemoveAgentConfirm(false);
          setPendingAgentChange(undefined);
        }}
        onConfirm={() => {
          setShowRemoveAgentConfirm(false);
          onAgentSelect?.(pendingAgentChange ?? null);
          setPendingAgentChange(undefined);
        }}
        title={t('chat.useAgent')}
        message={t('chat.removeAgentConfirm')}
        confirmText={t('common.confirm')}
        variant="warning"
      />
      <ConfirmModal
        isOpen={showNovaSonicDisableConfirm}
        onClose={() => setShowNovaSonicDisableConfirm(false)}
        onConfirm={confirmNovaSonicDisable}
        title={t('voiceChat.title')}
        message={t('chat.removeAgentConfirm')}
        confirmText={t('agent.startNewChat')}
        variant="warning"
      />
      <ConfirmModal
        isOpen={showResearchDisableConfirm}
        onClose={() => setShowResearchDisableConfirm(false)}
        onConfirm={confirmResearchDisable}
        title={t('chat.research')}
        message={t('chat.removeAgentConfirm')}
        confirmText={t('agent.startNewChat')}
        variant="warning"
      />
    </div>
  );
}
