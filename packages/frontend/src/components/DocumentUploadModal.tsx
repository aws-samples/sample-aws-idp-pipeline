import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudUpload, X, FileText, Loader2 } from 'lucide-react';

interface DocumentUploadModalProps {
  isOpen: boolean;
  uploading: boolean;
  documentPrompt?: string;
  onClose: () => void;
  onUpload: (files: File[], useBda: boolean) => Promise<void>;
}

export default function DocumentUploadModal({
  isOpen,
  uploading,
  documentPrompt,
  onClose,
  onUpload,
}: DocumentUploadModalProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [useBda, setUseBda] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(droppedFiles)]);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (selectedFiles && selectedFiles.length > 0) {
        setFiles((prev) => [...prev, ...Array.from(selectedFiles)]);
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    await onUpload(files, useBda);
    setFiles([]);
    setUseBda(false);
  }, [files, useBda, onUpload]);

  const handleClose = useCallback(() => {
    if (!uploading) {
      setFiles([]);
      setUseBda(false);
      onClose();
    }
  }, [uploading, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg mx-4"
        style={{
          border: '1px solid rgba(59, 130, 246, 0.3)',
          boxShadow:
            '0 0 40px rgba(59, 130, 246, 0.08), 0 25px 50px -12px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {t('documents.uploadDocuments')}
          </h2>
          <button
            onClick={handleClose}
            disabled={uploading}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Drop Zone */}
          <div
            className={`relative border-2 border-dashed rounded-xl transition-colors ${
              isDragging
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <label
              htmlFor="file-upload-input"
              className="flex flex-col items-center justify-center p-8 cursor-pointer"
            >
              <CloudUpload
                className={`h-12 w-12 mb-3 ${
                  isDragging ? 'text-blue-500' : 'text-slate-400'
                }`}
                strokeWidth={1.5}
              />
              <p
                className={`text-sm font-medium mb-1 ${
                  isDragging
                    ? 'text-blue-700'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {isDragging
                  ? t('documents.dropHere', 'Drop files here')
                  : t(
                      'documents.dragDrop',
                      'Drag & drop files or click to browse',
                    )}
              </p>
              <p className="text-xs text-slate-500 text-center">
                {t(
                  'documents.supportedFormats',
                  'PDF, Images, Videos (max 500MB)',
                )}
              </p>
              <input
                id="file-upload-input"
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.tiff,.mp4,.mov,.avi,.mp3,.wav,.flac"
                className="hidden"
                onChange={handleFileSelect}
                disabled={uploading}
              />
            </label>
          </div>

          {/* Selected Files */}
          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('documents.selectedFiles', 'Selected Files')} ({files.length}
                )
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg"
                  >
                    <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="text-sm text-slate-600 dark:text-slate-300 truncate flex-1">
                      {file.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                      className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Document Prompt */}
          {documentPrompt && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                {t('analysis.title')}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 whitespace-pre-wrap">
                {documentPrompt}
              </p>
            </div>
          )}

          {/* BDA Option */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <input
              type="checkbox"
              id="use-bda"
              checked={useBda}
              onChange={(e) => setUseBda(e.target.checked)}
              disabled={uploading}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            <div>
              <label
                htmlFor="use-bda"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {t('documents.useBda')}
              </label>
              <p className="text-xs text-slate-500 mt-0.5">
                {t('documents.useBdaDescription')}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('documents.uploading', 'Uploading...')}
              </>
            ) : (
              <>
                <CloudUpload className="h-4 w-4" />
                {t('documents.upload', 'Upload')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
