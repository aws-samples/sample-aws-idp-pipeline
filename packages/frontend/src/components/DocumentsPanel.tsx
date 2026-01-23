import { useRef } from 'react';
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
  Check,
  Loader2,
  FileX,
} from 'lucide-react';
import { Document, Workflow, WorkflowProgress } from '../types/project';

interface DocumentsPanelProps {
  documents: Document[];
  workflows: Workflow[];
  workflowProgress: WorkflowProgress | null;
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
    return <FileText className="h-5 w-5 text-blue-500" />;
  }
  if (fileType.includes('image')) {
    return <Image className="h-5 w-5 text-emerald-500" />;
  }
  if (fileType.includes('video')) {
    return <Film className="h-5 w-5 text-violet-500" />;
  }
  if (fileType.includes('audio')) {
    return <Music className="h-5 w-5 text-amber-500" />;
  }
  return <File className="h-5 w-5 text-slate-400" />;
};

const getStatusBadge = (status: string) => {
  const statusColors: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    processing: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
    uploading: 'bg-blue-100 text-blue-700',
  };
  return statusColors[status] || 'bg-slate-100 text-slate-700';
};

export default function DocumentsPanel({
  documents,
  workflows,
  workflowProgress,
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
              const isProcessing =
                workflowProgress &&
                workflowProgress.documentId === doc.document_id &&
                workflowProgress.status !== 'completed' &&
                workflowProgress.status !== 'failed';
              const processingComplete =
                workflowProgress &&
                workflowProgress.documentId === doc.document_id &&
                workflowProgress.status === 'completed';
              const processingFailed =
                workflowProgress &&
                workflowProgress.documentId === doc.document_id &&
                workflowProgress.status === 'failed';

              return (
                <div
                  key={doc.document_id}
                  className={`group bg-white border rounded-lg p-3 transition-all ${
                    isProcessing
                      ? 'border-blue-300 bg-blue-50/30'
                      : processingComplete
                        ? 'border-green-300 bg-green-50/30'
                        : processingFailed
                          ? 'border-red-300 bg-red-50/30'
                          : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Document Info Row */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex-shrink-0 p-2 rounded-lg ${
                        isProcessing
                          ? 'bg-blue-100'
                          : doc.file_type.includes('image')
                            ? 'bg-purple-100'
                            : 'bg-slate-100'
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
                          {doc.status}
                        </span>
                        <span className="text-xs text-slate-400">
                          {(doc.file_size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {!isProcessing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {workflow && (
                          <button
                            onClick={() =>
                              onViewWorkflow(
                                workflow.document_id,
                                workflow.workflow_id,
                              )
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-800/40 rounded-lg transition-colors"
                            title="View analysis"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {t('documents.view')}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteDocument(doc.document_id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete document"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Processing Progress */}
                  {(isProcessing || processingComplete || processingFailed) &&
                    workflowProgress && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-2 mb-1">
                          {processingComplete ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : processingFailed ? (
                            <X className="h-4 w-4 text-red-500" />
                          ) : (
                            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                          )}
                          <span
                            className={`text-xs font-medium ${
                              processingComplete
                                ? 'text-green-700'
                                : processingFailed
                                  ? 'text-red-700'
                                  : 'text-blue-700'
                            }`}
                          >
                            {workflowProgress.currentStep}
                          </span>
                        </div>
                        <p
                          className={`text-xs ${
                            processingComplete
                              ? 'text-green-600'
                              : processingFailed
                                ? 'text-red-600'
                                : 'text-blue-600'
                          }`}
                        >
                          {workflowProgress.error ||
                            workflowProgress.stepMessage}
                        </p>
                        {workflowProgress.segmentProgress && isProcessing && (
                          <div className="mt-2">
                            <div className="flex justify-between text-xs text-blue-600 mb-1">
                              <span>{t('workflow.segments')}</span>
                              <span>
                                {workflowProgress.segmentProgress.completed} /{' '}
                                {workflowProgress.segmentProgress.total}
                              </span>
                            </div>
                            <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{
                                  width: `${(workflowProgress.segmentProgress.completed / workflowProgress.segmentProgress.total) * 100}%`,
                                }}
                              />
                            </div>
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
  );
}
