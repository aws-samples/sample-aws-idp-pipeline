import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSidebarSessions } from '../../contexts/SidebarSessionContext';
import ConfirmModal from '../ConfirmModal';
import InputModal from '../InputModal';
import { ChatSession } from '../../types/project';

const COLLAPSED_KEY = 'idp-sidebar-sessions-collapsed';

const MessageSquareIcon = ({ className }: { className?: string }) => (
  <svg
    className={className || 'w-3 h-3'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const MoreVerticalIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

const PencilIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const TrashIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const LoaderIcon = () => (
  <svg
    className="w-3.5 h-3.5 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const MicIcon = ({ className }: { className?: string }) => (
  <svg
    className={className || 'w-2.5 h-2.5'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

const SearchIcon = ({ className }: { className?: string }) => (
  <svg
    className={className || 'w-2.5 h-2.5'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

function AgentBadge({ agentId }: { agentId?: string | null }) {
  if (!agentId) return null;

  if (agentId.startsWith('voice_')) {
    return (
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-purple-100 dark:bg-purple-900/50 flex-shrink-0"
        title="Voice"
      >
        <MicIcon className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
      </span>
    );
  }

  if (agentId === 'research') {
    return (
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex-shrink-0"
        title="Research"
      >
        <SearchIcon className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }

  return null;
}

const ChevronDownIcon = () => (
  <svg
    className="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

interface SidebarSessionListProps {
  sidebarCollapsed: boolean;
}

export default function SidebarSessionList({
  sidebarCollapsed,
}: SidebarSessionListProps) {
  const ctx = useSidebarSessions();
  const { t } = useTranslation();

  const [sectionOpen, setSectionOpen] = useState(() => {
    return localStorage.getItem(COLLAPSED_KEY) !== 'true';
  });
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sessionToRename, setSessionToRename] = useState<ChatSession | null>(
    null,
  );
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-sidebar-session-menu]')) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  // Close bubble on outside click
  useEffect(() => {
    if (!bubbleOpen) return;
    const handler = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setBubbleOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bubbleOpen]);

  if (!ctx) return null;

  const {
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionRename,
    onSessionDelete,
    hasMoreSessions,
    loadingMoreSessions,
    onLoadMoreSessions,
  } = ctx;

  const toggleSection = () => {
    const next = !sectionOpen;
    setSectionOpen(next);
    localStorage.setItem(COLLAPSED_KEY, String(!next));
  };

  const handleConfirmRename = async (newName: string) => {
    if (!sessionToRename) return;
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
    if (!sessionToDelete) return;
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

  // Collapsed sidebar: show icon + bubble popup on click
  if (sidebarCollapsed) {
    return (
      <div className="sidebar-sessions collapsed-icon" ref={bubbleRef}>
        <button
          type="button"
          className="sidebar-sessions-header-icon"
          title={t('chat.history')}
          onClick={() => setBubbleOpen(!bubbleOpen)}
        >
          <MessageSquareIcon className="w-4 h-4" />
          {sessions.length > 0 && (
            <span className="sidebar-sessions-badge">{sessions.length}</span>
          )}
        </button>

        {bubbleOpen && (
          <div className="sidebar-sessions-bubble">
            <div className="sidebar-sessions-bubble-header">
              <MessageSquareIcon />
              <span>{t('chat.history')}</span>
            </div>
            <div className="sidebar-sessions-bubble-list">
              {sessions.length === 0 ? (
                <div className="sidebar-sessions-empty">
                  <span>{t('chat.noHistory')}</span>
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.session_id}
                    className={`sidebar-session-item ${session.session_id === currentSessionId ? 'active' : ''}`}
                    onClick={() => {
                      onSessionSelect(session.session_id);
                      setBubbleOpen(false);
                    }}
                  >
                    <MessageSquareIcon />
                    <span className="sidebar-session-name">
                      {session.session_name ||
                        `Session ${session.session_id.slice(0, 8)}`}
                    </span>
                    <AgentBadge agentId={session.agent_id} />
                  </div>
                ))
              )}
              {hasMoreSessions && (
                <button
                  type="button"
                  className="sidebar-sessions-load-more"
                  onClick={onLoadMoreSessions}
                  disabled={loadingMoreSessions}
                >
                  {loadingMoreSessions ? <LoaderIcon /> : <ChevronDownIcon />}
                  <span>
                    {loadingMoreSessions
                      ? t('common.loading')
                      : t('chat.loadMore', 'Load more')}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="sidebar-sessions">
        {/* Header */}
        <button
          type="button"
          className="sidebar-sessions-header"
          onClick={toggleSection}
        >
          <MessageSquareIcon />
          <span className="sidebar-sessions-title">{t('chat.history')}</span>
          <ChevronIcon open={sectionOpen} />
        </button>

        {sectionOpen && (
          <>
            {/* Session List */}
            <div className="sidebar-sessions-list">
              {sessions.length === 0 ? (
                <div className="sidebar-sessions-empty">
                  <span>{t('chat.noHistory')}</span>
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.session_id}
                    className={`sidebar-session-item ${session.session_id === currentSessionId ? 'active' : ''}`}
                    onClick={() => onSessionSelect(session.session_id)}
                  >
                    <MessageSquareIcon />
                    <span className="sidebar-session-name">
                      {session.session_name ||
                        `Session ${session.session_id.slice(0, 8)}`}
                    </span>
                    <AgentBadge agentId={session.agent_id} />

                    <div
                      className="sidebar-session-actions"
                      data-sidebar-session-menu
                    >
                      <button
                        type="button"
                        className={`sidebar-session-menu-btn ${openMenuId === session.session_id ? 'visible' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(
                            openMenuId === session.session_id
                              ? null
                              : session.session_id,
                          );
                        }}
                      >
                        {deletingSessionId === session.session_id ? (
                          <LoaderIcon />
                        ) : (
                          <MoreVerticalIcon />
                        )}
                      </button>

                      {openMenuId === session.session_id && (
                        <div className="sidebar-session-dropdown">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                              setSessionToRename(session);
                            }}
                          >
                            <PencilIcon />
                            {t('common.rename', 'Rename')}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                              setSessionToDelete(session);
                            }}
                          >
                            <TrashIcon />
                            {t('common.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {hasMoreSessions && (
                <button
                  type="button"
                  className="sidebar-sessions-load-more"
                  onClick={onLoadMoreSessions}
                  disabled={loadingMoreSessions}
                >
                  {loadingMoreSessions ? <LoaderIcon /> : <ChevronDownIcon />}
                  <span>
                    {loadingMoreSessions
                      ? t('common.loading')
                      : t('chat.loadMore', 'Load more')}
                  </span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

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
