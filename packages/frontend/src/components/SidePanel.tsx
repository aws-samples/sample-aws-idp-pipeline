import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Layers,
  Loader2,
  MoreVertical,
  Trash2,
  FileText,
  Image,
  FileCode,
  FileSpreadsheet,
  Film,
  File,
  Music,
  Copy,
  Download,
  PanelRightClose,
  RefreshCw,
  Eye,
  Check,
  CircleAlert,
  ChevronDown,
  FileX,
  Search,
  X,
  Presentation,
  Globe,
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import {
  Artifact,
  Document,
  Workflow,
  WorkflowProgress,
  StepStatus,
} from '../types/project';

function getArtifactIcon(contentType: string) {
  if (contentType.startsWith('image/')) return Image;
  if (contentType.startsWith('video/')) return Film;
  if (contentType === 'application/pdf') return FileText;
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.ms-powerpoint'
  )
    return Presentation;
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

const getFileIcon = (fileType: string) => {
  if (fileType.includes('pdf')) {
    return <FileText className="h-5 w-5 text-blue-400" />;
  }
  if (fileType.includes('image')) {
    return <Image className="h-5 w-5 text-emerald-400" />;
  }
  if (fileType.includes('video')) {
    return <Film className="h-5 w-5 text-violet-400" />;
  }
  if (fileType.includes('audio')) {
    return <Music className="h-5 w-5 text-amber-400" />;
  }
  if (fileType.includes('webreq')) {
    return <Globe className="h-5 w-5 text-cyan-400" />;
  }
  if (fileType === 'text/markdown') {
    return <FileCode className="h-5 w-5 text-indigo-400" />;
  }
  if (fileType === 'text/csv') {
    return <FileSpreadsheet className="h-5 w-5 text-green-400" />;
  }
  if (fileType.includes('wordprocessing')) {
    return <FileText className="h-5 w-5 text-blue-500" />;
  }
  if (fileType === 'text/plain') {
    return <FileText className="h-5 w-5 text-slate-500" />;
  }
  return <File className="h-5 w-5 text-slate-400" />;
};

const getStatusBadge = (status: string) => {
  const statusColors: Record<string, string> = {
    completed:
      'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-500',
    processing:
      'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-500',
    in_progress:
      'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-500',
    failed: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-500',
    uploading:
      'bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-500',
    uploaded:
      'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-500',
    pending: 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
  };
  return (
    statusColors[status] ||
    'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-500'
  );
};

function StepProgressBar({
  steps,
  segmentProgress,
}: {
  steps?: Record<string, StepStatus>;
  segmentProgress: { completed: number; total: number } | null;
}) {
  const { t } = useTranslation();

  const [expanded, setExpanded] = useState(false);

  if (!steps) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin flex-shrink-0" />
        <span className="text-xs text-blue-600">
          {t('workflow.inProgress')}
        </span>
      </div>
    );
  }

  const STEP_ORDER = [
    'segment_prep',
    'webcrawler',
    'bda_processor',
    'format_parser',
    'paddleocr_processor',
    'transcribe',
    'segment_builder',
    'segment_analyzer',
    'document_summarizer',
  ];

  const visibleSteps = STEP_ORDER.filter(
    (key) => steps[key] && steps[key].status !== 'skipped',
  ).map((key) => [key, steps[key]] as [string, StepStatus]);

  const hasSteps = visibleSteps.length > 0;
  const completedCount = visibleSteps.filter(
    ([, s]) => s.status === 'completed',
  ).length;
  const totalCount = visibleSteps.length;
  const overallPct = hasSteps
    ? Math.round((completedCount / totalCount) * 100)
    : 0;
  const activeStep = visibleSteps.find(([, s]) => s.status === 'in_progress');

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 text-blue-500 animate-spin flex-shrink-0" />
          <span className="text-[11px] text-blue-700 dark:text-blue-300 font-medium truncate">
            {activeStep ? activeStep[1].label : t('workflow.inProgress')}
          </span>
          {hasSteps && (
            <span className="text-[10px] text-slate-400 flex-shrink-0 ml-auto">
              {completedCount}/{totalCount}
            </span>
          )}
          {hasSteps && (
            <ChevronDown
              className={`h-3 w-3 text-slate-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          )}
        </div>
        {hasSteps && (
          <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {visibleSteps.map(([key, step]) => {
            const isActive = step.status === 'in_progress';
            const isDone = step.status === 'completed';
            const isFailed = step.status === 'failed';

            const hasNumericProgress =
              isActive && segmentProgress && key === 'segment_analyzer';
            const pct = hasNumericProgress
              ? Math.round(
                  (segmentProgress.completed / segmentProgress.total) * 100,
                )
              : 0;

            return (
              <div key={key} className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  {isDone && (
                    <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                  )}
                  {isActive && (
                    <Loader2 className="h-3 w-3 text-blue-500 animate-spin flex-shrink-0" />
                  )}
                  {isFailed && (
                    <CircleAlert className="h-3 w-3 text-red-500 flex-shrink-0" />
                  )}
                  {step.status === 'pending' && (
                    <div className="h-3 w-3 rounded-full border border-slate-300 dark:border-slate-500 flex-shrink-0" />
                  )}

                  <span
                    className={`text-[11px] leading-tight truncate ${
                      isDone
                        ? 'text-green-600 dark:text-green-400'
                        : isActive
                          ? 'text-blue-700 dark:text-blue-300 font-medium'
                          : isFailed
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {hasNumericProgress && (
                    <span className="text-[10px] text-blue-500 flex-shrink-0 ml-auto">
                      {segmentProgress.completed}/{segmentProgress.total}
                    </span>
                  )}
                </div>

                {isActive && key === 'paddleocr_processor' && (
                  <p className="pl-[18px] text-[10px] text-amber-600 dark:text-amber-400">
                    {t('workflow.steps.paddleocrHint')}
                  </p>
                )}

                {hasNumericProgress && (
                  <div className="ml-[18px] h-1 rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Vertical drag-to-resize hook
function useVerticalResize(
  containerRef: React.RefObject<HTMLDivElement | null>,
  initialRatio = 50,
  minRatio = 10,
  maxRatio = 90,
  storageKey = 'sidepanel-split',
) {
  const [topRatio, setTopRatio] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= minRatio && parsed <= maxRatio) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return initialRatio;
  });

  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const y = ev.clientY - rect.top;
        const ratio = Math.min(
          maxRatio,
          Math.max(minRatio, (y / rect.height) * 100),
        );
        setTopRatio(ratio);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // Save to localStorage on release
        setTopRatio((r) => {
          try {
            localStorage.setItem(storageKey, String(r));
          } catch {
            // ignore
          }
          return r;
        });
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [containerRef, minRatio, maxRatio, storageKey],
  );

  return { topRatio, onMouseDown };
}

function useMouseGlow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--glow-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--glow-y', `${e.clientY - rect.top}px`);
    };
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, [ref]);
}

