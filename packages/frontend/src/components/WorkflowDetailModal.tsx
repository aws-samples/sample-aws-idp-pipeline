import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  RefreshCw,
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  FileText,
  Globe,
  Link,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Network,
  Cloud,
  ChevronDown,
  Search,
  Download,
  DatabaseZap,
} from 'lucide-react';
import { WorkflowDetail, SegmentData, AnalysisPopup } from '../types/project';
import ConfirmModal from './ConfirmModal';
import { LANGUAGES, CARD_COLORS } from './ProjectSettingsModal';
import OcrDocumentView from './OcrDocumentView';
import ExcelViewer from './ExcelViewer';
import DatasetView, { type DatasetMeta } from './DatasetView';
import DocumentScanner from './ui/document-scanner';
import { useAwsClient } from '../hooks/useAwsClient';
import { useModal } from '../hooks/useModal';
import { useDragPan } from '../hooks/useDragPan';
import GraphView from './GraphView/GraphView';
import TagCloudView from './GraphView/TagCloudView';
import GraphControls from './GraphView/GraphControls';
import GraphLoading from './GraphView/GraphLoading';
import type { GraphData, TagCloudItem } from './GraphView/useGraphData';
import { LINK_TYPE_COLORS } from './GraphView/constants';
import {
  isTextFileType,
  isMarkdownFileType,
  isSpreadsheetFileType,
  isExcelFileType,
  getFileTypeLabel,
} from '../lib/fileTypeUtils';

/**
 * Fix broken markdown table rows where cell values contain newlines.
 * e.g. "| SYM\nBOL |" -> "| SYMBOL |"
 */
const sanitizeMarkdownTable = (text: string): string => {
  const lines = text.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const prev = result[result.length - 1];
    // If prev line starts with | but doesn't end with |, merge
    if (
      prev &&
      prev.startsWith('|') &&
      !prev.endsWith('|') &&
      !line.startsWith('|') &&
      !line.startsWith('#')
    ) {
      result[result.length - 1] = prev + ' ' + line;
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
};

// Parse S3 URI to bucket and key
const parseS3Uri = (uri: string): { bucket: string; key: string } | null => {
  if (!uri?.startsWith('s3://')) return null;
  const parts = uri.slice(5).split('/');
  const bucket = parts[0];
  const key = parts.slice(1).join('/');
  return { bucket, key };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remarkPlugins: any[] = [[remarkGfm, { singleTilde: false }]];
const passUrl = (url: string) => url;

const proseClass =
  'prose prose-slate dark:prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-hr:my-3 prose-hr:border-slate-300 dark:prose-hr:border-white/[0.12] prose-table:border-collapse prose-th:border prose-th:border-slate-300 dark:prose-th:border-white/[0.12] prose-th:bg-slate-100 dark:prose-th:bg-white/[0.06] prose-th:p-2 prose-td:border prose-td:border-slate-300 dark:prose-td:border-white/[0.12] prose-td:p-2';

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50 mt-5 mb-3 pb-2 border-b border-slate-200 dark:border-white/[0.1]">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mt-5 mb-2 pl-3 border-l-[3px] border-blue-500 dark:border-blue-400">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1.5">
      {children}
    </h3>
  ),
  hr: () => (
    <div className="my-4 flex items-center">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-white/[0.15]" />
    </div>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 pl-4 py-2 border-l-[3px] border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10 rounded-r-lg not-italic [&>p]:my-1">
      {children}
    </blockquote>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-300/50 hover:decoration-blue-500 underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img
      src={src}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg shadow-md my-4"
      loading="lazy"
    />
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-3 p-4 bg-slate-50 dark:bg-black/30 rounded-xl overflow-x-auto text-sm leading-relaxed border border-slate-200 dark:border-white/[0.08]">
      {children}
    </pre>
  ),
};

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={`relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0 cursor-pointer ${
        checked ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#363b50]'
      }`}
    >
      <span
        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-slate-600 dark:text-slate-300">
        {label}
      </span>
      <ToggleSwitch checked={checked} onChange={() => onChange(!checked)} />
    </div>
  );
}

interface WorkflowDetailModalProps {
  workflow: WorkflowDetail;
  projectId: string;
  projectColor: number;
  loadingWorkflow: boolean;
  onClose: () => void;
  onReanalyze?: (userInstructions: string, language?: string) => Promise<void>;
  reanalyzing?: boolean;
  onRegenerateQa?: (
    segmentIndex: number,
    qaIndex: number,
    question: string,
    userInstructions: string,
  ) => Promise<{ analysis_query: string; content: string }>;
  onAddQa?: (
    segmentIndex: number,
    question: string,
    userInstructions: string,
  ) => Promise<{ analysis_query: string; content: string; qa_index: number }>;
  onDeleteQa?: (
    segmentIndex: number,
    qaIndex: number,
  ) => Promise<{ deleted: boolean; qa_index: number }>;
  initialSegmentIndex?: number;
  onLoadSegment?: (segmentIndex: number) => Promise<SegmentData>;
}

