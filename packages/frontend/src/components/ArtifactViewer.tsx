import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Download,
  Loader2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import mammoth from 'mammoth';
import { Artifact } from '../types/project';

interface ArtifactViewerProps {
  artifact: Artifact;
  onClose: () => void;
  onDownload: (artifact: Artifact) => void;
  getPresignedUrl: (bucket: string, key: string) => Promise<string>;
}

export default function ArtifactViewer({
  artifact,
  onClose,
  onDownload,
  getPresignedUrl,
}: ArtifactViewerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  const isImage =
    artifact.content_type.startsWith('image/') ||
    imageExtensions.some((ext) =>
      artifact.filename.toLowerCase().endsWith(ext),
    );
  const isMarkdown =
    artifact.content_type === 'text/markdown' ||
    artifact.content_type === 'text/x-markdown' ||
    artifact.filename.endsWith('.md');
  const isText =
    artifact.content_type.startsWith('text/') ||
    artifact.content_type === 'application/json';
  const isHtml = artifact.content_type === 'text/html';
  const isPdf =
    artifact.content_type === 'application/pdf' ||
    artifact.filename.toLowerCase().endsWith('.pdf');
  const isDocx =
    artifact.content_type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    artifact.filename.toLowerCase().endsWith('.docx');

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const presignedUrl = await getPresignedUrl(
        artifact.s3_bucket,
        artifact.s3_key,
      );

      if (isImage || isPdf) {
        setImageUrl(presignedUrl);
      } else if (isDocx) {
        const response = await fetch(presignedUrl);
        if (!response.ok) {
          throw new Error(`Failed to load: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setContent(result.value);
      } else if (isText || isMarkdown || isHtml) {
        const response = await fetch(presignedUrl);
        if (!response.ok) {
          throw new Error(`Failed to load: ${response.status}`);
        }
        const text = await response.text();
        setContent(text);
      } else {
        setError(
          t('artifacts.unsupportedType', 'Unsupported file type for preview'),
        );
      }
    } catch (err) {
      console.error('Failed to load artifact:', err);
      setError(t('artifacts.loadError', 'Failed to load artifact'));
    } finally {
      setLoading(false);
    }
  }, [
    artifact,
    getPresignedUrl,
    isImage,
    isPdf,
    isDocx,
    isText,
    isMarkdown,
    isHtml,
    t,
  ]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600">
          {isImage ? (
            <ImageIcon className="w-4 h-4 text-white" />
          ) : (
            <FileText className="w-4 h-4 text-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
            {artifact.filename}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {artifact.content_type}
          </p>
        </div>
        <button
          onClick={() => onDownload(artifact)}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          title={t('common.download', 'Download')}
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          title={t('common.close', 'Close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('common.loading', 'Loading...')}
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-sm text-red-500">{error}</p>
            <button
              onClick={loadContent}
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              {t('common.retry', 'Retry')}
            </button>
          </div>
        ) : isPdf && imageUrl ? (
          <iframe
            src={imageUrl}
            title={artifact.filename}
            className="w-full h-full rounded-lg border-0"
          />
        ) : isImage && imageUrl ? (
          <div className="flex items-center justify-center h-full bg-slate-100 dark:bg-slate-800 rounded-lg">
            <img
              src={imageUrl}
              alt={artifact.filename}
              className="max-w-full max-h-full object-contain"
              onError={(e) => {
                console.error('Image load error:', e);
                setError(t('artifacts.imageLoadError', 'Failed to load image'));
              }}
            />
          </div>
        ) : isDocx && content ? (
          <div
            className="prose prose-sm prose-slate dark:prose-invert max-w-none [&_strong]:!text-inherit"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : isMarkdown && content ? (
          <div className="prose prose-sm prose-slate dark:prose-invert max-w-none [&_strong]:!text-inherit">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : isHtml && content ? (
          <div
            className="prose prose-sm prose-slate dark:prose-invert max-w-none [&_strong]:!text-inherit"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : content ? (
          <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono bg-slate-50 dark:bg-slate-800 p-4 rounded-lg overflow-auto">
            {content}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('artifacts.noPreview', 'Preview not available')}
            </p>
            <button
              onClick={() => onDownload(artifact)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {t('common.download', 'Download')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