function SectionHeader({
  accent,
  icon,
  label,
  children,
}: {
  accent: 'teal' | 'violet';
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMouseGlow(ref);

  return (
    <div
      ref={ref}
      className={`section-header section-header--${accent} flex items-center gap-1.5 px-4 py-2.5 flex-shrink-0 min-w-0 overflow-hidden`}
    >
      <span className="section-header__icon">{icon}</span>
      <span className="section-header__label">{label}</span>
      {children}
    </div>
  );
}

interface SidePanelProps {
  artifacts?: Artifact[];
  currentArtifactId?: string;
  onArtifactSelect?: (artifactId: string) => void;
  onArtifactCopy?: (artifact: Artifact) => void;
  onArtifactDownload?: (artifact: Artifact) => void;
  onArtifactDelete?: (artifactId: string) => Promise<void>;
  onCollapse?: () => void;
  documents?: Document[];
  workflows?: Workflow[];
  workflowProgressMap?: Record<string, WorkflowProgress>;
  uploading?: boolean;
  onAddDocument?: () => void;
  onRefreshDocuments?: () => void;
  onViewWorkflow?: (documentId: string, workflowId: string) => void;
  onDeleteDocument?: (documentId: string) => void;
}

export default function SidePanel({
  artifacts = [],
  currentArtifactId,
  onArtifactSelect,
  onArtifactCopy,
  onArtifactDownload,
  onArtifactDelete,
  onCollapse,
  documents = [],
  workflows = [],
  workflowProgressMap = {},
  uploading = false,
  onAddDocument,
  onRefreshDocuments,
  onViewWorkflow,
  onDeleteDocument,
}: SidePanelProps) {
  const { t } = useTranslation();
  const [openArtifactMenuId, setOpenArtifactMenuId] = useState<string | null>(
    null,
  );
  const [artifactToDelete, setArtifactToDelete] = useState<Artifact | null>(
    null,
  );
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(
    null,
  );

  // Document search/filter state
  const [docSearchOpen, setDocSearchOpen] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const docInputRef = useRef<HTMLInputElement>(null);
  const docComposing = useRef(false);
  const [docStatusFilter, setDocStatusFilter] = useState<
    'all' | 'completed' | 'processing' | 'failed'
  >('all');

  // Artifact search state
  const [artSearchOpen, setArtSearchOpen] = useState(false);
  const [artSearchQuery, setArtSearchQuery] = useState('');
  const artInputRef = useRef<HTMLInputElement>(null);
  const artComposing = useRef(false);

  const filteredDocuments = useMemo(() => {
    let result = documents;
    if (docSearchQuery) {
      const q = docSearchQuery.normalize('NFC').toLowerCase();
      result = result.filter((d) =>
        d.name.normalize('NFC').toLowerCase().includes(q),
      );
    }
    if (docStatusFilter !== 'all') {
      result = result.filter((d) => d.status === docStatusFilter);
    }
    return result;
  }, [documents, docSearchQuery, docStatusFilter]);

  const filteredArtifacts = useMemo(() => {
    if (!artSearchQuery) return artifacts;
    const q = artSearchQuery.normalize('NFC').toLowerCase();
    return artifacts.filter((a) =>
      a.filename.normalize('NFC').toLowerCase().includes(q),
    );
  }, [artifacts, artSearchQuery]);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const { topRatio, onMouseDown } = useVerticalResize(splitContainerRef, 60);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-artifact-menu]')) {
        setOpenArtifactMenuId(null);
      }
    };

    if (openArtifactMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openArtifactMenuId]);

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
      <div ref={splitContainerRef} className="h-full flex flex-col gap-0.5 p-1">
        {/* Documents Panel (top) */}
        <div
          className="flex flex-col min-h-0 overflow-hidden bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-700/60"
          style={{ height: `${topRatio}%` }}
        >
          {/* Documents Header */}
          <SectionHeader
            accent="teal"
            icon={<FileText className="w-4 h-4" />}
            label={t('documents.title', 'Documents')}
          >
            {onAddDocument && (
              <button
                onClick={onAddDocument}
                className="px-2.5 py-1 text-xs font-medium rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors truncate min-w-0"
              >
                {t('documents.addDocument', 'Add Document')}
              </button>
            )}
            {onRefreshDocuments && (
              <button
                onClick={onRefreshDocuments}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                title={t('documents.refresh')}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => {
                setDocSearchOpen((v) => !v);
                if (docSearchOpen) {
                  setDocSearchQuery('');
                  setDocStatusFilter('all');
                  if (docInputRef.current) docInputRef.current.value = '';
                }
              }}
              className={`p-1 rounded transition-colors flex-shrink-0 ${
                docSearchOpen
                  ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/30'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={t('common.search')}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            <div className="flex-1" />
            <span className="text-xs text-slate-400 flex-shrink-0">
              {docSearchQuery || docStatusFilter !== 'all'
                ? `${filteredDocuments.length}/${documents.length}`
                : documents.length}
            </span>
            {onCollapse && (
              <button
                onClick={onCollapse}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors flex-shrink-0"
                title={t('nav.collapse')}
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            )}
          </SectionHeader>

          {/* Documents Search Toolbar */}
          {docSearchOpen && (
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-700/60 flex-shrink-0 space-y-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                <input
                  ref={docInputRef}
                  type="text"
                  defaultValue=""
                  onChange={(e) => {
                    if (!docComposing.current) {
                      setDocSearchQuery(e.target.value);
                    }
                  }}
                  onCompositionStart={() => {
                    docComposing.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    docComposing.current = false;
                    setDocSearchQuery((e.target as HTMLInputElement).value);
                  }}
                  placeholder={t('documents.searchPlaceholder')}
                  className="w-full h-7 pl-7 pr-7 text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {docSearchQuery && (
                  <button
                    onClick={() => {
                      setDocSearchQuery('');
                      if (docInputRef.current) docInputRef.current.value = '';
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex gap-1">
                {(['all', 'completed', 'processing', 'failed'] as const).map(
                  (status) => (
                    <button
                      key={status}
                      onClick={() => setDocStatusFilter(status)}
                      className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                        docStatusFilter === status
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                      }`}
                    >
                      {t(
                        `documents.filter${status.charAt(0).toUpperCase() + status.slice(1)}`,
                      )}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Documents List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {uploading && (
              <div className="px-3 py-2 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                <span className="text-xs text-blue-600">
                  {t('documents.uploading')}
                </span>
              </div>
            )}
            {documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4">
                <FileX className="h-8 w-8 text-slate-300 dark:text-slate-500 mb-2" />
                <p className="text-xs text-slate-500">
                  {t('documents.noDocuments')}
                </p>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4">
                <Search className="h-8 w-8 text-slate-300 dark:text-slate-500 mb-2" />
                <p className="text-xs text-slate-500">
                  {t('documents.noMatchingDocuments')}
                </p>
              </div>
            ) : (
              <div className="p-2 pt-3 space-y-1">
                {filteredDocuments.map((doc) => {
                  const workflow = workflows.find(
                    (wf) => wf.document_id === doc.document_id,
                  );
                  const workflowProgress = workflowProgressMap[doc.document_id];
                  const isFailed =
                    doc.status === 'failed' ||
                    workflowProgress?.status === 'failed';
                  const isProcessing =
                    !isFailed &&
                    workflowProgress &&
                    workflowProgress.status !== 'completed';

                  return (
                    <div
                      key={doc.document_id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'application/x-document',
                          JSON.stringify({
                            document_id: doc.document_id,
                            name: doc.name,
                          }),
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      className={`group bg-white dark:bg-slate-900 border rounded-lg p-2.5 transition-all ${
                        isProcessing
                          ? 'border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`flex-shrink-0 p-1.5 rounded-lg doc-icon-bg ${
                            isProcessing ? 'processing' : ''
                          }`}
                        >
                          {getFileIcon(doc.file_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate"
                            title={doc.name}
                          >
                            {doc.name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <span
                              className={`text-[10px] px-1 py-0.5 rounded font-medium truncate ${getStatusBadge(doc.status)}`}
                            >
                              {t(`documents.${doc.status}`, doc.status)}
                            </span>
                            <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                              {(doc.file_size / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          {workflow && onViewWorkflow && (
                            <button
                              onClick={() =>
                                onViewWorkflow(
                                  workflow.document_id,
                                  workflow.workflow_id,
                                )
                              }
                              className="p-1 text-blue-900 bg-blue-400 hover:bg-blue-100 hover:text-blue-700 hover:scale-105 hover:shadow-md dark:text-blue-300 dark:bg-blue-800 dark:hover:bg-blue-500 dark:hover:text-white rounded-lg transition-all"
                              title={t('documents.view')}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!isProcessing && onDeleteDocument && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteDocument(doc.document_id);
                              }}
                              className="p-1 text-red-900 bg-red-400 hover:bg-red-100 hover:text-red-600 hover:scale-105 hover:shadow-md dark:text-red-400 dark:bg-red-800 dark:hover:bg-red-500 dark:hover:text-white rounded-lg transition-all"
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isProcessing && workflowProgress && (
                        <StepProgressBar
                          steps={workflowProgress.steps}
                          segmentProgress={workflowProgress.segmentProgress}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Resize Handle */}
        <div
          className="splitter-handle vertical flex-shrink-0 select-none"
          onMouseDown={onMouseDown}
        />

        {/* Artifacts Panel (bottom) */}
        <div
          className="flex flex-col min-h-0 overflow-hidden bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-700/60"
          style={{ flex: 1 }}
        >
          {/* Artifacts Header */}
          <SectionHeader
            accent="violet"
            icon={<Layers className="w-4 h-4" />}
            label={t('chat.artifacts', 'Artifacts')}
          >
            <button
              onClick={() => {
                setArtSearchOpen((v) => !v);
                if (artSearchOpen) {
                  setArtSearchQuery('');
                  if (artInputRef.current) artInputRef.current.value = '';
                }
              }}
              className={`p-1 rounded transition-colors flex-shrink-0 ${
                artSearchOpen
                  ? 'text-violet-500 bg-violet-50 dark:bg-violet-900/30'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={t('common.search')}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            <div className="flex-1" />
            <span className="text-xs text-slate-400">
              {artSearchQuery
                ? `${filteredArtifacts.length}/${artifacts.length}`
                : artifacts.length}
            </span>
          </SectionHeader>

          {/* Artifacts Search Toolbar */}
          {artSearchOpen && (
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-700/60 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                <input
                  ref={artInputRef}
                  type="text"
                  defaultValue=""
                  onChange={(e) => {
                    if (!artComposing.current) {
                      setArtSearchQuery(e.target.value);
                    }
                  }}
                  onCompositionStart={() => {
                    artComposing.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    artComposing.current = false;
                    setArtSearchQuery((e.target as HTMLInputElement).value);
                  }}
                  placeholder={t('artifacts.searchPlaceholder')}
                  className="w-full h-7 pl-7 pr-7 text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                {artSearchQuery && (
                  <button
                    onClick={() => {
                      setArtSearchQuery('');
                      if (artInputRef.current) artInputRef.current.value = '';
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Artifacts List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {artifacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4">
                <Layers className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-500" />
                <p className="text-xs text-slate-500">
                  {t('chat.noArtifacts', 'No artifacts yet')}
                </p>
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4">
                <Search className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-500" />
                <p className="text-xs text-slate-500">
                  {t('artifacts.noMatchingArtifacts')}
                </p>
              </div>
            ) : (
              <div className="p-2 pb-3 space-y-0.5">
                {filteredArtifacts.map((artifact) => {
                  const ArtifactIcon = getArtifactIcon(artifact.content_type);
                  return (
                    <div
                      key={artifact.artifact_id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'application/x-artifact',
                          JSON.stringify({
                            artifact_id: artifact.artifact_id,
                            filename: artifact.filename,
                          }),
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        artifact.artifact_id === currentArtifactId
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                      onClick={() => onArtifactSelect?.(artifact.artifact_id)}
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
                              handleArtifactMenuToggle(artifact.artifact_id, e)
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
