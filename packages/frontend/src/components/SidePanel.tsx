import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Layers,
  Loader2,
  ChevronDown,
  MoreVertical,
  Pencil,
  Trash2,
  FileText,
  Image,
  FileCode,
  FileSpreadsheet,
  Film,
  File,
  Copy,
  Download,
} from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './ui/resizable';
import ConfirmModal from './ConfirmModal';
import InputModal from './InputModal';
import { ChatSession, Artifact } from '../types/project';

function getArtifactIcon(contentType: string) {
  if (contentType.startsWith('image/')) return Image;
  if (contentType.startsWith('video/')) return Film;
  if (contentType === 'application/pdf') return FileText;
  if (
    contentType === 'application/vnd.ms-excel' ||
    contentType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'text/csv'
  )
    return FileSpreadsheet;
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript'
  )
    return FileCode;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface SidePanelProps {
  sessions: ChatSession[];
  currentSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, newName: string) => Promise<void>;
  onSessionDelete?: (sessionId: string) => Promise<void>;
  hasMoreSessions?: boolean;
  loadingMoreSessions?: boolean;
  onLoadMoreSessions?: () => void;
  // Artifacts
  artifacts?: Artifact[];
  currentArtifactId?: string;
  onArtifactSelect?: (artifactId: string) => void;
  onArtifactCopy?: (artifact: Artifact) => void;
  onArtifactDownload?: (artifact: Artifact) => void;
  onArtifactDelete?: (artifactId: string) => Promise<void>;
}

