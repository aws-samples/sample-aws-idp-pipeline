import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { getToolEntry } from './toolRegistry';
import {
  prepareMarkdown,
  parseWebSearchResults,
  getDomainFromUrl,
  parseFetchContent,
} from './utils';
import type {
  ToolResultImage,
  ToolResultSource,
  ChatArtifact,
  ChatAttachment,
  Document,
} from './types';

interface ToolResultCardProps {
  toolName?: string;
  resultType?: 'image' | 'artifact' | 'text';
  content?: string;
  images?: ToolResultImage[];
  artifact?: ChatArtifact;
  sources?: ToolResultSource[];
  attachments?: ChatAttachment[];
  expandKeyPrefix: string;
  expandedSources: Set<string>;
  onToggleExpand: (key: string) => void;
  onArtifactView?: (artifactId: string) => void;
  onArtifactDownload?: (artifact: ChatArtifact) => void;
  downloadingArtifact?: string | null;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
  onImageClick?: (img: { src: string; alt: string }) => void;
  onViewDetails?: (content: string) => void;
  documents?: Document[];
}

export default function ToolResultCard({
  toolName,
  resultType,
  content,
  images,
  artifact,
  sources,
  attachments,
  expandKeyPrefix,
  expandedSources,
  onToggleExpand,
  onArtifactView,
  onArtifactDownload,
  downloadingArtifact,
  onSourceClick,
  loadingSourceKey,
  onImageClick,
  onViewDetails,
  documents = [],
}: ToolResultCardProps) {
  const { t } = useTranslation();
  const entry = getToolEntry(toolName, resultType === 'artifact');
  const Icon = entry.icon;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gradient-to-br dark:from-violet-600/30 dark:via-purple-600/25 dark:to-fuchsia-600/20 border border-slate-200 dark:border-violet-400 shadow-sm dark:shadow-lg dark:shadow-violet-500/20">
      {/* Decorative background elements - dark mode only */}
      <div className="hidden dark:block absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-violet-300/20 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="hidden dark:block absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-fuchsia-300/20 to-transparent rounded-full translate-y-1/2 -translate-x-1/2" />

      {/* Header */}
      <div className="tool-result-header relative flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-violet-400/50">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-xs font-semibold text-slate-600 dark:text-fuchsia-300">
          {t(entry.resultLabel, entry.resultLabel)}
        </span>
        <div className="flex-1" />
        <Sparkles className="w-4 h-4 text-slate-300 dark:text-violet-400/80" />
      </div>

      {/* Content */}
      <div className="relative p-4 space-y-3 dark:bg-violet-500/10">
        {/* Artifact card */}
        {resultType === 'artifact' && artifact && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border border-emerald-200 dark:border-emerald-500/40">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm flex-shrink-0">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-slate-800 dark:text-emerald-100 truncate">
                {artifact.filename}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {onArtifactView && (
                <button
                  type="button"
                  onClick={() => onArtifactView(artifact.artifact_id)}
                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-800/40 transition-colors"
                  title={t('documents.view', 'View')}
                >
                  <Eye className="w-4.5 h-4.5" />
                </button>
              )}
              {onArtifactDownload && (
                <button
                  type="button"
                  onClick={() => onArtifactDownload(artifact)}
                  disabled={downloadingArtifact === artifact.artifact_id}
                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-800/40 transition-colors disabled:opacity-70 disabled:cursor-wait"
                  title={t('chat.download', 'Download')}
                >
                  {downloadingArtifact === artifact.artifact_id ? (
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  ) : (
                    <Download className="w-4.5 h-4.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Generated images from attachments (stored messages) */}
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {attachments.map((attachment) =>
              attachment.type === 'image' && attachment.preview ? (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() =>
                    onImageClick?.({
                      src: attachment.preview ?? '',
                      alt: attachment.name,
                    })
                  }
                  className="relative group overflow-hidden rounded-xl shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
                >
                  <img
                    src={attachment.preview}
                    alt={attachment.name}
                    className="max-w-80 max-h-80 object-contain bg-gray-50 dark:bg-violet-950/50"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                    <span className="text-xs text-white font-medium">
                      {t('chat.clickToEnlarge', 'Click to enlarge')}
                    </span>
                  </div>
                </button>
              ) : null,
            )}
          </div>
        )}

        {/* Generated images from streaming blocks */}
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {images.map((img, imgIdx) => (
              <button
                key={imgIdx}
                type="button"
                onClick={() => onImageClick?.(img)}
                className="relative group overflow-hidden rounded-xl shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
              >
                <img
                  src={img.src}
                  alt={img.alt}
                  className="max-w-80 max-h-80 object-contain bg-gray-50 dark:bg-violet-950/50"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                  <span className="text-xs text-white font-medium">
                    {t('chat.clickToEnlarge', 'Click to enlarge')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Collapsible source cards */}
        {sources && sources.length > 0 && (
          <CollapsibleSources
            sources={sources}
            expandKey={expandKeyPrefix}
            isExpanded={expandedSources.has(expandKeyPrefix)}
            onToggle={() => onToggleExpand(expandKeyPrefix)}
            onSourceClick={onSourceClick}
            loadingSourceKey={loadingSourceKey}
            documents={documents}
          />
        )}

        {/* Web search results */}
        {entry.renderAsWebSearch && content && (
          <WebSearchSection
            content={content}
            expandKey={`${expandKeyPrefix}-web`}
            isExpanded={expandedSources.has(`${expandKeyPrefix}-web`)}
            onToggle={() => onToggleExpand(`${expandKeyPrefix}-web`)}
          />
        )}

        {/* Fetch content preview */}
        {entry.renderAsFetchPreview && content && (
          <FetchPreviewSection
            content={content}
            expandKey={`${expandKeyPrefix}-fetch`}
            isExpanded={expandedSources.has(`${expandKeyPrefix}-fetch`)}
            onToggle={() => onToggleExpand(`${expandKeyPrefix}-fetch`)}
            onViewDetails={onViewDetails}
          />
        )}

        {/* Agent full content (research, plan, handoff) */}
        {entry.renderAsMarkdown && content && (
          <div className="px-1 prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-emerald-100 [&_strong]:!text-inherit [&_a]:text-violet-600 dark:[&_a]:text-violet-400 [&_a]:underline [&_a]:underline-offset-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {prepareMarkdown(content)}
            </ReactMarkdown>
          </div>
        )}

        {/* View details button - shown for generic tools (not search, fetch, markdown) */}
        {content &&
          !entry.renderAsWebSearch &&
          !entry.renderAsFetchPreview &&
          !entry.renderAsMarkdown && (
            <button
              onClick={() => onViewDetails?.(content)}
              className="flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              {t('chat.viewDetails', 'View details')}
            </button>
          )}

        {/* Fallback view details for unparseable web results */}
        {content &&
          entry.renderAsWebSearch &&
          !parseWebSearchResults(content) && (
            <button
              onClick={() => onViewDetails?.(content)}
              className="flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              {t('chat.viewDetails', 'View details')}
            </button>
          )}
      </div>
    </div>
  );
}

// --- Internal sub-components ---

function CollapsibleSources({
  sources,
  expandKey,
  isExpanded,
  onToggle,
  onSourceClick,
  loadingSourceKey,
  documents,
}: {
  sources: { document_id: string; segment_id: string }[];
  expandKey: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
  documents: Document[];
}) {
  const { t } = useTranslation();
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left group"
      >
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        )}
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
          {t('chat.sourcesReviewed', '{{count}} sources reviewed', {
            count: sources.length,
          })}
        </span>
        {!isExpanded && (
          <div className="flex items-center gap-1 ml-1">
            {sources.slice(0, 5).map((_, i) => (
              <span
                key={i}
                className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold flex items-center justify-center"
              >
                {i + 1}
              </span>
            ))}
            {sources.length > 5 && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                +{sources.length - 5}
              </span>
            )}
          </div>
        )}
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1.5">
          {sources.map((source, i) => {
            const segIdx = parseInt(
              source.segment_id.split('_').pop() || '0',
              10,
            );
            const doc = documents.find(
              (d) => d.document_id === source.document_id,
            );
            const isLoading =
              loadingSourceKey === `${source.document_id}:${source.segment_id}`;
            return (
              <button
                key={i}
                onClick={() =>
                  onSourceClick?.(source.document_id, source.segment_id)
                }
                disabled={!!loadingSourceKey}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                  isLoading
                    ? 'border-blue-300 dark:border-blue-500/60 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                } disabled:cursor-wait`}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex-shrink-0">
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                  )}
                </div>
                <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {doc?.name || 'Document'}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                  p.{segIdx + 1}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WebSearchSection({
  content,
  expandKey,
  isExpanded,
  onToggle,
}: {
  content: string;
  expandKey: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const webResults = parseWebSearchResults(content);
  if (!webResults) return null;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left group"
      >
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        )}
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
          {t('chat.webSearchResults', '{{count}} search results', {
            count: webResults.length,
          })}
        </span>
        {!isExpanded && (
          <div className="flex items-center gap-1 ml-1">
            {webResults.slice(0, 5).map((_, i) => (
              <span
                key={i}
                className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold flex items-center justify-center"
              >
                {i + 1}
              </span>
            ))}
            {webResults.length > 5 && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                +{webResults.length - 5}
              </span>
            )}
          </div>
        )}
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1.5">
          {webResults.map((result, i) => (
            <a
              key={i}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex-shrink-0 mt-0.5">
                <Globe className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {result.title}
                </p>
                <p className="text-xs text-blue-500 dark:text-blue-400 truncate">
                  {getDomainFromUrl(result.url)}
                </p>
                {result.summary && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {result.summary}
                  </p>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0 mt-1" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function FetchPreviewSection({
  content,
  expandKey,
  isExpanded,
  onToggle,
  onViewDetails,
}: {
  content: string;
  expandKey: string;
  isExpanded: boolean;
  onToggle: () => void;
  onViewDetails?: (content: string) => void;
}) {
  const { t } = useTranslation();
  const preview = parseFetchContent(content);
  if (!preview) return null;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left group"
      >
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        )}
        <Globe className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors truncate">
          {preview.title}
        </span>
      </button>
      {isExpanded && (
        <div className="mt-2 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50">
          <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">
            {preview.snippet}
          </p>
          <button
            onClick={() => onViewDetails?.(content)}
            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            {t('chat.viewDetails', 'View details')}
          </button>
        </div>
      )}
    </div>
  );
}
