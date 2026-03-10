import { X, Sparkles, FileText, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MarkdownRenderer from './ChatPanel/MarkdownRenderer';
import { prepareMarkdown, formatToolDisplayName } from './ChatPanel/utils';
import { useModal } from '../hooks/useModal';
import type { Document } from '../types/project';

interface SourceItem {
  document_id: string;
  segment_id: string;
}

interface ToolResultDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  sources?: SourceItem[];
  documents?: Document[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
}

export default function ToolResultDetailModal({
  isOpen,
  onClose,
  content,
  sources,
  documents = [],
  toolName,
  toolInput,
  onSourceClick,
  loadingSourceKey,
}: ToolResultDetailModalProps) {
  const { t } = useTranslation();

  useModal({ isOpen, onClose });

  if (!isOpen) return null;

  const displayName = toolName ? formatToolDisplayName(toolName) : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl mx-4 rounded-2xl border border-slate-200 dark:border-blue-500/30 bg-[#e8edf5] dark:bg-slate-900 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        style={{ maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-200/80 dark:border-blue-500/20 bg-gradient-to-r from-[#dce4f0] to-[#e4eaf4] dark:from-blue-900/20 dark:to-indigo-900/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-slate-500 to-blue-500 dark:from-blue-500 dark:to-indigo-600 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-blue-200">
            {displayName || t('chat.toolResultDetail', 'Tool Result Details')}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#d0daeb] dark:hover:bg-blue-800/40 transition-colors"
          >
            <X className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div
          className="px-6 py-5 overflow-y-auto space-y-4"
          style={{ maxHeight: 'calc(85vh - 56px)' }}
        >
          {/* Query */}
          {typeof toolInput?.query === 'string' && toolInput.query && (
            <div className="text-sm text-slate-500 dark:text-slate-400 italic">
              &quot;{toolInput.query}&quot;
            </div>
          )}

          {/* Sources list */}
          {sources && sources.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                {t('chat.sourcesReviewed', '{{count}} sources reviewed', {
                  count: sources.length,
                })}
              </p>
              <div className="flex flex-wrap gap-1">
                {sources.map((source, i) => {
                  const segIdx = parseInt(
                    source.segment_id.split('_').pop() || '0',
                    10,
                  );
                  const doc = documents.find(
                    (d) => d.document_id === source.document_id,
                  );
                  const isLoading =
                    loadingSourceKey ===
                    `${source.document_id}:${source.segment_id}`;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        onSourceClick?.(source.document_id, source.segment_id)
                      }
                      disabled={!!loadingSourceKey}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors ${
                        isLoading
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      } disabled:cursor-wait`}
                    >
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <FileText className="w-3 h-3 opacity-60" />
                      )}
                      <span className="max-w-28 truncate">
                        {doc?.name || 'Document'}
                      </span>
                      <span className="opacity-50">p.{segIdx + 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content */}
          {content && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-200 [&_strong]:!text-inherit">
              <MarkdownRenderer>{prepareMarkdown(content)}</MarkdownRenderer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