export default function SidePanel({
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  hasMoreSessions = false,
  loadingMoreSessions = false,
  onLoadMoreSessions,
  artifacts = [],
  currentArtifactId,
  onArtifactSelect,
  onArtifactCopy,
  onArtifactDownload,
  onArtifactDelete,
}: SidePanelProps) {
  const { t } = useTranslation();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openArtifactMenuId, setOpenArtifactMenuId] = useState<string | null>(
    null,
  );
  const [sessionToRename, setSessionToRename] = useState<ChatSession | null>(
    null,
  );
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(
    null,
  );
  const [artifactToDelete, setArtifactToDelete] = useState<Artifact | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(
    null,
  );

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-session-menu]')) {
        setOpenMenuId(null);
      }
      if (!target.closest('[data-artifact-menu]')) {
        setOpenArtifactMenuId(null);
      }
    };

    if (openMenuId || openArtifactMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openMenuId, openArtifactMenuId]);

  const handleMenuToggle = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === sessionId ? null : sessionId);
  };

  const handleRenameClick = (session: ChatSession) => {
    setOpenMenuId(null);
    setSessionToRename(session);
  };

  const handleDeleteClick = (session: ChatSession) => {
    setOpenMenuId(null);
    setSessionToDelete(session);
  };

  const handleConfirmRename = async (newName: string) => {
    if (!sessionToRename || !onSessionRename) return;

    setSaving(true);
    try {
      await onSessionRename(sessionToRename.session_id, newName);
      setSessionToRename(null);
    } catch (error) {
      console.error('Failed to rename session:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!sessionToDelete || !onSessionDelete) return;

    setDeletingSessionId(sessionToDelete.session_id);
    try {
      await onSessionDelete(sessionToDelete.session_id);
    } catch (error) {
      console.error('Failed to delete session:', error);
    } finally {
      setDeletingSessionId(null);
      setSessionToDelete(null);
    }
  };

  const hasActions = onSessionRename || onSessionDelete;
  const hasArtifactActions =
    onArtifactCopy || onArtifactDownload || onArtifactDelete;

  const handleArtifactMenuToggle = (
    artifactId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setOpenArtifactMenuId(
      openArtifactMenuId === artifactId ? null : artifactId,
    );
  };

  const handleArtifactCopyClick = (artifact: Artifact) => {
    setOpenArtifactMenuId(null);
    onArtifactCopy?.(artifact);
  };

  const handleArtifactDownloadClick = (artifact: Artifact) => {
    setOpenArtifactMenuId(null);
    onArtifactDownload?.(artifact);
  };

  const handleArtifactDeleteClick = (artifact: Artifact) => {
    setOpenArtifactMenuId(null);
    setArtifactToDelete(artifact);
  };

  const handleConfirmArtifactDelete = async () => {
    if (!artifactToDelete || !onArtifactDelete) return;

    setDeletingArtifactId(artifactToDelete.artifact_id);
    try {
      await onArtifactDelete(artifactToDelete.artifact_id);
    } catch (error) {
      console.error('Failed to delete artifact:', error);
    } finally {
      setDeletingArtifactId(null);
      setArtifactToDelete(null);
    }
  };

  return (
    <>
      <ResizablePanelGroup
        orientation="vertical"
        defaultSize={[60, 40]}
        panels={[
          { id: 'history', minSize: 20, collapsible: true },
          { id: 'artifacts', minSize: 20, collapsible: true },
        ]}
        className="h-full"
      >
        {/* Conversation History - Top */}
        <ResizablePanel id="history">
          <div className="h-full pb-1">
            <div className="h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <MessageSquare className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('chat.history')}
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                {sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full p-4">
                    <MessageSquare className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-500" />
                    <p className="text-sm font-medium text-slate-500">
                      {t('chat.noHistory')}
                    </p>
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {sessions.map((session) => (
                      <div
                        key={session.session_id}
                        className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                          session.session_id === currentSessionId
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                        onClick={() => onSessionSelect(session.session_id)}
                      >
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                        <span className="text-sm truncate flex-1">
                          {session.session_name ||
                            `Session ${session.session_id.slice(0, 8)}`}
                        </span>

                        {hasActions && (
                          <div className="relative" data-session-menu>
                            <button
                              onClick={(e) =>
                                handleMenuToggle(session.session_id, e)
                              }
                              className={`p-1 rounded transition-opacity ${
                                openMenuId === session.session_id
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100'
                              } text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700`}
                            >
                              {deletingSessionId === session.session_id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <MoreVertical className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Dropdown Menu */}
                            {openMenuId === session.session_id && (
                              <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1">
                                {onSessionRename && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRenameClick(session);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    {t('common.rename', 'Rename')}
                                  </button>
                                )}
                                {onSessionDelete && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteClick(session);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    {t('common.delete')}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {hasMoreSessions && onLoadMoreSessions && (
                      <button
                        onClick={onLoadMoreSessions}
                        disabled={loadingMoreSessions}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 mt-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {loadingMoreSessions ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                        <span>
                          {loadingMoreSessions
                            ? t('common.loading')
                            : t('chat.loadMore', 'Load more')}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle id="history:artifacts" orientation="vertical" />

        {/* Artifacts - Bottom */}
        <ResizablePanel id="artifacts">
          <div className="h-full pt-1">
            <div className="h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <Layers className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('chat.artifacts', 'Artifacts')}
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                {artifacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full p-4">
                    <Layers className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-500" />
                    <p className="text-sm font-medium text-slate-500">
                      {t('chat.noArtifacts', 'No artifacts yet')}
                    </p>
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {artifacts.map((artifact) => {
                      const ArtifactIcon = getArtifactIcon(
                        artifact.content_type,
                      );
                      return (
                        <div
                          key={artifact.artifact_id}
                          className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                            artifact.artifact_id === currentArtifactId
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                          onClick={() =>
                            onArtifactSelect?.(artifact.artifact_id)
                          }
                        >
                          <ArtifactIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                          <span className="text-sm truncate flex-1">
                            {artifact.filename}
                          </span>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {formatFileSize(artifact.file_size)}
                          </span>

                          {hasArtifactActions && (
                            <div className="relative" data-artifact-menu>
                              <button
                                onClick={(e) =>
                                  handleArtifactMenuToggle(
                                    artifact.artifact_id,
                                    e,
                                  )
                                }
                                className={`p-1 rounded transition-opacity ${
                                  openArtifactMenuId === artifact.artifact_id
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100'
                                } text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700`}
                              >
                                {deletingArtifactId === artifact.artifact_id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <MoreVertical className="w-3.5 h-3.5" />
                                )}
                              </button>

                              {/* Dropdown Menu */}
                              {openArtifactMenuId === artifact.artifact_id && (
                                <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1">
                                  {onArtifactCopy && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleArtifactCopyClick(artifact);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                      {t('common.copy', 'Copy')}
                                    </button>
                                  )}
                                  {onArtifactDownload && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleArtifactDownloadClick(artifact);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      {t('common.download', 'Download')}
                                    </button>
                                  )}
                                  {onArtifactDelete && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleArtifactDeleteClick(artifact);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      {t('common.delete')}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Rename Modal */}
      <InputModal
        isOpen={!!sessionToRename}
        onClose={() => setSessionToRename(null)}
        onConfirm={handleConfirmRename}
        title={t('chat.renameSession', 'Rename Session')}
        placeholder={t('chat.sessionNamePlaceholder', 'Enter session name')}
        initialValue={
          sessionToRename?.session_name ||
          `Session ${sessionToRename?.session_id.slice(0, 8) || ''}`
        }
        confirmText={t('common.save')}
        loading={saving}
      />

      {/* Delete Session Confirmation Modal */}
      <ConfirmModal
        isOpen={!!sessionToDelete}
        onClose={() => setSessionToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('chat.deleteSession', 'Delete Session')}
        message={t(
          'chat.deleteSessionConfirm',
          'Are you sure you want to delete this session? This action cannot be undone.',
        )}
        confirmText={t('common.delete')}
        variant="danger"
      />

      {/* Delete Artifact Confirmation Modal */}
      <ConfirmModal
        isOpen={!!artifactToDelete}
        onClose={() => setArtifactToDelete(null)}
        onConfirm={handleConfirmArtifactDelete}
        title={t('chat.deleteArtifact', 'Delete Artifact')}
        message={t(
          'chat.deleteArtifactConfirm',
          'Are you sure you want to delete this artifact? This action cannot be undone.',
        )}
        confirmText={t('common.delete')}
        variant="danger"
      />
    </>
  );
}
