import { useTranslation } from 'react-i18next';
import { Check, Eye } from 'lucide-react';
import { getToolEntry, isRegisteredTool } from './toolRegistry';
import { formatToolDisplayName } from './utils';
import type {
  ToolResultImage,
  ToolResultSource,
  ChatArtifact,
  ChatAttachment,
  Document,
  GraphSearchResult,
} from './types';

interface ToolResultCardProps {
  toolName?: string;
  resultType?: 'image' | 'artifact' | 'text';
  content?: string;
  images?: ToolResultImage[];
  artifact?: ChatArtifact;
  sources?: ToolResultSource[];
  attachments?: ChatAttachment[];
  toolInput?: Record<string, unknown>;
  expandKeyPrefix: string;
  expandedSources: Set<string>;
  onToggleExpand: (key: string) => void;
  onArtifactView?: (artifactId: string) => void;
  onArtifactDownload?: (artifact: ChatArtifact) => void;
  downloadingArtifact?: string | null;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
  onImageClick?: (img: { src: string; alt: string }) => void;
  onViewDetails?: (detail: {
    content: string;
    sources?: ToolResultSource[];
    documents?: Document[];
    toolName?: string;
    toolInput?: Record<string, unknown>;
  }) => void;
  onGraphView?: (data: GraphSearchResult) => void;
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
  toolInput,
  onArtifactView,
  onArtifactDownload,
  downloadingArtifact,
  onImageClick,
  onViewDetails,
  onGraphView,
  documents = [],
}: ToolResultCardProps) {
  const { t } = useTranslation();
  const entry = getToolEntry(toolName, resultType === 'artifact');
  const Icon = entry.icon;
  const displayName = toolName
    ? formatToolDisplayName(toolName)
    : 'Tool Result';

  // Build a summary label
  const summaryLabel = buildSummaryLabel(
    t,
    displayName,
    toolName,
    resultType,
    artifact,
    sources,
    images,
    attachments,
    content,
    toolInput,
  );

  const handleClick = () => {
    // Artifact: open viewer
    if (resultType === 'artifact' && artifact && onArtifactView) {
      onArtifactView(artifact.artifact_id);
      return;
    }

    // Image: open first image
    if (images && images.length > 0 && onImageClick) {
      onImageClick(images[0]);
      return;
    }
    if (
      attachments &&
      attachments.length > 0 &&
      attachments[0].type === 'image' &&
      attachments[0].preview &&
      onImageClick
    ) {
      onImageClick({
        src: attachments[0].preview ?? '',
        alt: attachments[0].name,
      });
      return;
    }

    // Graph: open graph modal
    if (entry.renderAsGraph && content && onGraphView) {
      try {
        const parsed = JSON.parse(content) as GraphSearchResult;
        onGraphView(parsed);
        return;
      } catch {
        // fallthrough to view details
      }
    }

    // Default: open detail modal
    if (content && onViewDetails) {
      onViewDetails({
        content,
        sources,
        documents,
        toolName,
        toolInput,
      });
    }
  };

  // Unregistered tools: just show "completed"
  if (!isRegisteredTool(toolName)) {
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <Check className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-500 flex-shrink-0" />
        <span className="text-sm text-indigo-400 dark:text-indigo-500">
          {displayName} - {t('common.completed', 'completed')}
        </span>
      </div>
    );
  }

  // Graph search: show result summary inline
  if (entry.renderAsGraph && content) {
    let graphSources = 0;
    try {
      const parsed = JSON.parse(content) as GraphSearchResult;
      graphSources = parsed.sources?.length || 0;
    } catch {
      // ignore
    }

    if (graphSources > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          className="group flex items-center gap-1.5 py-0.5 text-left transition-colors hover:opacity-80"
        >
          <Icon className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-500 flex-shrink-0" />
          <span className="text-sm text-indigo-400 dark:text-indigo-500">
            {displayName} -{' '}
            {t(
              'chat.graphSourcesFound',
              '{{count}} additional pages discovered',
              { count: graphSources },
            )}
          </span>
          <Eye className="w-3 h-3 text-indigo-300 dark:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </button>
      );
    }

    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <Check className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-500 flex-shrink-0" />
        <span className="text-sm text-indigo-400 dark:text-indigo-500">
          {displayName} -{' '}
          {t('chat.graphNoAdditionalSources', 'No additional pages discovered')}
        </span>
      </div>
    );
  }

  // Collect all displayable images
  const allImages: { src: string; alt: string }[] = [
    ...(images || []),
    ...(attachments || [])
      .filter((a) => a.type === 'image' && a.preview)
      .map((a) => ({ src: a.preview ?? '', alt: a.name })),
  ];

  // If there are images, show them inline
  if (allImages.length > 0) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {allImages.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onImageClick?.(img)}
              className="group relative rounded-xl overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <img
                src={img.src}
                alt={img.alt}
                className="max-w-80 max-h-80 object-contain border border-slate-200 dark:border-slate-600"
              />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-xs text-white font-medium">
                  {t('chat.clickToEnlarge', 'Click to enlarge')}
                </span>
              </div>
            </button>
          ))}
        </div>
        {content && (
          <button
            type="button"
            onClick={handleClick}
            className="group flex items-center gap-1.5 py-0.5 text-left transition-colors hover:opacity-80"
          >
            <Eye className="w-3 h-3 text-indigo-400 dark:text-indigo-500" />
            <span className="text-xs text-indigo-400 dark:text-indigo-500">
              {t('chat.viewDetails', 'View details')}
            </span>
          </button>
        )}
      </div>
    );
  }

  // Default: compact single-line
  return (
    <button
      type="button"
      onClick={handleClick}
      className="group flex items-center gap-1.5 py-0.5 text-left transition-colors hover:opacity-80"
    >
      <Icon className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-500 flex-shrink-0" />
      <span className="text-sm text-indigo-400 dark:text-indigo-500 truncate max-w-md">
        {summaryLabel}
      </span>
      {(content || artifact) && (
        <Eye className="w-3 h-3 text-indigo-300 dark:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      )}
    </button>
  );
}

function buildSummaryLabel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any,
  displayName: string,
  toolName?: string,
  resultType?: string,
  artifact?: ChatArtifact,
  sources?: ToolResultSource[],
  images?: ToolResultImage[],
  attachments?: ChatAttachment[],
  content?: string,
  toolInput?: Record<string, unknown>,
): string {
  // Artifact
  if (resultType === 'artifact' && artifact) {
    return `${displayName} - ${artifact.filename}`;
  }

  // Image
  const imageCount =
    (images?.length || 0) +
    (attachments?.filter((a) => a.type === 'image').length || 0);
  if (imageCount > 0) {
    return `${displayName} - ${t('chat.generatedImage', 'Generated image')}`;
  }

  // Sources
  if (sources && sources.length > 0) {
    return `${displayName} - ${t('chat.sourcesReviewed', '{{count}} sources reviewed', { count: sources.length })}`;
  }

  // Overview: show document count
  if (toolName === 'search___overview' && content) {
    try {
      const parsed = JSON.parse(content) as { documents?: unknown[] };
      const count = parsed.documents?.length ?? 0;
      return `${displayName} - ${t('chat.documentsFound', '{{count}} documents', { count })}`;
    } catch {
      // fallthrough
    }
  }

  // Query-based tools
  if (typeof toolInput?.query === 'string' && toolInput.query) {
    const q =
      toolInput.query.length > 40
        ? toolInput.query.slice(0, 40) + '...'
        : toolInput.query;
    return `${displayName} - "${q}"`;
  }

  // Content preview
  if (content) {
    const preview = content.replace(/\s+/g, ' ').trim();
    const short = preview.length > 50 ? preview.slice(0, 50) + '...' : preview;
    return `${displayName} - ${short}`;
  }

  return displayName;
}
