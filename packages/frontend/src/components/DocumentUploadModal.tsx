import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudUpload, X, FileText, Loader2, Globe, FileUp } from 'lucide-react';

type UploadTab = 'file' | 'web';

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
  const [activeTab, setActiveTab] = useState<UploadTab>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [useBda, setUseBda] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Web tab state
  const [webUrl, setWebUrl] = useState('');
  const [webInstruction, setWebInstruction] = useState('');

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

  const createWebreqFile = useCallback((): File => {
    const webreqContent = JSON.stringify({
      url: webUrl,
      instruction: webInstruction,
      created_at: new Date().toISOString(),
    });

    // Generate filename from URL
    let filename = 'webpage';
    try {
      const url = new URL(webUrl);
      filename = url.hostname.replace(/\./g, '_');
    } catch {
      // Use default filename if URL parsing fails
    }

    const blob = new Blob([webreqContent], { type: 'application/x-webreq' });
    return new File([blob], `${filename}.webreq`, {
      type: 'application/x-webreq',
    });
  }, [webUrl, webInstruction]);

  const handleUpload = useCallback(async () => {
    if (activeTab === 'file') {
      if (files.length === 0) return;
      await onUpload(files, useBda);
      setFiles([]);
      setUseBda(false);
    } else {
      if (!webUrl) return;
      const webreqFile = createWebreqFile();
      await onUpload([webreqFile], false);
      setWebUrl('');
      setWebInstruction('');
    }
  }, [activeTab, files, useBda, webUrl, onUpload, createWebreqFile]);

  const handleClose = useCallback(() => {
    if (!uploading) {
      setFiles([]);
      setUseBda(false);
      setWebUrl('');
      setWebInstruction('');
      setActiveTab('file');
      onClose();
    }
  }, [uploading, onClose]);

  const isUploadDisabled =
    activeTab === 'file' ? files.length === 0 : !webUrl.trim();

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

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setActiveTab('file')}
            disabled={uploading}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'file'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            } disabled:opacity-50`}
          >
            <FileUp className="h-4 w-4" />
            {t('documents.tabFile', 'File')}
          </button>
          <button
            onClick={() => setActiveTab('web')}
            disabled={uploading}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'web'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            } disabled:opacity-50`}
          >
            <Globe className="h-4 w-4" />
            {t('documents.tabWeb', 'Web')}
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {activeTab === 'file' ? (
            <>
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
                    accept=".pdf,.doc,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.gif,.tiff,.mp4,.mov,.avi,.mp3,.wav,.flac"
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
                    {t('documents.selectedFiles', 'Selected Files')} (
                    {files.length})
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
            </>
          ) : (
            <>
              {/* Web URL Input */}
              <div className="space-y-2">
                <label
                  htmlFor="web-url"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  {t('documents.webUrl', 'URL')}
                </label>
                <input
                  id="web-url"
                  type="url"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder={t(
                    'documents.webUrlPlaceholder',
                    'https://example.com/page',
                  )}
                  disabled={uploading}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Web Instruction */}
              <div className="space-y-2">
                <label
                  htmlFor="web-instruction"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  {t('documents.webInstruction', 'Instructions (Optional)')}
                </label>
                <textarea
                  id="web-instruction"
                  value={webInstruction}
                  onChange={(e) => setWebInstruction(e.target.value)}
                  placeholder={t(
                    'documents.webInstructionPlaceholder',
                    'Enter instructions for content extraction...\n\nExample:\n- Focus on the main article content\n- Extract product specifications\n- Include pricing information',
                  )}
                  disabled={uploading}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none"
                />
                <p className="text-xs text-slate-500">
                  {t(
                    'documents.webInstructionHint',
                    'Instructions help AI extract relevant content from the web page.',
                  )}
                </p>
              </div>

              {/* Web Info */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {t(
                    'documents.webDescription',
                    'The page will be crawled and converted to a document for analysis. A screenshot and extracted content will be saved.',
                  )}
                </p>
              </div>
            </>
          )}
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
            disabled={isUploadDisabled || uploading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('documents.uploading', 'Uploading...')}
              </>
            ) : activeTab === 'file' ? (
              <>
                <CloudUpload className="h-4 w-4" />
                {t('documents.upload', 'Upload')}
              </>
            ) : (
              <>
                <Globe className="h-4 w-4" />
                {t('documents.crawl', 'Crawl')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
