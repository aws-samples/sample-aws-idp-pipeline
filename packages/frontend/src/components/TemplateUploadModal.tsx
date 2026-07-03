import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudUpload, X, FileText, Loader2 } from 'lucide-react';
import { useModal } from '../hooks/useModal';

export interface TemplateUploadData {
  name: string;
  description: string;
  file: File;
}

interface TemplateUploadModalProps {
  isOpen: boolean;
  uploading: boolean;
  onClose: () => void;
  onUpload: (data: TemplateUploadData) => Promise<void>;
}

export default function TemplateUploadModal({
  isOpen,
  uploading,
  onClose,
  onUpload,
}: TemplateUploadModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
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
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      setName((prev) => prev || dropped.name.replace(/\.[^/.]+$/, ''));
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) {
        setFile(selected);
        setName((prev) => prev || selected.name.replace(/\.[^/.]+$/, ''));
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [],
  );

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setFile(null);
    setIsDragging(false);
  }, []);

  const handleClose = useCallback(() => {
    if (!uploading) {
      resetForm();
      onClose();
    }
  }, [uploading, resetForm, onClose]);

  const handleUpload = useCallback(async () => {
    if (!file || !name.trim()) return;
    await onUpload({ name: name.trim(), description: description.trim(), file });
    resetForm();
  }, [file, name, description, onUpload, resetForm]);

  useModal({ isOpen, onClose: handleClose, disableClose: uploading });

  if (!isOpen) return null;

  const isSubmitDisabled = !file || !name.trim() || uploading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/55 dark:bg-black/65 backdrop-blur-md"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="upload-modal-container relative rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden border border-white/70 dark:border-indigo-500/20 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)] dark:shadow-[0_0_80px_rgba(99,102,241,0.08),0_25px_50px_-12px_rgba(0,0,0,0.5)]">
        {/* Gradient glow */}
        <div
          className="dark:hidden absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 80% 0%, rgba(99, 140, 241, 0.1) 0%, transparent 70%)',
          }}
        />
        <div
          className="hidden dark:block absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 80% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
          }}
        />

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/[0.06] dark:border-[#2a2f45] flex-shrink-0">
          <h2 className="text-lg font-semibold text-[#1e293b] dark:text-[#f8fafc]">
            {t('templates.uploadTemplate')}
          </h2>
          <button
            onClick={handleClose}
            disabled={uploading}
            className="p-1.5 hover:bg-white/40 dark:hover:bg-[#1e2235] rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-[#64748b]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Drop Zone */}
          {file ? (
            <div className="flex items-center gap-2 p-3 bg-transparent dark:bg-[#0d1117] border border-black/10 dark:border-[#3b4264] rounded-lg">
              <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
              <span className="text-sm text-[#475569] dark:text-[#cbd5e1] truncate flex-1">
                {file.name}
              </span>
              <span className="text-xs text-[#94a3b8]">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                onClick={() => setFile(null)}
                disabled={uploading}
                className="p-1 hover:bg-white/50 dark:hover:bg-[#1e2235] rounded transition-colors disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5 text-[#64748b]" />
              </button>
            </div>
          ) : (
            <div
              className={`relative border-2 border-dashed rounded-xl transition-colors ${
                isDragging
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                  : 'border-black/10 dark:border-[#3b4264] dark:bg-[#0d1117] hover:border-black/20 dark:hover:border-[#4f5680]'
              }`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <label
                htmlFor="template-upload-input"
                className="flex flex-col items-center justify-center p-8 cursor-pointer"
              >
                <CloudUpload
                  className={`h-12 w-12 mb-3 ${
                    isDragging ? 'text-blue-500' : 'text-[#94a3b8]'
                  }`}
                  strokeWidth={1.5}
                />
                <p
                  className={`text-sm font-medium mb-1 ${
                    isDragging
                      ? 'text-blue-700'
                      : 'text-[#334155] dark:text-[#cbd5e1]'
                  }`}
                >
                  {isDragging
                    ? t('documents.dropHere', 'Drop files here')
                    : t('documents.dragDrop', 'Drag & drop files or click to browse')}
                </p>
                <p className="text-xs text-[#64748b] text-center">
                  {t('templates.supportedFormats')}
                </p>
                <input
                  id="template-upload-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".pptx,.ppt"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
              </label>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="template-name"
              className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]"
            >
              {t('templates.templateName')}
            </label>
            <input
              id="template-name"
              data-modal-input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('templates.templateNamePlaceholder')}
              disabled={uploading}
              className="w-full px-3 py-2 text-sm border border-black/10 dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] placeholder-[#94a3b8] dark:placeholder-[#94a3b8]/50 placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="template-description"
              className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]"
            >
              {t('templates.templateDescription')}
            </label>
            <textarea
              id="template-description"
              data-modal-input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('templates.templateDescriptionPlaceholder')}
              rows={4}
              disabled={uploading}
              className="w-full px-3 py-2 text-sm border border-black/10 dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] placeholder-[#94a3b8] dark:placeholder-[#94a3b8]/50 placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-black/[0.06] dark:border-[#2a2f45] flex-shrink-0">
          <button
            onClick={handleClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-[#334155] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#0d1117] rounded-lg transition-colors disabled:opacity-50 border border-black/10 dark:border-[#3b4264]"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleUpload}
            disabled={isSubmitDisabled}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:shadow-[0_0_20px_rgba(99,102,241,0.15)]"
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
