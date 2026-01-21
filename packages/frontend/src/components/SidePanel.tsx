import { useTranslation } from 'react-i18next';
import { MessageSquare, FileCode, Loader2, ChevronDown } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './ui/resizable';
import { ChatSession } from '../types/project';

interface SidePanelProps {
  sessions: ChatSession[];
  currentSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  hasMoreSessions?: boolean;
  loadingMoreSessions?: boolean;
  onLoadMoreSessions?: () => void;
}

export default function SidePanel({
  sessions,
  currentSessionId,
  onSessionSelect,
  hasMoreSessions = false,
  loadingMoreSessions = false,
  onLoadMoreSessions,
}: SidePanelProps) {
  const { t, i18n } = useTranslation();

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
    <ResizablePanelGroup
      orientation="vertical"
      defaultSize={[40, 60]}
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
                    <button
                      key={session.session_id}
                      onClick={() => onSessionSelect(session.session_id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        session.session_id === currentSessionId
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                        <span className="text-sm truncate flex-1">
                          {session.session_name ||
                            `Session ${session.session_id.slice(0, 8)}`}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 pl-5">
                        {formatDate(session.updated_at)}
                      </div>
                    </button>
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
  );
}
