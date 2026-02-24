import { X, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { useModal } from '../hooks/useModal';

interface ToolResultDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
}

export default function ToolResultDetailModal({
  isOpen,
  onClose,
  content,
}: ToolResultDetailModalProps) {
  const { t } = useTranslation();

  useModal({ isOpen, onClose });

  if (!isOpen) return null;

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
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-200/80 dark:border-blue-500/20 bg-gradient-to-r from-[#dce4f0] to-[#e4eaf4] dark:from-blue-900/20 dark:to-indigo-900/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-slate-500 to-blue-500 dark:from-blue-500 dark:to-indigo-600 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-blue-200">
            {t('chat.toolResultDetail', 'Tool Result Details')}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#d0daeb] dark:hover:bg-blue-800/40 transition-colors"
          >
            <X className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        <div
          className="px-6 py-5 overflow-y-auto"
          style={{ maxHeight: 'calc(85vh - 56px)' }}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-200 [&_strong]:!text-inherit">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
