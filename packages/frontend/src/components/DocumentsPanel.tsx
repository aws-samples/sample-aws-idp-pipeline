import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Document, Workflow, WorkflowProgress } from '../types/project';

interface DocumentsPanelProps {
  documents: Document[];
  workflows: Workflow[];
  workflowProgress: WorkflowProgress | null;
  uploading: boolean;
  showUploadArea: boolean;
  isDragging: boolean;
  isConnected: boolean;
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
    return (
      <svg
        className="h-5 w-5 text-red-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (fileType.includes('image')) {
    return (
      <svg
        className="h-5 w-5 text-green-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      className="h-5 w-5 text-slate-400"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
        clipRule="evenodd"
      />
    </svg>
  );
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
  isConnected,
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
    <div className="w-1/3 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Documents Header with Toolbar */}
      <div className="p-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleUploadArea}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              showUploadArea
                ? 'bg-blue-100 text-blue-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            {t('documents.addDocument')}
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
            title={t('documents.refresh')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
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
            <svg
              className="h-4 w-4 text-slate-500"
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
          <label
            className={`flex flex-col items-center justify-center p-8 cursor-pointer transition-colors ${
              isDragging ? 'bg-blue-100' : 'hover:bg-slate-100'
            } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <svg
              className={`h-12 w-12 mb-3 transition-colors ${
                isDragging ? 'text-blue-500' : 'text-slate-400'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
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
            <svg
              className="h-16 w-16 text-slate-200 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
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
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
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
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
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
                            <svg
                              className="h-4 w-4 text-green-500"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          ) : processingFailed ? (
                            <svg
                              className="h-4 w-4 text-red-500"
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
                          ) : (
                            <svg
                              className="h-4 w-4 text-blue-500 animate-spin"
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
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
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
                          {isConnected && isProcessing && (
                            <span className="ml-auto text-xs text-green-600 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                              {t('workflow.live')}
                            </span>
                          )}
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
