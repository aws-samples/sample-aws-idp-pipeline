import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Image,
  Film,
  Music,
  File,
  Plus,
  RefreshCw,
  CloudUpload,
  X,
  Eye,
  Trash2,
  Loader2,
  FileX,
  Check,
  CircleAlert,
  ChevronDown,
} from 'lucide-react';
import {
  Document,
  Workflow,
  WorkflowProgress,
  StepStatus,
} from '../types/project';

interface DocumentsPanelProps {
  documents: Document[];
  workflows: Workflow[];
  workflowProgressMap: Record<string, WorkflowProgress>;
  uploading: boolean;
  showUploadArea: boolean;
  isDragging: boolean;
  onToggleUploadArea: () => void;
  onRefresh: () => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onCloseUploadArea: () => void;
  onViewWorkflow: (documentId: string, workflowId: string) => void;
  onDeleteDocument: (documentId: string) => void;
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
  return <File className="h-5 w-5 text-slate-400" />;
};

const getStatusBadge = (status: string) => {
  const statusColors: Record<string, string> = {
    completed:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    processing:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    in_progress:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    uploading:
      'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    uploaded:
      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    pending:
      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
  };
  return (
    statusColors[status] ||
    'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-400'
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
      {/* Collapsed: summary bar */}
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

      {/* Expanded: step details */}
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
                  {/* status icon */}
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

                  {/* label */}
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

                  {/* segment numeric progress */}
                  {hasNumericProgress && (
                    <span className="text-[10px] text-blue-500 flex-shrink-0 ml-auto">
                      {segmentProgress.completed}/{segmentProgress.total}
                    </span>
                  )}
                </div>

                {/* paddleocr scaling hint */}
                {isActive && key === 'paddleocr_processor' && (
                  <p className="pl-[18px] text-[10px] text-amber-600 dark:text-amber-400">
                    {t('workflow.steps.paddleocrHint')}
                  </p>
                )}

                {/* progress bar for segment analyzer */}
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

export default function DocumentsPanel({
  documents,
  workflows,
  workflowProgressMap,
  uploading,
  showUploadArea,
  isDragging,
  onToggleUploadArea,
  onRefresh,
  onFileUpload,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onCloseUploadArea,
  onViewWorkflow,
  onDeleteDocument,
}: DocumentsPanelProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Documents Header with Toolbar */}
      <div className="p-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleUploadArea}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              showUploadArea
                ? ''
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
            style={
              showUploadArea
                ? {
                    color: 'var(--color-accent)',
                    backgroundColor: 'var(--color-accent-light)',
                  }
                : { color: 'var(--color-text-secondary)' }
            }
          >
            <Plus className="h-4 w-4" />
            {t('documents.addDocument')}
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95 [&:active_svg]:animate-spin"
            style={{ color: 'var(--color-text-secondary)' }}
            title={t('documents.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
            {t('documents.refresh')}
          </button>
          <span className="ml-auto text-xs text-slate-500">
            {documents.length} {t('documents.files')}
          </span>
        </div>
      </div>

      {/* Collapsible Upload Area */}
      {showUploadArea && (
        <div
          className={`border-b border-slate-200 relative transition-colors ${
            isDragging ? 'bg-blue-50' : 'bg-slate-50'
          }`}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <button
            onClick={onCloseUploadArea}
            className="absolute top-3 right-3 p-1.5 hover:bg-slate-200 rounded-lg transition-colors z-10"
            title="Close"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
          <label
            className={`flex flex-col items-center justify-center p-8 cursor-pointer transition-colors ${
              isDragging ? 'bg-blue-100' : 'hover:bg-slate-100'
            } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <CloudUpload
              className={`h-12 w-12 mb-3 transition-colors ${
                isDragging ? 'text-blue-500' : 'text-slate-400'
              }`}
              strokeWidth={1.5}
            />
            <p
              className={`text-sm font-medium mb-1 transition-colors ${
                isDragging ? 'text-blue-700' : 'text-slate-700'
              }`}
            >
              {uploading
                ? t('documents.uploading')
                : isDragging
                  ? t('documents.dropHere')
                  : t('documents.dragDrop')}
            </p>
            <p className="text-xs text-slate-500 text-center leading-relaxed">
              {t('documents.supportedFormats')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.tiff,.mp4,.mov,.avi,.mp3,.wav,.flac"
              className="hidden"
              onChange={onFileUpload}
              disabled={uploading}
            />
          </label>
        </div>
      )}

      {/* Documents List */}
      <div className="flex-1 overflow-y-auto p-3">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <FileX
              className="h-16 w-16 text-slate-300 dark:text-slate-500 mb-4"
              strokeWidth={1}
            />
            <p className="text-sm font-medium text-slate-500 mb-1">
              {t('documents.noDocuments')}
            </p>
            <p className="text-xs text-slate-400">
              {t('documents.uploadFirst')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
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
                  className={`group bg-white border rounded-lg p-3 transition-all ${
                    isProcessing
                      ? 'border-blue-300 bg-blue-50/30'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Document Info Row */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex-shrink-0 p-2 rounded-lg doc-icon-bg ${
                        isProcessing ? 'processing' : ''
                      }`}
                    >
                      {getFileIcon(doc.file_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium text-slate-800 truncate"
                        title={doc.name}
                      >
                        {doc.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-medium ${getStatusBadge(doc.status)}`}
                        >
                          {t(`documents.${doc.status}`, doc.status)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {(doc.file_size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {workflow && (
                        <button
                          onClick={() =>
                            onViewWorkflow(
                              workflow.document_id,
                              workflow.workflow_id,
                            )
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-900 bg-blue-400 hover:bg-blue-100 hover:text-blue-700 hover:scale-105 hover:shadow-md dark:text-blue-300 dark:bg-blue-800 dark:hover:bg-blue-500 dark:hover:text-white rounded-lg transition-all"
                          title="View analysis"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {t('documents.view')}
                        </button>
                      )}
                      {!isProcessing && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteDocument(doc.document_id);
                          }}
                          className="p-1.5 text-red-900 bg-red-400 hover:bg-red-100 hover:text-red-600 hover:scale-105 hover:shadow-md dark:text-red-400 dark:bg-red-800 dark:hover:bg-red-500 dark:hover:text-white rounded-lg transition-all"
                          title="Delete document"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Processing Progress - step indicators */}
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
  );
}
