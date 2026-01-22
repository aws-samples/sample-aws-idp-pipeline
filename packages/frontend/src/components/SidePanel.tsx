import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  FileCode,
  Loader2,
  ChevronDown,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './ui/resizable';
import ConfirmModal from './ConfirmModal';
import { ChatSession } from '../types/project';

interface SidePanelProps {
  sessions: ChatSession[];
  currentSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, newName: string) => Promise<void>;
  onSessionDelete?: (sessionId: string) => Promise<void>;
  hasMoreSessions?: boolean;
  loadingMoreSessions?: boolean;
  onLoadMoreSessions?: () => void;
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
}: SidePanelProps) {
  const { t, i18n } = useTranslation();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  const handleStartEdit = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.session_id);
    setEditingName(
      session.session_name || `Session ${session.session_id.slice(0, 8)}`,
    );
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setEditingName('');
  };

  const handleSaveEdit = async () => {
    if (!editingSessionId || !onSessionRename || !editingName.trim()) return;

    setSaving(true);
    try {
      await onSessionRename(editingSessionId, editingName.trim());
      setEditingSessionId(null);
      setEditingName('');
    } catch (error) {
      console.error('Failed to rename session:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleDeleteClick = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionToDelete(session);
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

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const locale = i18n.language;

    if (days === 0) {
      return date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } else if (days === 1) {
      return t('common.yesterday');
    } else if (days < 7) {
      return t('common.daysAgo', { count: days });
    } else {
      return date.toLocaleDateString(locale);
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
                  <div className="p-2 space-y-1">
                    {sessions.map((session) => (
                      <div
                        key={session.session_id}
                        className={`group w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          session.session_id === currentSessionId
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {editingSessionId === session.session_id ? (
                          /* Edit Mode */
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                            <input
                              ref={inputRef}
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={handleKeyDown}
                              className="flex-1 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-0.5 outline-none focus:border-blue-500"
                              disabled={saving}
                            />
                            <button
                              onClick={handleSaveEdit}
                              disabled={saving || !editingName.trim()}
                              className="p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              disabled={saving}
                              className="p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          /* Normal Mode */
                          <button
                            onClick={() => onSessionSelect(session.session_id)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center gap-2">
                              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                              <span className="text-sm truncate flex-1">
                                {session.session_name ||
                                  `Session ${session.session_id.slice(0, 8)}`}
                              </span>
                              {onSessionRename && (
                                <button
                                  onClick={(e) => handleStartEdit(session, e)}
                                  className="p-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-opacity"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                              {onSessionDelete && (
                                <button
                                  onClick={(e) => handleDeleteClick(session, e)}
                                  disabled={
                                    deletingSessionId === session.session_id
                                  }
                                  className="p-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-opacity disabled:opacity-50"
                                >
                                  {deletingSessionId === session.session_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                </button>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 pl-5">
                              {formatDate(session.updated_at)}
                            </div>
                          </button>
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
                <FileCode className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('chat.artifacts', 'Artifacts')}
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col items-center justify-center h-full">
                  <FileCode className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-500" />
                  <p className="text-sm font-medium text-slate-500">
                    {t('chat.noArtifacts', 'No artifacts yet')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Delete Confirmation Modal */}
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
    </>
  );
}