export default function WorkflowDetailModal({
  workflow,
  projectId,
  projectColor,
  loadingWorkflow,
  onClose,
  onReanalyze,
  reanalyzing = false,
  onRegenerateQa,
  onAddQa,
  onDeleteQa,
  initialSegmentIndex = 0,
  onLoadSegment,
}: WorkflowDetailModalProps) {
  const { t } = useTranslation();
  const { getPresignedDownloadUrl, fetchApi } = useAwsClient();
  const fetchApiRef = useRef(fetchApi);
  fetchApiRef.current = fetchApi;
  const [viewMode, setViewMode] = useState<'document' | 'graph'>('document');
  // Structured datasets (xlsx/csv/tsv) render a table preview and have no
  // analysis segments, so segment navigation is hidden for them.
  const isDataset = isSpreadsheetFileType(workflow.file_type);
  // Dataset sheets (each Excel sheet = one dataset). Held in the parent so the
  // sheet selector can live in the header bar (same spot/style as the segment
  // selector) while DatasetView renders the selected sheet.
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!isDataset) return;
    let cancelled = false;
    setDatasetsLoading(true);
    fetchApiRef
      .current<DatasetMeta[]>(
        `projects/${projectId}/datasets?source_document_id=${workflow.document_id}`,
      )
      .then((list) => {
        if (cancelled) return;
        setDatasets(list);
        setSelectedDatasetId((prev) => prev ?? list[0]?.dataset_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setDatasets([]);
      })
      .finally(() => {
        if (!cancelled) setDatasetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDataset, projectId, workflow.document_id]);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [tagCloudData, setTagCloudData] = useState<TagCloudItem[] | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphTotalSegments, setGraphTotalSegments] = useState(0);
  const [graphMode, setGraphMode] = useState<'range' | 'page' | 'search'>(
    'range',
  );
  const totalSegs = graphTotalSegments || workflow.total_segments || 0;
  const [graphPageRange, setGraphPageRange] = useState<[number, number]>([
    1,
    Math.min(100, Math.max(1, totalSegs)),
  ]);
  const [graphSpecificPage, setGraphSpecificPage] = useState(1);
  // Clamp range when totalSegments becomes known
  useEffect(() => {
    if (totalSegs > 0) {
      setGraphPageRange((prev) => [prev[0], Math.min(prev[1], totalSegs)]);
    }
  }, [totalSegs]);
  const [graphSearchTerm, setGraphSearchTerm] = useState('');
  const [graphHiddenLinkTypes, setGraphHiddenLinkTypes] = useState<Set<string>>(
    new Set(['NEXT']),
  );
  const [graphShowIncoming, setGraphShowIncoming] = useState(true);
  const [graphShowOutgoing, setGraphShowOutgoing] = useState(true);
  const [graphSearchFilter, setGraphSearchFilter] = useState('');
  const [graphDepth, setGraphDepth] = useState(3);
  const [graphFocusPage, setGraphFocusPage] = useState<number | null>(null);
  const [graphShowEdgeLabels, setGraphShowEdgeLabels] = useState(true);
  const [expandingAll, setExpandingAll] = useState(false);
  const [graphSubMode, setGraphSubMode] = useState<'force' | 'tagcloud'>(
    'force',
  );
  const [tagCloudMinConn, setTagCloudMinConn] = useState(1);
  const [tagCloudMaxTags, setTagCloudMaxTags] = useState(100);
  const [tagCloudRotation, setTagCloudRotation] = useState(true);
  const [graphRebuilding, setGraphRebuilding] = useState(false);
  const [graphPanelSections, setGraphPanelSections] = useState({
    filters: true,
    display: false,
  });
  const [currentSegmentIndex, setCurrentSegmentIndex] =
    useState(initialSegmentIndex);
  const [imageLoading, setImageLoading] = useState(false);
  const [analysisPopup, setAnalysisPopup] = useState<AnalysisPopup>({
    type: null,
    content: '',
    title: '',
    qaItems: [],
  });
  const handleDownloadFile = useCallback(async () => {
    const s3Info = parseS3Uri(workflow.file_uri);
    if (!s3Info) return;
    try {
      const presignedUrl = await getPresignedDownloadUrl(
        s3Info.bucket,
        s3Info.key,
      );
      const response = await fetch(presignedUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = workflow.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download file:', error);
    }
  }, [workflow.file_uri, workflow.file_name, getPresignedDownloadUrl]);

  const [showReanalyzeModal, setShowReanalyzeModal] = useState(false);
  const [reanalyzeInstructions, setReanalyzeInstructions] = useState('');
  const [reanalyzeLanguage, setReanalyzeLanguage] = useState(
    workflow.language || 'en',
  );
  const [regenerateTarget, setRegenerateTarget] = useState<{
    qaIndex: number;
    question: string;
    userInstructions: string;
    isBase?: boolean;
  } | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(
    null,
  );
  const [addQaTarget, setAddQaTarget] = useState<{
    question: string;
    userInstructions: string;
  } | null>(null);
  const [addingQa, setAddingQa] = useState(false);
  const pendingQaScrollRef = useRef<number | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(
    null,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const imageScrollRef = useDragPan<HTMLDivElement>();
  const [imageNaturalWidth, setImageNaturalWidth] = useState(0);

  // Fetch graph data only when user clicks Go / Search or switches to graph view
  const [graphQueryTrigger, setGraphQueryTrigger] = useState(0);
  const fetchGraph = useCallback(() => {
    setGraphData(null);
    setGraphQueryTrigger((p) => p + 1);
  }, []);

  useEffect(() => {
    if (viewMode !== 'graph') return;
    if (graphMode === 'search' && !graphSearchTerm) return;
    const base = `projects/${projectId}/graph/documents/${workflow.document_id}`;
    let url = base;
    if (graphMode === 'range') {
      url = `${base}?from_page=${graphPageRange[0] - 1}&to_page=${graphPageRange[1]}`;
    } else if (graphMode === 'page') {
      url = `${base}?page=${graphSpecificPage - 1}`;
    } else if (graphMode === 'search' && graphSearchTerm) {
      url = `${base}?search=${encodeURIComponent(graphSearchTerm)}`;
    }
    const abortController = new AbortController();
    setGraphLoading(true);
    fetchApiRef
      .current<GraphData & { total_segments?: number }>(url, {
        signal: abortController.signal,
      })
      .then((gData) => {
        const qCounters = new Map<number, number>();
        for (const node of gData.nodes) {
          if (node.label !== 'analysis') continue;
          const qi = node.properties?.qa_index as number | undefined;
          const q = node.properties?.question as string | undefined;
          const seg = (node.properties?.segment_index as number) ?? -1;
          const isBase = qi === 0 && (!q || /Analysis$/i.test(q));
          node.properties.is_base = isBase;
          if (isBase) {
            node.name = 'Analysis';
          } else {
            const cnt = (qCounters.get(seg) ?? 0) + 1;
            qCounters.set(seg, cnt);
            node.name = `Extra ${cnt}`;
          }
        }
        setGraphData(gData);
        if (gData.total_segments) setGraphTotalSegments(gData.total_segments);
      })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        console.warn('Graph fetch failed:', err);
        setGraphData({ nodes: [], edges: [] });
      })
      .finally(() => {
        if (!abortController.signal.aborted) setGraphLoading(false);
      });
    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, graphQueryTrigger]);

  // Fetch tag cloud data once (lightweight, full document)
  useEffect(() => {
    if (viewMode !== 'graph') return;
    if (tagCloudData) return;
    const abortController = new AbortController();
    fetchApiRef
      .current<{ tags: TagCloudItem[] }>(
        `projects/${projectId}/graph/documents/${workflow.document_id}/tagcloud`,
        { signal: abortController.signal },
      )
      .then((res) => {
        if (res.tags) setTagCloudData(res.tags);
      })
      .catch(() => undefined);
    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const handleGraphRebuild = useCallback(() => {
    if (graphRebuilding) return;
    setGraphRebuilding(true);
    fetchApiRef
      .current(
        `projects/${projectId}/graph/documents/${workflow.document_id}/rebuild`,
        { method: 'POST' },
      )
      .then(() => {
        setTimeout(() => {
          fetchGraph();
          setGraphRebuilding(false);
        }, 5000);
      })
      .catch(() => setGraphRebuilding(false));
  }, [graphRebuilding, projectId, workflow.document_id, fetchGraph]);

  const graphLinkTypes = useMemo(() => {
    if (!graphData) return [];
    const types = new Set<string>();
    for (const edge of graphData.edges) {
      types.add(edge.label);
    }
    return Array.from(types).sort();
  }, [graphData]);

  const graphMaxPage = useMemo(() => {
    if (!graphData) return 0;
    let max = 0;
    for (const node of graphData.nodes) {
      if (node.label === 'segment' && node.properties?.segment_index != null) {
        max = Math.max(max, node.properties.segment_index as number);
      }
    }
    return max;
  }, [graphData]);

  const toggleGraphLinkType = useCallback((type: string) => {
    setGraphHiddenLinkTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(async () => {
    if (!graphData || !workflow.document_id) return;
    const clusterNodes = graphData.nodes.filter((n) => n.label === 'cluster');
    if (clusterNodes.length === 0) return;
    setExpandingAll(true);
    try {
      const result = await fetchApi<GraphData>(
        `projects/${projectId}/graph/documents/${workflow.document_id}/expand-all`,
      );
      // Remove all cluster nodes, add expanded entity nodes
      const clusterIds = new Set(clusterNodes.map((n) => n.id));
      const existingIds = new Set(graphData.nodes.map((n) => n.id));
      const newNodes = graphData.nodes.filter((n) => !clusterIds.has(n.id));
      for (const node of result.nodes) {
        if (!existingIds.has(node.id)) {
          newNodes.push(node);
        }
      }
      const newEdges = graphData.edges.filter(
        (e) => !clusterIds.has(e.source) && !clusterIds.has(e.target),
      );
      newEdges.push(...result.edges);
      setGraphData({ nodes: newNodes, edges: newEdges });
    } catch {
      // ignore expand errors
    } finally {
      setExpandingAll(false);
    }
  }, [graphData, workflow.document_id, projectId, fetchApi]);

  // Load Excel presigned URL for Excel files
  const isExcel = isExcelFileType(workflow.file_type);
  const [excelUrl, setExcelUrl] = useState<string | null>(null);
  const [excelUrlLoading, setExcelUrlLoading] = useState(false);

  useEffect(() => {
    if (!isExcel || !workflow.file_uri) {
      setExcelUrl(null);
      return;
    }

    const s3Info = parseS3Uri(workflow.file_uri);
    if (!s3Info) {
      setExcelUrl(null);
      return;
    }

    let cancelled = false;
    setExcelUrlLoading(true);

    getPresignedDownloadUrl(s3Info.bucket, s3Info.key)
      .then((url) => {
        if (!cancelled) {
          setExcelUrl(url);
          setExcelUrlLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to get Excel presigned URL:', err);
        if (!cancelled) {
          setExcelUrl(null);
          setExcelUrlLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExcel, workflow.file_uri, getPresignedDownloadUrl]);

  // On-demand segment loading
  const [segmentCache, setSegmentCache] = useState<Map<number, SegmentData>>(
    () => new Map(),
  );
  const [segmentLoading, setSegmentLoading] = useState(false);
  const prefetchingRef = useRef<Set<number>>(new Set());
  // Use ref to check cache without triggering re-renders
  const segmentCacheRef = useRef(segmentCache);
  segmentCacheRef.current = segmentCache;

  const currentSegment = segmentCache.get(currentSegmentIndex) ?? null;

  const fetchSegment = useCallback(
    async (index: number) => {
      // Use ref to check cache to avoid dependency on segmentCache
      if (!onLoadSegment || segmentCacheRef.current.has(index)) return;
      if (prefetchingRef.current.has(index)) return;
      prefetchingRef.current.add(index);
      try {
        const data = await onLoadSegment(index);
        setSegmentCache((prev) => {
          const next = new Map(prev);
          next.set(index, data);
          return next;
        });
      } catch (e) {
        console.error(`Failed to load segment ${index}:`, e);
      } finally {
        prefetchingRef.current.delete(index);
      }
    },
    [onLoadSegment],
  );

  // Reset image zoom and base size on segment change
  useEffect(() => {
    setImageZoom(1);
    setImageNaturalWidth(0);
  }, [currentSegmentIndex]);

  // Ctrl/Cmd + wheel zoom for image (ref callback to handle conditional rendering)
  const wheelListenerRef = useRef<(() => void) | null>(null);
  const imageContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (wheelListenerRef.current) {
      wheelListenerRef.current();
      wheelListenerRef.current = null;
    }
    if (!node) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setImageZoom((prev) => {
        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        return Math.min(3, Math.max(0.5, prev + delta));
      });
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    wheelListenerRef.current = () =>
      node.removeEventListener('wheel', handleWheel);
  }, []);

  // Fetch current segment on index change
  useEffect(() => {
    if (!onLoadSegment) return;
    // Use ref to check cache to avoid infinite loop
    if (segmentCacheRef.current.has(currentSegmentIndex)) {
      // Prefetch adjacent
      if (currentSegmentIndex > 0) fetchSegment(currentSegmentIndex - 1);
      if (currentSegmentIndex < workflow.total_segments - 1)
        fetchSegment(currentSegmentIndex + 1);
      return;
    }

    if (prefetchingRef.current.has(currentSegmentIndex)) return;
    prefetchingRef.current.add(currentSegmentIndex);

    setSegmentLoading(true);
    onLoadSegment(currentSegmentIndex)
      .then((data) => {
        setSegmentCache((prev) => {
          const next = new Map(prev);
          next.set(currentSegmentIndex, data);
          return next;
        });
        setSegmentLoading(false);
        // Prefetch adjacent
        if (currentSegmentIndex > 0) fetchSegment(currentSegmentIndex - 1);
        if (currentSegmentIndex < workflow.total_segments - 1)
          fetchSegment(currentSegmentIndex + 1);
      })
      .catch((e) => {
        console.error(`Failed to load segment ${currentSegmentIndex}:`, e);
        setSegmentLoading(false);
      })
      .finally(() => {
        prefetchingRef.current.delete(currentSegmentIndex);
      });
  }, [
    currentSegmentIndex,
    onLoadSegment,
    fetchSegment,
    workflow.total_segments,
  ]);

  // Helper to update a segment in the cache
  const updateCachedSegment = useCallback(
    (index: number, updater: (seg: SegmentData) => SegmentData) => {
      setSegmentCache((prev) => {
        const seg = prev.get(index);
        if (!seg) return prev;
        const next = new Map(prev);
        next.set(index, updater(seg));
        return next;
      });
    },
    [],
  );

  const handleRegenerateQa = async () => {
    if (!regenerateTarget || !onRegenerateQa) return;
    const { qaIndex, question, userInstructions } = regenerateTarget;
    setRegeneratingIndex(qaIndex);
    setRegenerateTarget(null);
    try {
      const result = await onRegenerateQa(
        currentSegmentIndex,
        qaIndex,
        question,
        userInstructions,
      );
      setAnalysisPopup((prev) => {
        const newItems = [...prev.qaItems];
        newItems[qaIndex] = {
          question: result.analysis_query,
          answer: result.content,
        };
        return { ...prev, qaItems: newItems };
      });
      updateCachedSegment(currentSegmentIndex, (seg) => {
        const analysis = [...seg.ai_analysis];
        analysis[qaIndex] = {
          analysis_query: result.analysis_query,
          content: result.content,
        };
        return { ...seg, ai_analysis: analysis };
      });
    } finally {
      setRegeneratingIndex(null);
    }
  };

  const handleAddQa = async () => {
    if (!addQaTarget || !onAddQa) return;
    const { question, userInstructions } = addQaTarget;
    setAddingQa(true);
    setAddQaTarget(null);
    try {
      const result = await onAddQa(
        currentSegmentIndex,
        question,
        userInstructions,
      );
      setAnalysisPopup((prev) => ({
        ...prev,
        qaItems: [
          ...prev.qaItems,
          { question: result.analysis_query, answer: result.content },
        ],
      }));
      updateCachedSegment(currentSegmentIndex, (seg) => ({
        ...seg,
        ai_analysis: [
          ...seg.ai_analysis,
          { analysis_query: result.analysis_query, content: result.content },
        ],
      }));
    } finally {
      setAddingQa(false);
    }
  };

  const handleDeleteQa = async () => {
    if (!onDeleteQa || deleteConfirmIndex === null) return;
    const qaIndex = deleteConfirmIndex;
    setDeleteConfirmIndex(null);
    setDeletingIndex(qaIndex);
    try {
      await onDeleteQa(currentSegmentIndex, qaIndex);
      setAnalysisPopup((prev) => ({
        ...prev,
        qaItems: prev.qaItems.filter((_, idx) => idx !== qaIndex),
      }));
      updateCachedSegment(currentSegmentIndex, (seg) => ({
        ...seg,
        ai_analysis: seg.ai_analysis.filter((_, idx) => idx !== qaIndex),
      }));
    } finally {
      setDeletingIndex(null);
    }
  };

  const seekVideo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const isProcessing =
    workflow.status !== 'completed' && workflow.status !== 'failed';

  const canReanalyze =
    onReanalyze &&
    (workflow.status === 'completed' || workflow.status === 'failed');

  const handleReanalyze = async () => {
    if (!onReanalyze) return;
    await onReanalyze(reanalyzeInstructions, reanalyzeLanguage);
    setShowReanalyzeModal(false);
    setReanalyzeInstructions('');
  };

  const { handleBackdropClick } = useModal({ isOpen: !!workflow, onClose });

  // Update analysisPopup content when segment changes
  // Skip when currentSegment is null (still loading) to avoid flashing empty state
  useEffect(() => {
    if (!currentSegment) return;

    setAnalysisPopup((prev) => {
      if (!prev.type) return prev;

      if (prev.type === 'ai') {
        const qaItems =
          currentSegment.ai_analysis?.map((a) => ({
            question: a.analysis_query,
            answer: a.content,
          })) || [];
        // Scroll to pending QA item after DOM renders
        if (pendingQaScrollRef.current != null && qaItems.length > 0) {
          const idx = pendingQaScrollRef.current;
          pendingQaScrollRef.current = null;
          setTimeout(() => {
            document
              .getElementById(`qa-item-${idx}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 200);
        }
        return {
          ...prev,
          title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
          qaItems,
        };
      } else if (prev.type === 'web') {
        return {
          ...prev,
          content: currentSegment.webcrawler_content || '',
          title: `Web Crawler - Segment ${currentSegmentIndex + 1}`,
        };
      } else {
        // Determine which content type is being viewed from the title
        const contentType = prev.title.split(' ')[0]; // 'BDA' or 'Parser'
        const contentMap: Record<string, string> = {
          BDA: currentSegment.bda_indexer || '',
          Parser: currentSegment.format_parser || '',
        };
        return {
          ...prev,
          content: contentMap[contentType] || '',
          title: `${contentType} Content - Segment ${currentSegmentIndex + 1}`,
        };
      }
    });
  }, [currentSegmentIndex, currentSegment]);

  return (
    <div
      className="fixed inset-0 bg-black/55 dark:bg-black/65 backdrop-blur-md flex items-center justify-center z-50 p-6"
      onClick={handleBackdropClick}
    >
      <div
        className="document-detail-modal rounded-2xl w-full max-w-7xl h-[90vh] flex overflow-hidden relative"
        style={
          {
            '--modal-glow-color':
              CARD_COLORS[projectColor]?.border || '#6366f1',
          } as React.CSSProperties
        }
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 bg-transparent dark:bg-[#0d1117] hover:bg-black/[0.06] dark:hover:bg-[#1e2235] rounded-lg transition-colors border border-black/10 dark:border-[#3b4264]"
        >
          <svg
            className="h-5 w-5 text-slate-600 dark:text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Left Panel - Document Details */}
        <div
          className={`flex flex-col flex-shrink-0 border-r border-black/[0.08] dark:border-[#2a2f45] bg-transparent dark:bg-[#0d1117]/50 transition-all duration-300 ${
            viewMode === 'graph'
              ? 'w-[280px]'
              : analysisPopup.type
                ? 'w-[600px]'
                : 'w-[400px]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-black/[0.08] dark:border-[#2a2f45] bg-transparent">
            <div className="p-2 rounded-lg bg-black/[0.06] dark:bg-[#1e2235] flex-shrink-0">
              <svg
                className="h-5 w-5 text-slate-600 dark:text-slate-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 truncate">
              {t('workflow.documentDetails')}
            </h2>
            <div className="flex-1" />
            <div className="flex items-center gap-0.5 p-0.5 rounded bg-slate-200/60 dark:bg-white/[0.08]">
              <button
                onClick={() => setViewMode('document')}
                title={t('workflow.segment', 'Document')}
                className={`p-1 rounded transition-all ${
                  viewMode === 'document'
                    ? 'bg-white dark:bg-white/[0.15] text-slate-700 dark:text-slate-200 shadow-sm'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('graph')}
                title="Graph"
                className={`p-1 rounded transition-all ${
                  viewMode === 'graph'
                    ? 'bg-white dark:bg-white/[0.15] text-slate-700 dark:text-slate-200 shadow-sm'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Content */}
          {viewMode === 'graph' ? (
            <div className="flex-1 overflow-y-auto">
              {/* Graph sub-mode toggle */}
              <div className="px-4 py-3 border-b border-black/[0.08] dark:border-[#363b50]">
                <div className="flex items-center gap-0.5 p-0.5 rounded bg-slate-200/60 dark:bg-white/[0.08]">
                  <button
                    onClick={() => setGraphSubMode('force')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[12px] font-medium transition-all ${
                      graphSubMode === 'force'
                        ? 'bg-white dark:bg-white/[0.15] text-slate-700 dark:text-slate-200 shadow-sm'
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Network className="w-3.5 h-3.5" />
                    Graph
                  </button>
                  <button
                    onClick={() => setGraphSubMode('tagcloud')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[12px] font-medium transition-all ${
                      graphSubMode === 'tagcloud'
                        ? 'bg-white dark:bg-white/[0.15] text-slate-700 dark:text-slate-200 shadow-sm'
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Tag Cloud
                  </button>
                </div>
              </div>
              {/* Filters section - differs by sub-mode */}
              <div className="border-b border-black/[0.08] dark:border-[#363b50]">
                <button
                  onClick={() =>
                    setGraphPanelSections((s) => ({
                      ...s,
                      filters: !s.filters,
                    }))
                  }
                  className="flex items-center justify-between w-full px-4 py-2.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                >
                  {t('workflow.graph.filters')}
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform ${graphPanelSections.filters ? '' : '-rotate-90'}`}
                  />
                </button>
                {graphPanelSections.filters &&
                  (graphSubMode === 'tagcloud' ? (
                    <div className="px-4 pb-4 space-y-3">
                      {/* Min connections */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12px] text-slate-500 dark:text-slate-400">
                            Min connections
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                            {tagCloudMinConn}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={20}
                          value={tagCloudMinConn}
                          onChange={(e) =>
                            setTagCloudMinConn(Number(e.target.value))
                          }
                          className="w-full h-1 appearance-none bg-slate-200 dark:bg-[#363b50] rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                        />
                      </div>
                      {/* Max tags */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12px] text-slate-500 dark:text-slate-400">
                            Max tags
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                            {tagCloudMaxTags}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={200}
                          step={10}
                          value={tagCloudMaxTags}
                          onChange={(e) =>
                            setTagCloudMaxTags(Number(e.target.value))
                          }
                          className="w-full h-1 appearance-none bg-slate-200 dark:bg-[#363b50] rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                        />
                      </div>
                      {/* Rotation toggle */}
                      <ToggleRow
                        label="Rotation"
                        checked={tagCloudRotation}
                        onChange={setTagCloudRotation}
                      />
                    </div>
                  ) : (
                    <div className="px-4 pb-4 space-y-3">
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                        <input
                          type="text"
                          placeholder={t('workflow.graph.searchPlaceholder')}
                          value={graphSearchFilter}
                          onChange={(e) => setGraphSearchFilter(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-slate-100 dark:bg-[#1e2235] border border-slate-200 dark:border-[#363b50] rounded-md text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-blue-400 dark:focus:border-[#4a5070]"
                        />
                      </div>
                      {/* Depth */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12px] text-slate-500 dark:text-slate-400">
                            {t('workflow.graph.depth')}
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                            {graphDepth}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={6}
                          value={graphDepth}
                          onChange={(e) =>
                            setGraphDepth(Number(e.target.value))
                          }
                          className="w-full h-1 appearance-none bg-slate-200 dark:bg-[#363b50] rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                        />
                      </div>
                      {/* Focus page */}
                      {graphMaxPage > 0 && (
                        <div>
                          <span className="text-[12px] text-slate-500 dark:text-slate-400">
                            {t('workflow.graph.page')}
                          </span>
                          <div className="flex items-center gap-3 mt-1.5">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="graphPageMode"
                                checked={graphFocusPage == null}
                                onChange={() => setGraphFocusPage(null)}
                                className="w-3 h-3 accent-blue-500"
                              />
                              <span className="text-[12px] text-slate-600 dark:text-slate-300">
                                {t('workflow.graph.allPages')}
                              </span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="graphPageMode"
                                checked={graphFocusPage != null}
                                onChange={() => setGraphFocusPage(0)}
                                className="w-3 h-3 accent-blue-500"
                              />
                              <span className="text-[12px] text-slate-600 dark:text-slate-300">
                                {t('workflow.graph.page')}
                              </span>
                            </label>
                            {graphFocusPage != null && (
                              <input
                                type="number"
                                min={1}
                                max={graphMaxPage + 1}
                                value={graphFocusPage + 1}
                                onChange={(e) => {
                                  const v = Math.max(
                                    0,
                                    Math.min(
                                      Number(e.target.value) - 1,
                                      graphMaxPage,
                                    ),
                                  );
                                  setGraphFocusPage(v);
                                }}
                                className="w-16 px-2 py-1 text-[12px] text-center bg-slate-100 dark:bg-[#1e2235] border border-slate-200 dark:border-[#363b50] rounded-md text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-400 dark:focus:border-[#4a5070]"
                              />
                            )}
                          </div>
                        </div>
                      )}
                      {/* Toggle rows */}
                      <ToggleRow
                        label={t('workflow.graph.incomingLinks')}
                        checked={graphShowIncoming}
                        onChange={setGraphShowIncoming}
                      />
                      <ToggleRow
                        label={t('workflow.graph.outgoingLinks')}
                        checked={graphShowOutgoing}
                        onChange={setGraphShowOutgoing}
                      />
                    </div>
                  ))}
              </div>

              {/* Display section - link type toggles (force graph only) */}
              {graphSubMode !== 'tagcloud' && (
                <div className="border-b border-black/[0.08] dark:border-[#363b50]">
                  <button
                    onClick={() =>
                      setGraphPanelSections((s) => ({
                        ...s,
                        display: !s.display,
                      }))
                    }
                    className="flex items-center justify-between w-full px-4 py-2.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    {t('workflow.graph.display')}
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform ${graphPanelSections.display ? '' : '-rotate-90'}`}
                    />
                  </button>
                  {graphPanelSections.display && (
                    <div className="px-4 pb-3 space-y-1">
                      <ToggleRow
                        label={t('workflow.graph.edgeLabels')}
                        checked={graphShowEdgeLabels}
                        onChange={setGraphShowEdgeLabels}
                      />
                      {graphLinkTypes.length > 0 && (
                        <div className="pt-2 border-t border-black/[0.06] dark:border-[#363b50] mt-2 space-y-1">
                          {graphLinkTypes.map((type) => {
                            const color = LINK_TYPE_COLORS[type] ?? '#6b7280';
                            const active = !graphHiddenLinkTypes.has(type);
                            return (
                              <div
                                key={type}
                                className="flex items-center justify-between py-1"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-2.5 h-0.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-[12px] text-slate-600 dark:text-slate-300">
                                    {type}
                                  </span>
                                </div>
                                <ToggleSwitch
                                  checked={active}
                                  onChange={() => toggleGraphLinkType(type)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              {loadingWorkflow ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-slate-500">{t('common.loading')}</div>
                </div>
              ) : analysisPopup.type ? (
                /* Analysis Content View */
                <div className="flex flex-col h-full">
                  {/* Navigation */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() =>
                        setAnalysisPopup({
                          type: null,
                          content: '',
                          title: '',
                          qaItems: [],
                        })
                      }
                      className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors"
                      title={t('workflow.backToDetails')}
                    >
                      <svg
                        className="h-4 w-4 text-slate-600 dark:text-slate-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                    <div className="flex gap-1 flex-1 items-center">
                      {['Web', 'BDA', 'OCR', 'Parser', 'STT', 'AI']
                        .filter((type) => {
                          if (type === 'Web')
                            return !!currentSegment?.webcrawler_content;
                          if (type === 'BDA')
                            return !!currentSegment?.bda_indexer;
                          if (type === 'OCR')
                            return !!currentSegment?.paddleocr_blocks?.blocks
                              ?.length;
                          if (type === 'Parser')
                            return !!currentSegment?.format_parser;
                          if (type === 'STT')
                            return (
                              (currentSegment?.transcribe_segments?.length ??
                                0) > 0
                            );
                          if (type === 'AI')
                            return (
                              (currentSegment?.ai_analysis?.length ?? 0) > 0
                            );
                          return false;
                        })
                        .map((type) => (
                          <button
                            key={type}
                            onClick={() => {
                              if (type === 'AI') {
                                const qaItems =
                                  currentSegment?.ai_analysis?.map((a) => ({
                                    question: a.analysis_query,
                                    answer: a.content,
                                  })) || [];
                                setAnalysisPopup({
                                  type: 'ai',
                                  content: '',
                                  title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
                                  qaItems,
                                });
                              } else if (type === 'OCR') {
                                setAnalysisPopup({
                                  type: 'ocr',
                                  content: '',
                                  title: `OCR Content - Segment ${currentSegmentIndex + 1}${workflow?.ocr_model ? ` (${workflow.ocr_model}${(workflow.ocr_options as Record<string, string> | undefined)?.lang ? `, ${(workflow.ocr_options as Record<string, string>).lang}` : ''})` : ''}`,
                                  qaItems: [],
                                });
                              } else if (type === 'STT') {
                                setAnalysisPopup({
                                  type: 'stt',
                                  content: '',
                                  title: `Transcribe - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              } else if (type === 'Web') {
                                setAnalysisPopup({
                                  type: 'web',
                                  content:
                                    currentSegment?.webcrawler_content || '',
                                  title: `Web Crawler - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              } else {
                                const contentMap: Record<string, string> = {
                                  BDA: currentSegment?.bda_indexer || '',
                                  Parser: currentSegment?.format_parser || '',
                                };
                                setAnalysisPopup({
                                  type: 'bda',
                                  content: contentMap[type],
                                  title: `${type} Content - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              }
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              (type === 'AI' && analysisPopup.type === 'ai') ||
                              (type === 'OCR' &&
                                analysisPopup.type === 'ocr') ||
                              (type === 'STT' &&
                                analysisPopup.type === 'stt') ||
                              (type === 'Web' &&
                                analysisPopup.type === 'web') ||
                              (type !== 'AI' &&
                                type !== 'OCR' &&
                                type !== 'STT' &&
                                type !== 'Web' &&
                                analysisPopup.title.includes(type))
                                ? 'bg-blue-500 text-white'
                                : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/20'
                            }`}
                          >
                            {type}
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4">
                    {analysisPopup.title}
                  </h3>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                    {analysisPopup.type === 'ocr' &&
                    currentSegment?.paddleocr_blocks?.blocks?.length ? (
                      <OcrDocumentView
                        blocks={currentSegment?.paddleocr_blocks}
                        imageUrl={currentSegment?.image_url}
                      />
                    ) : analysisPopup.type === 'ai' && analysisPopup.qaItems ? (
                      analysisPopup.qaItems.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                          <svg
                            className="h-12 w-12 mb-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          <p className="text-sm font-medium">
                            {t('workflow.noAiAnalysis')}
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* Question Navigator */}
                          <div className="flex-shrink-0 flex flex-wrap gap-2 mb-4 pb-3 border-b border-slate-200 dark:border-white/[0.08]">
                            {(() => {
                              let qNum = 0;
                              return analysisPopup.qaItems.map((item, idx) => {
                                const isBase =
                                  idx === 0 &&
                                  (!item.question ||
                                    /Analysis$/i.test(item.question));
                                if (!isBase) qNum++;
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      document
                                        .getElementById(`qa-item-${idx}`)
                                        ?.scrollIntoView({
                                          behavior: 'smooth',
                                        });
                                    }}
                                    className={`w-8 h-8 text-white text-xs font-bold rounded-full flex items-center justify-center transition-colors ${
                                      isBase
                                        ? 'bg-emerald-500 hover:bg-emerald-600'
                                        : 'bg-violet-500 hover:bg-violet-600'
                                    }`}
                                  >
                                    {isBase ? 'A' : `E${qNum}`}
                                  </button>
                                );
                              });
                            })()}
                            {onAddQa && (
                              <button
                                onClick={() =>
                                  setAddQaTarget({
                                    question: '',
                                    userInstructions: '',
                                  })
                                }
                                disabled={
                                  addingQa || regeneratingIndex !== null
                                }
                                className="w-8 h-8 border-2 border-dashed border-slate-300 dark:border-white/20 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-400 hover:text-blue-500 text-xs font-bold rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title={t('workflow.addQa')}
                              >
                                {addingQa ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          {/* Q&A Cards */}
                          <div className="flex-1 overflow-y-auto space-y-4">
                            {(() => {
                              let qNum = 0;
                              const extras: {
                                item: { question: string; answer: string };
                                idx: number;
                                num: number;
                              }[] = [];
                              let baseItem: {
                                item: { question: string; answer: string };
                                idx: number;
                              } | null = null;
                              for (
                                let idx = 0;
                                idx < analysisPopup.qaItems.length;
                                idx++
                              ) {
                                const item = analysisPopup.qaItems[idx];
                                const isBase =
                                  idx === 0 &&
                                  (!item.question ||
                                    /Analysis$/i.test(item.question));
                                if (isBase) {
                                  baseItem = { item, idx };
                                } else {
                                  qNum++;
                                  extras.push({ item, idx, num: qNum });
                                }
                              }
                              return (
                                <>
                                  {/* Base Analysis */}
                                  {baseItem && (
                                    <div
                                      id={`qa-item-${baseItem.idx}`}
                                      className="rounded-lg border border-black/[0.08] dark:border-white/[0.08] overflow-hidden scroll-mt-2"
                                    >
                                      <div className="bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800/30 px-4 py-3">
                                        <div className="flex items-start gap-2">
                                          <span className="flex-shrink-0 w-6 h-6 bg-emerald-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                            A
                                          </span>
                                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1">
                                            {t('workflow.analysis', 'Analysis')}
                                          </p>
                                          {onRegenerateQa && (
                                            <button
                                              onClick={() =>
                                                setRegenerateTarget({
                                                  qaIndex: baseItem.idx,
                                                  question:
                                                    baseItem.item.question,
                                                  userInstructions: '',
                                                  isBase: true,
                                                })
                                              }
                                              disabled={
                                                regeneratingIndex !== null ||
                                                deletingIndex !== null
                                              }
                                              className="flex-shrink-0 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-30"
                                              title={t('workflow.regenerateQa')}
                                            >
                                              {regeneratingIndex ===
                                              baseItem.idx ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                              ) : (
                                                <Sparkles className="h-3.5 w-3.5" />
                                              )}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      <div className="px-4 py-3">
                                        {regeneratingIndex === baseItem.idx ? (
                                          <div className="flex items-center justify-center py-8 text-slate-400">
                                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                            <span className="text-sm">
                                              {t('workflow.regeneratingQa')}
                                            </span>
                                          </div>
                                        ) : (
                                          <div className={proseClass}>
                                            <Markdown
                                              remarkPlugins={remarkPlugins}
                                              components={markdownComponents}
                                              urlTransform={passUrl}
                                            >
                                              {baseItem.item.answer}
                                            </Markdown>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Extra Analyses */}
                                  {(extras.length > 0 || onAddQa) && (
                                    <div className="ml-4 border-l-2 border-violet-200 dark:border-violet-800/40 pl-3 space-y-3">
                                      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                        {t(
                                          'workflow.extraAnalysis',
                                          'Extra Analysis',
                                        )}
                                      </p>
                                      {extras.map(({ item, idx, num }) => (
                                        <div
                                          key={idx}
                                          id={`qa-item-${idx}`}
                                          className="bg-white/20 dark:bg-white/[0.02] rounded-md border border-black/[0.06] dark:border-white/[0.06] overflow-hidden scroll-mt-2"
                                        >
                                          <div className="bg-violet-50 dark:bg-violet-900/20 border-b border-violet-100 dark:border-violet-800/30 px-3 py-2">
                                            <div className="flex items-start gap-2">
                                              <span className="flex-shrink-0 w-5 h-5 bg-violet-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                                {num}
                                              </span>
                                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 flex-1">
                                                {item.question}
                                              </p>
                                              {onRegenerateQa && (
                                                <button
                                                  onClick={() =>
                                                    setRegenerateTarget({
                                                      qaIndex: idx,
                                                      question: item.question,
                                                      userInstructions: '',
                                                    })
                                                  }
                                                  disabled={
                                                    regeneratingIndex !==
                                                      null ||
                                                    deletingIndex !== null
                                                  }
                                                  className="flex-shrink-0 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-30"
                                                  title={t(
                                                    'workflow.regenerateQa',
                                                  )}
                                                >
                                                  {regeneratingIndex === idx ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                  ) : (
                                                    <Sparkles className="h-3 w-3" />
                                                  )}
                                                </button>
                                              )}
                                              {onDeleteQa && (
                                                <button
                                                  onClick={() =>
                                                    setDeleteConfirmIndex(idx)
                                                  }
                                                  disabled={
                                                    regeneratingIndex !==
                                                      null ||
                                                    deletingIndex !== null
                                                  }
                                                  className="flex-shrink-0 p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-30"
                                                  title={t('workflow.deleteQa')}
                                                >
                                                  {deletingIndex === idx ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                  ) : (
                                                    <Trash2 className="h-3 w-3" />
                                                  )}
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          <div className="px-3 py-2">
                                            {regeneratingIndex === idx ? (
                                              <div className="flex items-center justify-center py-6 text-slate-400">
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                <span className="text-xs">
                                                  {t('workflow.regeneratingQa')}
                                                </span>
                                              </div>
                                            ) : (
                                              <div
                                                className={`${proseClass} prose-xs`}
                                              >
                                                <Markdown
                                                  remarkPlugins={remarkPlugins}
                                                  components={
                                                    markdownComponents
                                                  }
                                                  urlTransform={passUrl}
                                                >
                                                  {item.answer}
                                                </Markdown>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                      {onAddQa && (
                                        <button
                                          onClick={() =>
                                            setAddQaTarget({
                                              question: '',
                                              userInstructions: '',
                                            })
                                          }
                                          disabled={
                                            addingQa ||
                                            regeneratingIndex !== null
                                          }
                                          className="w-full py-2 border-2 border-dashed border-slate-300/50 dark:border-white/10 hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/20 text-slate-400 hover:text-violet-500 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                          title={t('workflow.addQa')}
                                        >
                                          {addingQa ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <Plus className="h-3 w-3" />
                                          )}
                                          {t(
                                            'workflow.addExtraAnalysis',
                                            'Add',
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </>
                      )
                    ) : analysisPopup.type === 'stt' &&
                      currentSegment?.transcribe_segments?.length ? (
                      <div className="flex-1 overflow-y-auto space-y-2">
                        {currentSegment.transcribe_segments.map((seg, idx) => (
                          <button
                            key={idx}
                            onClick={() => seekVideo(seg.start_time)}
                            className="w-full text-left bg-white/30 dark:bg-white/[0.04] rounded-lg border border-black/[0.08] dark:border-white/[0.08] p-3 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-800/40 transition-colors cursor-pointer"
                          >
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 mb-1.5 bg-purple-50 dark:bg-purple-900/30 rounded">
                              <span className="text-xs font-mono text-purple-600 dark:text-purple-400">
                                {seg.start_time.toFixed(1)}s
                              </span>
                              <span className="text-xs text-purple-300 dark:text-purple-500">
                                ~
                              </span>
                              <span className="text-xs font-mono text-purple-400 dark:text-purple-500">
                                {seg.end_time.toFixed(1)}s
                              </span>
                            </div>
                            <p className="text-sm text-slate-800 dark:text-slate-200">
                              {seg.transcript}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : analysisPopup.type === 'web' &&
                      analysisPopup.content ? (
                      <div className="flex-1 overflow-y-auto">
                        {(currentSegment?.source_url ||
                          currentSegment?.page_title) && (
                          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-lg">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate flex-1">
                                {currentSegment?.page_title ||
                                  currentSegment?.source_url}
                              </p>
                              {currentSegment?.source_url && (
                                <a
                                  href={currentSegment.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                  title={currentSegment.source_url}
                                >
                                  <Link className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="prose prose-slate dark:prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-hr:my-3 prose-hr:border-slate-300 dark:prose-hr:border-white/[0.12] prose-table:border-collapse prose-th:border prose-th:border-slate-300 dark:prose-th:border-white/[0.12] prose-th:bg-slate-100 dark:prose-th:bg-white/[0.06] prose-th:p-2 prose-td:border prose-td:border-slate-300 dark:prose-td:border-white/[0.12] prose-td:p-2">
                          <Markdown
                            remarkPlugins={remarkPlugins}
                            components={markdownComponents}
                            urlTransform={passUrl}
                          >
                            {analysisPopup.content}
                          </Markdown>
                        </div>
                      </div>
                    ) : isSpreadsheetFileType(workflow.file_type) &&
                      analysisPopup.title.includes('Parser') ? (
                      <div className="flex-1 overflow-auto">
                        <div className="overflow-x-auto">
                          <div className="prose prose-slate dark:prose-invert prose-sm max-w-none prose-table:border-collapse prose-table:w-max prose-th:border prose-th:border-slate-300 dark:prose-th:border-white/[0.12] prose-th:bg-slate-100 dark:prose-th:bg-white/[0.06] prose-th:p-2 prose-th:whitespace-nowrap prose-td:border prose-td:border-slate-300 dark:prose-td:border-white/[0.12] prose-td:p-2 prose-td:whitespace-nowrap">
                            <Markdown
                              remarkPlugins={remarkPlugins}
                              components={markdownComponents}
                            >
                              {sanitizeMarkdownTable(analysisPopup.content)}
                            </Markdown>
                          </div>
                        </div>
                      </div>
                    ) : !analysisPopup.content ? (
                      isProcessing ? (
                        <DocumentScanner
                          fileType={workflow.file_type}
                          label={t('workflow.processingInProgress')}
                        />
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                          <svg
                            className="h-12 w-12 mb-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <p className="text-sm font-medium">
                            {t('workflow.noContent')}
                          </p>
                        </div>
                      )
                    ) : (
                      <div className="prose prose-slate dark:prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-hr:my-3 prose-hr:border-slate-300 dark:prose-hr:border-white/[0.12] prose-table:border-collapse prose-th:border prose-th:border-slate-300 dark:prose-th:border-white/[0.12] prose-th:bg-slate-100 dark:prose-th:bg-white/[0.06] prose-th:p-2 prose-td:border prose-td:border-slate-300 dark:prose-td:border-white/[0.12] prose-td:p-2">
                        <Markdown
                          remarkPlugins={remarkPlugins}
                          components={markdownComponents}
                          urlTransform={passUrl}
                        >
                          {analysisPopup.content}
                        </Markdown>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Basic Information */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t('workflow.fileName')}
                        </p>
                        {canReanalyze && (
                          <button
                            onClick={() => setShowReanalyzeModal(true)}
                            disabled={reanalyzing}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {reanalyzing ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            {t('workflow.reanalyze')}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <p
                          className="text-sm text-slate-800 dark:text-slate-200 truncate"
                          title={workflow.file_name}
                        >
                          {workflow.file_name}
                        </p>
                        {workflow.file_uri && (
                          <button
                            onClick={handleDownloadFile}
                            className="flex-shrink-0 p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            title={t('common.download', 'Download')}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          {t('workflow.fileType')}
                        </p>
                        <span className="inline-block px-2 py-1 bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 text-xs font-medium rounded">
                          {getFileTypeLabel(workflow.file_type)}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          {t('workflow.totalSegments')}
                        </p>
                        <p className="text-sm text-slate-800 dark:text-slate-200">
                          {workflow.total_segments}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('workflow.analysisLanguage')}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs rounded font-medium">
                          {LANGUAGES.find(
                            (l) => l.code === (workflow.language || 'en'),
                          )?.flag || 'EN'}
                        </span>
                        <span className="text-sm text-slate-800 dark:text-slate-200">
                          {LANGUAGES.find(
                            (l) => l.code === (workflow.language || 'en'),
                          )?.name || 'English'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('workflow.status')}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span className="text-sm text-slate-800 dark:text-slate-200">
                          {workflow.status}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('workflow.created')}
                      </p>
                      <p className="text-sm text-slate-800 dark:text-slate-200">
                        {new Date(workflow.created_at).toLocaleString('ko-KR')}
                      </p>
                    </div>

                    {workflow.file_type === 'application/x-webreq' &&
                      (workflow.source_url || workflow.crawl_instruction) && (
                        <div className="space-y-3">
                          {workflow.source_url && (
                            <div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                {t('workflow.sourceUrl', 'Source URL')}
                              </p>
                              <a
                                href={workflow.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline break-all"
                              >
                                <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                                {workflow.source_url}
                              </a>
                            </div>
                          )}
                          {workflow.crawl_instruction && (
                            <div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                {t(
                                  'workflow.crawlInstruction',
                                  'Crawl Instruction',
                                )}
                              </p>
                              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                                {workflow.crawl_instruction}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                    {workflow.file_type !== 'application/x-webreq' &&
                      workflow.document_prompt && (
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                              {t('workflow.documentPrompt', 'Document Prompt')}
                            </p>
                            <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                              {workflow.document_prompt}
                            </p>
                          </div>
                        </div>
                      )}

                    {/* Structured dataset: show the selected sheet's row/column
                        counts and its generated description (the meta above is
                        sparse for datasets — no segments/analysis). */}
                    {isDataset &&
                      (() => {
                        const ds =
                          datasets.find(
                            (d) => d.dataset_id === selectedDatasetId,
                          ) ?? datasets[0];
                        if (!ds) return null;
                        return (
                          <div className="space-y-3">
                            {(ds.row_count != null || ds.columns) && (
                              <div className="grid grid-cols-2 gap-4">
                                {ds.row_count != null && (
                                  <div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                      {t(
                                        'dataset.totalRows',
                                        '{{count}} rows',
                                        {
                                          count: ds.row_count,
                                        },
                                      )}
                                    </p>
                                    <p className="text-sm text-slate-800 dark:text-slate-200">
                                      {ds.row_count.toLocaleString()}
                                    </p>
                                  </div>
                                )}
                                {ds.columns && (
                                  <div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                      {t('dataset.columns', 'Columns')}
                                    </p>
                                    <p className="text-sm text-slate-800 dark:text-slate-200">
                                      {ds.columns.length}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                            {ds.description && (
                              <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                  {t('dataset.description', 'Description')}
                                </p>
                                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                                  {ds.description}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                  </div>

                  <hr className="border-black/[0.08] dark:border-white/[0.08]" />

                  {/* Analysis Summary */}
                  {workflow.total_segments > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-4">
                        {t('workflow.segmentAiAnalysis', 'Segment AI Analysis')}
                      </h3>
                      <p className="text-xs text-slate-400 mb-3">
                        {t('workflow.clickToView')}
                      </p>
                      {segmentLoading && !currentSegment ? (
                        <div className="flex gap-2">
                          {['Web', 'BDA', 'OCR', 'Parser', 'STT', 'AI'].map(
                            (label) => (
                              <div
                                key={label}
                                className="flex-1 bg-white/30 dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] rounded-lg p-3 text-center animate-pulse"
                              >
                                <div className="h-3 w-8 bg-slate-200 dark:bg-white/10 rounded mx-auto mb-2" />
                                <div className="h-6 w-6 bg-slate-200 dark:bg-white/10 rounded mx-auto" />
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          {[
                            {
                              type: 'web',
                              label: 'Web',
                              content: currentSegment?.webcrawler_content,
                            },
                            {
                              type: 'bda',
                              label: 'BDA',
                              content: currentSegment?.bda_indexer,
                            },
                            {
                              type: 'ocr',
                              label: 'OCR',
                              hasBlocks:
                                !!currentSegment?.paddleocr_blocks?.blocks
                                  ?.length,
                              content: currentSegment?.paddleocr_blocks?.blocks
                                ?.length
                                ? 'blocks'
                                : '',
                            },
                            {
                              type: 'bda',
                              label: 'Parser',
                              content: currentSegment?.format_parser,
                            },
                            {
                              type: 'stt',
                              label: 'STT',
                              content:
                                (currentSegment?.transcribe_segments?.length ??
                                  0) > 0
                                  ? 'stt'
                                  : '',
                              count:
                                currentSegment?.transcribe_segments?.length ??
                                0,
                            },
                            {
                              type: 'ai',
                              label: 'AI',
                              content:
                                (currentSegment?.ai_analysis?.length ?? 0) > 0
                                  ? 'ai'
                                  : '',
                              count: currentSegment?.ai_analysis?.length ?? 0,
                            },
                          ]
                            .filter(({ content }) => !!content)
                            .map(
                              ({ type, label, content, hasBlocks, count }) => (
                                <button
                                  key={label}
                                  onClick={() => {
                                    if (type === 'ai') {
                                      const qaItems =
                                        currentSegment?.ai_analysis?.map(
                                          (a) => ({
                                            question: a.analysis_query,
                                            answer: a.content,
                                          }),
                                        ) || [];
                                      setAnalysisPopup({
                                        type: 'ai',
                                        content: '',
                                        title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
                                        qaItems,
                                      });
                                    } else if (type === 'ocr') {
                                      setAnalysisPopup({
                                        type: 'ocr',
                                        content: hasBlocks
                                          ? ''
                                          : (content as string),
                                        title: `OCR Content - Segment ${currentSegmentIndex + 1}${workflow?.ocr_model ? ` (${workflow.ocr_model}${(workflow.ocr_options as Record<string, string> | undefined)?.lang ? `, ${(workflow.ocr_options as Record<string, string>).lang}` : ''})` : ''}`,
                                        qaItems: [],
                                      });
                                    } else if (type === 'stt') {
                                      setAnalysisPopup({
                                        type: 'stt',
                                        content: '',
                                        title: `Transcribe - Segment ${currentSegmentIndex + 1}`,
                                        qaItems: [],
                                      });
                                    } else if (type === 'web') {
                                      setAnalysisPopup({
                                        type: 'web',
                                        content:
                                          currentSegment?.webcrawler_content ||
                                          '',
                                        title: `Web Crawler - Segment ${currentSegmentIndex + 1}`,
                                        qaItems: [],
                                      });
                                    } else {
                                      setAnalysisPopup({
                                        type: type as 'bda',
                                        content: content as string,
                                        title: `${label} Content - Segment ${currentSegmentIndex + 1}`,
                                        qaItems: [],
                                      });
                                    }
                                  }}
                                  className="flex-1 bg-white/30 dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] rounded-lg p-3 text-center hover:bg-white/50 dark:hover:bg-white/[0.08] hover:border-black/[0.12] dark:hover:border-white/20 transition-colors"
                                >
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {label}
                                  </p>
                                  <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                    {type === 'ai' || type === 'stt'
                                      ? count
                                      : 1}
                                  </p>
                                </button>
                              ),
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Image Viewer / Graph */}
        <div className="flex-1 flex flex-col bg-transparent dark:bg-[#0d1117]/30 min-w-0">
          {/* View Mode Tabs + Navigation */}
          <div className="flex items-center justify-between min-h-[68px] p-4 pr-16 border-b border-black/[0.08] dark:border-[#2a2f45] bg-transparent">
            <div className="flex items-center gap-2">
              {isDataset && datasets.length > 0 && (
                <>
                  {(() => {
                    const idx = datasets.findIndex(
                      (d) => d.dataset_id === selectedDatasetId,
                    );
                    const go = (next: number) => {
                      if (next < 0 || next >= datasets.length) return;
                      setSelectedDatasetId(datasets[next].dataset_id);
                    };
                    return (
                      <>
                        <button
                          onClick={() => go(idx - 1)}
                          disabled={idx <= 0}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <svg
                            className="h-4 w-4 text-slate-600 dark:text-slate-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 19l-7-7 7-7"
                            />
                          </svg>
                        </button>
                        <select
                          value={selectedDatasetId ?? ''}
                          onChange={(e) => setSelectedDatasetId(e.target.value)}
                          className="bg-transparent dark:bg-white/[0.06] border border-black/10 dark:border-white/[0.12] text-slate-800 dark:text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[280px]"
                        >
                          {datasets.map((ds) => (
                            <option key={ds.dataset_id} value={ds.dataset_id}>
                              {ds.name}
                            </option>
                          ))}
                        </select>
                        {datasets.length > 1 && (
                          <span className="text-sm text-slate-500">
                            {idx + 1}/{datasets.length}
                          </span>
                        )}
                        <button
                          onClick={() => go(idx + 1)}
                          disabled={idx >= datasets.length - 1}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <svg
                            className="h-4 w-4 text-slate-600 dark:text-slate-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </button>
                      </>
                    );
                  })()}
                </>
              )}
              {viewMode === 'document' && !isDataset && (
                <>
                  <button
                    onClick={() => {
                      setImageLoading(true);
                      setCurrentSegmentIndex((prev) => Math.max(0, prev - 1));
                    }}
                    disabled={currentSegmentIndex === 0}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="h-4 w-4 text-slate-600 dark:text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>

                  <select
                    value={currentSegmentIndex}
                    onChange={(e) => {
                      setImageLoading(true);
                      setCurrentSegmentIndex(Number(e.target.value));
                    }}
                    className="bg-transparent dark:bg-white/[0.06] border border-black/10 dark:border-white/[0.12] text-slate-800 dark:text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from(
                      { length: workflow.total_segments },
                      (_, idx) => (
                        <option key={idx} value={idx}>
                          {`${t('workflow.segment')} ${idx + 1}`}
                        </option>
                      ),
                    )}
                  </select>

                  <span className="text-sm text-slate-500">
                    {currentSegmentIndex + 1}/{workflow.total_segments}
                  </span>

                  <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded-full border border-green-200 dark:border-green-800/40">
                    {workflow.status}
                  </span>

                  <button
                    onClick={() => {
                      setImageLoading(true);
                      setCurrentSegmentIndex((prev) =>
                        Math.min(workflow.total_segments - 1, prev + 1),
                      );
                    }}
                    disabled={
                      currentSegmentIndex >= workflow.total_segments - 1
                    }
                    className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="h-4 w-4 text-slate-600 dark:text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* Zoom Controls - image segments only */}
            {viewMode === 'document' && currentSegment?.image_url && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setImageZoom((prev) => Math.max(0.5, prev - 0.25))
                  }
                  disabled={imageZoom <= 0.5}
                  className="p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 min-w-[3rem] text-center">
                  {Math.round(imageZoom * 100)}%
                </span>
                <button
                  onClick={() =>
                    setImageZoom((prev) => Math.min(3, prev + 0.25))
                  }
                  disabled={imageZoom >= 3}
                  className="p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setImageZoom(1)}
                  disabled={imageZoom === 1}
                  className="p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Media Display / Graph View */}
          {viewMode === 'graph' ? (
            <div className="flex-1 min-w-0 flex flex-col">
              {graphSubMode !== 'tagcloud' && (
                <GraphControls
                  mode={graphMode}
                  onModeChange={setGraphMode}
                  totalSegments={
                    graphTotalSegments || workflow.total_segments || 0
                  }
                  pageRange={graphPageRange}
                  onPageRangeChange={setGraphPageRange}
                  specificPage={graphSpecificPage}
                  onSpecificPageChange={setGraphSpecificPage}
                  searchTerm={graphSearchTerm}
                  onSearchSubmit={setGraphSearchTerm}
                  onApply={fetchGraph}
                  loading={graphLoading}
                />
              )}
              <div className="flex-1 min-w-0 relative">
                {/* Rebuild graph (hidden feature) */}
                <button
                  onClick={handleGraphRebuild}
                  disabled={graphRebuilding}
                  title={t('workflow.graph.rebuild', 'Rebuild Graph from S3')}
                  className="absolute bottom-2 right-2 z-10 p-1 rounded text-slate-400/40 dark:text-slate-600/50 hover:text-slate-500 dark:hover:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/40 transition-all cursor-pointer disabled:opacity-50"
                >
                  {graphRebuilding ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <DatabaseZap className="w-3 h-3" />
                  )}
                </button>
                {graphLoading ? (
                  <GraphLoading />
                ) : graphData && graphData.nodes.length > 0 ? (
                  graphSubMode === 'tagcloud' ? (
                    <TagCloudView
                      tagCloudData={tagCloudData ?? undefined}
                      minConnections={tagCloudMinConn}
                      maxTags={tagCloudMaxTags}
                      rotation={tagCloudRotation}
                      onTagClick={(label) => {
                        setGraphMode('search');
                        setGraphSearchTerm(label);
                        setGraphSubMode('force');
                        fetchGraph();
                      }}
                    />
                  ) : (
                    <GraphView
                      data={graphData}
                      hiddenLinkTypes={graphHiddenLinkTypes}
                      searchFilter={graphSearchFilter}
                      depth={graphDepth}
                      focusPage={graphFocusPage}
                      showEdgeLabels={graphShowEdgeLabels}
                      onExpandAll={handleExpandAll}
                      expandingAll={expandingAll}
                      linkDirection={
                        graphShowOutgoing && graphShowIncoming
                          ? 'both'
                          : graphShowOutgoing
                            ? 'outgoing'
                            : graphShowIncoming
                              ? 'incoming'
                              : 'both'
                      }
                      onClusterClick={async (entityType) => {
                        if (!graphData || !workflow.document_id) return;
                        try {
                          const result = await fetchApi<GraphData>(
                            `projects/${projectId}/graph/documents/${workflow.document_id}/expand/${encodeURIComponent(entityType)}`,
                          );
                          const clusterId = `cluster_${entityType}`;
                          const existingIds = new Set(
                            graphData.nodes.map((n) => n.id),
                          );
                          const newNodes = graphData.nodes.filter(
                            (n) => n.id !== clusterId,
                          );
                          for (const node of result.nodes) {
                            if (!existingIds.has(node.id)) {
                              newNodes.push(node);
                            }
                          }
                          const newEdges = graphData.edges.filter(
                            (e) =>
                              e.source !== clusterId && e.target !== clusterId,
                          );
                          newEdges.push(...result.edges);
                          setGraphData({ nodes: newNodes, edges: newEdges });
                        } catch {
                          // ignore expand errors
                        }
                      }}
                      onNodeClick={(nodeId, nodeType) => {
                        if (nodeType === 'entity') {
                          const node = graphData.nodes.find(
                            (n) => n.id === nodeId,
                          );
                          if (node) {
                            setGraphMode('search');
                            setGraphSearchTerm(node.name);
                            setGraphSubMode('force');
                            fetchGraph();
                          }
                          return;
                        }
                        if (nodeType === 'segment' || nodeType === 'analysis') {
                          const node = graphData.nodes.find(
                            (n) => n.id === nodeId,
                          );
                          if (node?.properties?.segment_index != null) {
                            const segIdx = node.properties
                              .segment_index as number;
                            setCurrentSegmentIndex(segIdx);
                            if (nodeType === 'analysis') {
                              const qaIdx =
                                (node.properties?.qa_index as number) ?? 0;
                              const cached = segmentCache.get(segIdx);
                              const qaItems =
                                cached?.ai_analysis?.map((a) => ({
                                  question: a.analysis_query,
                                  answer: a.content,
                                })) || [];
                              setAnalysisPopup({
                                type: 'ai',
                                content: '',
                                title: `AI Analysis - Segment ${segIdx + 1}`,
                                qaItems,
                              });
                              if (qaItems.length > 0) {
                                setTimeout(() => {
                                  document
                                    .getElementById(`qa-item-${qaIdx}`)
                                    ?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start',
                                    });
                                }, 300);
                              } else {
                                pendingQaScrollRef.current = qaIdx;
                              }
                            }
                            setViewMode('document');
                          }
                        }
                      }}
                    />
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500">
                    {t('workflow.graph.noData')}
                  </div>
                )}
              </div>
            </div>
          ) : isDataset ? (
            // Structured data (xlsx/csv/tsv): show the queryable dataset table
            // (schema + paginated rows + SQL) in the preview area. Datasets have
            // no analysis segments (total_segments = 0), so this branch takes
            // precedence over the segment-based views below.
            <div className="flex-1 min-w-0">
              <DatasetView
                projectId={projectId}
                datasets={datasets}
                selectedId={selectedDatasetId}
                loadingList={datasetsLoading}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative min-w-0">
              {workflow.total_segments === 0 ? (
                isProcessing ? (
                  <DocumentScanner
                    fileType={workflow.file_type}
                    label={t('workflow.processingInProgress')}
                  />
                ) : (
                  <div className="text-slate-500">
                    {t('workflow.noSegments')}
                  </div>
                )
              ) : segmentLoading && !currentSegment ? (
                <div className="flex flex-col items-center gap-3">
                  <svg
                    className="h-8 w-8 text-slate-400 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <p className="text-sm text-slate-500">
                    {t('workflow.loadingSegment', 'Loading segment...')}
                  </p>
                </div>
              ) : (
                (() => {
                  const isVideoSegment =
                    currentSegment?.segment_type === 'VIDEO' ||
                    currentSegment?.segment_type === 'CHAPTER';
                  const isTextSegment = currentSegment?.segment_type === 'TEXT';
                  const isWebSegment = currentSegment?.segment_type === 'WEB';
                  const isTextFile = isTextFileType(workflow.file_type);
                  const isMarkdownFile = isMarkdownFileType(workflow.file_type);
                  const isSpreadsheet = isSpreadsheetFileType(
                    workflow.file_type,
                  );

                  if (isVideoSegment && currentSegment?.video_url) {
                    return (
                      <div className="w-full h-full flex items-center justify-center">
                        <video
                          ref={videoRef}
                          key={currentSegment.video_url}
                          controls
                          className="max-w-full max-h-full rounded-lg shadow-lg"
                          preload="metadata"
                          src={currentSegment.video_url}
                        >
                          Your browser does not support video playback.
                        </video>
                      </div>
                    );
                  }

                  // Excel document preview
                  if (isExcel && excelUrl) {
                    return (
                      <ExcelViewer
                        url={excelUrl}
                        sheetIndex={currentSegmentIndex}
                        className="w-full h-full"
                      />
                    );
                  }

                  if (isExcel && excelUrlLoading) {
                    return (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
                        <p className="text-sm text-slate-500">
                          Loading Excel...
                        </p>
                      </div>
                    );
                  }

                  // Text-based document preview (DOCX, Markdown, TXT, CSV)
                  if (
                    isTextSegment ||
                    (isTextFile && !currentSegment?.image_url)
                  ) {
                    const textContent =
                      currentSegment?.text_content ||
                      currentSegment?.format_parser ||
                      '';
                    return (
                      <div className="w-full h-full overflow-auto bg-white/30 dark:bg-white/[0.04] rounded-lg shadow-lg p-6">
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-black/[0.08] dark:border-white/[0.08]">
                          <FileText className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {t('workflow.textPreview', 'Text Preview')} -{' '}
                            {t('workflow.chunk', 'Chunk')}{' '}
                            {currentSegmentIndex + 1}
                          </span>
                        </div>
                        {textContent ? (
                          isMarkdownFile || isSpreadsheet ? (
                            <div className="overflow-x-auto">
                              <div className="prose prose-slate dark:prose-invert prose-sm max-w-none prose-table:border-collapse prose-table:w-max prose-th:border prose-th:border-slate-300 dark:prose-th:border-white/[0.12] prose-th:bg-slate-100 dark:prose-th:bg-white/[0.06] prose-th:p-2 prose-th:whitespace-nowrap prose-td:border prose-td:border-slate-300 dark:prose-td:border-white/[0.12] prose-td:p-2 prose-td:whitespace-nowrap">
                                <Markdown
                                  remarkPlugins={remarkPlugins}
                                  components={markdownComponents}
                                >
                                  {isSpreadsheet
                                    ? sanitizeMarkdownTable(textContent)
                                    : textContent}
                                </Markdown>
                              </div>
                            </div>
                          ) : (
                            <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 font-mono leading-relaxed">
                              {textContent}
                            </pre>
                          )
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <FileText className="h-12 w-12 mb-3" />
                            <p className="text-sm">
                              {t(
                                'workflow.noTextContent',
                                'No text content available',
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Web segment preview
                  if (isWebSegment) {
                    const webContent = currentSegment?.webcrawler_content || '';
                    return (
                      <div className="w-full h-full overflow-auto bg-white/30 dark:bg-white/[0.04] rounded-lg shadow-lg p-6">
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-black/[0.08] dark:border-white/[0.08]">
                          <Globe className="h-5 w-5 text-blue-500 dark:text-blue-400" />
                          <span className="text-sm font-medium text-slate-600 dark:text-slate-300 truncate">
                            {currentSegment?.page_title ||
                              `${t('workflow.segment')} ${currentSegmentIndex + 1}`}
                          </span>
                          {currentSegment?.source_url && (
                            <a
                              href={currentSegment.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-shrink-0 p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                              title={currentSegment.source_url}
                            >
                              <Link className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                        {webContent ? (
                          <div className="prose prose-slate dark:prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-hr:my-3 prose-hr:border-slate-300 dark:prose-hr:border-white/[0.12] prose-table:border-collapse prose-th:border prose-th:border-slate-300 dark:prose-th:border-white/[0.12] prose-th:bg-slate-100 dark:prose-th:bg-white/[0.06] prose-th:p-2 prose-td:border prose-td:border-slate-300 dark:prose-td:border-white/[0.12] prose-td:p-2">
                            <Markdown
                              remarkPlugins={remarkPlugins}
                              components={markdownComponents}
                              urlTransform={passUrl}
                            >
                              {webContent}
                            </Markdown>
                          </div>
                        ) : isProcessing ? (
                          <DocumentScanner
                            fileType={workflow.file_type}
                            label={t('workflow.processingInProgress')}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Globe className="h-12 w-12 mb-3" />
                            <p className="text-sm">
                              {t(
                                'workflow.noWebContent',
                                'No web content available',
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (currentSegment?.image_url) {
                    return (
                      <div
                        ref={imageContainerRef}
                        className="w-full h-full relative flex flex-col"
                      >
                        {imageLoading && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-white/[0.04] z-20">
                            <div className="flex flex-col items-center gap-3">
                              <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
                              <p className="text-sm text-slate-500">
                                {t('workflow.loadingImage')}
                              </p>
                            </div>
                          </div>
                        )}

                        <div
                          ref={imageScrollRef}
                          className={`flex-1 overflow-auto ${imageZoom > 1 ? 'cursor-grab' : ''}`}
                        >
                          <div className="inline-flex min-w-full min-h-full items-center justify-center">
                            <img
                              src={currentSegment.image_url}
                              alt={`Segment ${currentSegmentIndex + 1}`}
                              className={`rounded-lg shadow-lg transition-opacity ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                              style={{
                                width:
                                  imageNaturalWidth > 0
                                    ? `${imageNaturalWidth * imageZoom}px`
                                    : undefined,
                                maxWidth: imageZoom <= 1 ? '100%' : 'none',
                                maxHeight: imageZoom <= 1 ? '100%' : 'none',
                                objectFit: 'contain',
                              }}
                              onLoad={(e) => {
                                setImageNaturalWidth(
                                  e.currentTarget.clientWidth,
                                );
                                setImageLoading(false);
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (isProcessing) {
                    return (
                      <DocumentScanner
                        fileType={workflow.file_type}
                        label={t('workflow.processingInProgress')}
                      />
                    );
                  }

                  return (
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                      <svg
                        className="h-16 w-16"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p>
                        {isVideoSegment
                          ? t('workflow.noVideoAvailable')
                          : t('workflow.noImageAvailable')}
                      </p>
                    </div>
                  );
                })()
              )}
            </div>
          )}
        </div>
      </div>

      {/* Regenerate Q&A Modal */}
      {regenerateTarget && (
        <div className="fixed inset-0 bg-black/55 dark:bg-black/65 backdrop-blur-md flex items-center justify-center z-[60]">
          <div className="workflow-sub-modal rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-xl border border-white/60 dark:border-white/[0.12] ring-1 ring-slate-900/5 dark:ring-white/5">
            <div className="p-6 border-b border-black/[0.08] dark:border-white/[0.08]">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {regenerateTarget.isBase
                  ? t('workflow.regenerateAnalysisTitle', 'Regenerate Analysis')
                  : t('workflow.regenerateQaTitle')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {regenerateTarget.isBase
                  ? t(
                      'workflow.regenerateAnalysisDescription',
                      'Re-run the base analysis for this segment.',
                    )
                  : t('workflow.regenerateQaDescription')}
              </p>
            </div>
            <div className="p-6 space-y-4">
              {!regenerateTarget.isBase && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {t('workflow.regenerateQaQuestion')}
                  </label>
                  <textarea
                    value={regenerateTarget.question}
                    onChange={(e) =>
                      setRegenerateTarget((prev) =>
                        prev ? { ...prev, question: e.target.value } : null,
                      )
                    }
                    className="w-full h-24 px-3 py-2 text-sm border border-black/10 dark:border-white/[0.12] rounded-lg bg-transparent dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('workflow.regenerateQaInstructions')}
                </label>
                <textarea
                  value={regenerateTarget.userInstructions}
                  onChange={(e) =>
                    setRegenerateTarget((prev) =>
                      prev
                        ? { ...prev, userInstructions: e.target.value }
                        : null,
                    )
                  }
                  placeholder={t(
                    'workflow.regenerateQaInstructionsPlaceholder',
                  )}
                  className="w-full h-24 px-3 py-2 text-sm border border-black/10 dark:border-white/[0.12] rounded-lg bg-transparent dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-transparent dark:bg-white/[0.03] border-t border-black/[0.08] dark:border-white/[0.08]">
              <button
                onClick={() => setRegenerateTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleRegenerateQa}
                disabled={
                  !regenerateTarget.isBase && !regenerateTarget.question.trim()
                }
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="h-4 w-4" />
                {t('workflow.regenerateQaStart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Q&A Confirm Modal */}
      <ConfirmModal
        isOpen={deleteConfirmIndex !== null}
        onClose={() => setDeleteConfirmIndex(null)}
        onConfirm={handleDeleteQa}
        title={t('workflow.deleteQaTitle')}
        message={t('workflow.deleteQaConfirm')}
        confirmText={t('common.delete')}
        variant="danger"
        loading={deletingIndex !== null}
      />

      {/* Add Q&A Modal */}
      {addQaTarget && (
        <div className="fixed inset-0 bg-black/55 dark:bg-black/65 backdrop-blur-md flex items-center justify-center z-[60]">
          <div className="workflow-sub-modal rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-xl border border-white/60 dark:border-white/[0.12] ring-1 ring-slate-900/5 dark:ring-white/5">
            <div className="p-6 border-b border-black/[0.08] dark:border-white/[0.08]">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {t('workflow.addQaTitle')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {t('workflow.addQaDescription')}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('workflow.addQaQuestion')}
                </label>
                <textarea
                  value={addQaTarget.question}
                  onChange={(e) =>
                    setAddQaTarget((prev) =>
                      prev ? { ...prev, question: e.target.value } : null,
                    )
                  }
                  placeholder={t('workflow.addQaQuestionPlaceholder', '')}
                  className="w-full h-24 px-3 py-2 text-sm border border-black/10 dark:border-white/[0.12] rounded-lg bg-transparent dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('workflow.addQaInstructions')}
                </label>
                <textarea
                  value={addQaTarget.userInstructions}
                  onChange={(e) =>
                    setAddQaTarget((prev) =>
                      prev
                        ? { ...prev, userInstructions: e.target.value }
                        : null,
                    )
                  }
                  placeholder={t('workflow.addQaInstructionsPlaceholder')}
                  className="w-full h-24 px-3 py-2 text-sm border border-black/10 dark:border-white/[0.12] rounded-lg bg-transparent dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-transparent dark:bg-white/[0.03] border-t border-black/[0.08] dark:border-white/[0.08]">
              <button
                onClick={() => setAddQaTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleAddQa}
                disabled={!addQaTarget.question.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
                {t('workflow.addQaStart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-analyze Modal */}
      {showReanalyzeModal && (
        <div className="fixed inset-0 bg-black/55 dark:bg-black/65 backdrop-blur-md flex items-center justify-center z-[60]">
          <div className="workflow-sub-modal rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-xl border border-white/60 dark:border-white/[0.12]">
            <div className="p-6 border-b border-black/[0.08] dark:border-white/[0.08]">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {t('workflow.reanalyzeTitle')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {t('workflow.reanalyzeDescription')}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('workflow.language', 'Language')}
                </label>
                <select
                  value={reanalyzeLanguage}
                  onChange={(e) => setReanalyzeLanguage(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-black/10 dark:border-white/[0.12] rounded-lg bg-transparent dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {t(`languages.${lang.code}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('workflow.reanalyzeInstructions')}
                </label>
                <textarea
                  value={reanalyzeInstructions}
                  onChange={(e) => setReanalyzeInstructions(e.target.value)}
                  placeholder={t('workflow.reanalyzeInstructionsPlaceholder')}
                  className="w-full h-40 px-3 py-2 text-sm border border-black/10 dark:border-white/[0.12] rounded-lg bg-transparent dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-transparent dark:bg-white/[0.03] border-t border-black/[0.08] dark:border-white/[0.08]">
              <button
                onClick={() => {
                  setShowReanalyzeModal(false);
                  setReanalyzeInstructions('');
                }}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleReanalyze}
                disabled={reanalyzing}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reanalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('workflow.reanalyzeStarting')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {t('workflow.reanalyzeStart')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
