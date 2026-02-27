import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CloudUpload,
  X,
  FileText,
  Loader2,
  Globe,
  FileUp,
  Settings,
  Layers,
  BrainCircuit,
  Link,
  MessageSquareText,
  Info,
  AlertTriangle,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import OcrSettingsForm, {
  type OcrSettings,
  OCR_MODELS,
} from './OcrSettingsForm';
import TranscribeSettingsForm, {
  type TranscribeSettings,
} from './TranscribeSettingsForm';
import { LANGUAGES } from './ProjectSettingsModal';
import { useModal } from '../hooks/useModal';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ISO 639-1 project language -> PaddleOCR language code
const PROJECT_LANG_TO_OCR_LANG: Record<string, string> = {
  ko: 'korean',
  ja: 'japan',
  zh: 'ch',
  'zh-tw': 'chinese_cht',
  en: 'en',
  fr: 'french',
  de: 'german',
  it: 'it',
  es: 'es',
  pt: 'pt',
  ru: 'ru',
  ar: 'ar',
  hi: 'hi',
  vi: 'vi',
  th: 'th',
  ms: 'ms',
  id: 'id',
  tr: 'tr',
  pl: 'pl',
  nl: 'nl',
  sv: 'sv',
  no: 'no',
  da: 'da',
  fi: 'fi',
};

type UploadTab = 'file' | 'web';

export interface DocumentProcessingOptions {
  use_bda: boolean;
  use_ocr?: boolean;
  use_transcribe?: boolean;
  ocr_model?: string;
  ocr_options?: Record<string, unknown>;
  transcribe_options?: {
    language_mode: 'auto' | 'direct' | 'multi';
    language_code?: string;
    language_options?: string[];
  };
  document_prompt?: string;
  language?: string;
  source_url?: string;
  crawl_instruction?: string;
}

interface DocumentUploadModalProps {
  isOpen: boolean;
  uploading: boolean;
  projectLanguage?: string;
  projectDocumentPrompt?: string;
  onClose: () => void;
  onUpload: (
    files: File[],
    options: DocumentProcessingOptions,
  ) => Promise<void>;
}

export default function DocumentUploadModal({
  isOpen,
  uploading,
  projectLanguage,
  projectDocumentPrompt,
  onClose,
  onUpload,
}: DocumentUploadModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<UploadTab>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [useBda, setUseBda] = useState(false);
  const [useOcr, setUseOcr] = useState(true);
  const [useTranscribe, setUseTranscribe] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showOcr, setShowOcr] = useState(false);
  const [showTranscribe, setShowTranscribe] = useState(false);
  const [language, setLanguage] = useState(projectLanguage || 'en');

  const [pdfPageCounts, setPdfPageCounts] = useState<Map<string, number>>(
    new Map(),
  );

  // Count pages for PDF files
  useEffect(() => {
    const pdfFiles = files.filter((f) => f.type === 'application/pdf');

    // Remove entries for files no longer in the list
    setPdfPageCounts((prev) => {
      const currentNames = new Set(pdfFiles.map((f) => f.name));
      const next = new Map(prev);
      let changed = false;
      for (const key of next.keys()) {
        if (!currentNames.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Count pages for new PDF files
    let cancelled = false;
    const countPages = async (file: File) => {
      try {
        const data = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        if (!cancelled) {
          setPdfPageCounts((prev) => {
            const next = new Map(prev);
            next.set(file.name, pdfDoc.numPages);
            return next;
          });
        }
        pdfDoc.destroy();
      } catch {
        // ignore
      }
    };
    for (const file of pdfFiles) {
      if (pdfPageCounts.has(file.name)) continue;
      countPages(file);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const maxPdfPages = useMemo(() => {
    if (pdfPageCounts.size === 0) return 0;
    return Math.max(...pdfPageCounts.values());
  }, [pdfPageCounts]);

  const hasOcrEligibleFiles = useMemo(
    () =>
      files.length === 0 ||
      files.some(
        (f) => f.type === 'application/pdf' || f.type.startsWith('image/'),
      ),
    [files],
  );
  const hasTranscribeEligibleFiles = useMemo(
    () =>
      files.length === 0 ||
      files.some(
        (f) => f.type.startsWith('video/') || f.type.startsWith('audio/'),
      ),
    [files],
  );

  // OCR settings - default to pp-ocrv5 with language derived from project
  const [ocrSettings, setOcrSettings] = useState<OcrSettings>(() => ({
    ocr_model: 'pp-ocrv5',
    ocr_lang: PROJECT_LANG_TO_OCR_LANG[projectLanguage || 'en'] || 'en',
    use_doc_orientation_classify: false,
    use_doc_unwarping: false,
    use_textline_orientation: false,
  }));

  // Transcribe settings
  const [transcribeSettings, setTranscribeSettings] =
    useState<TranscribeSettings>(() => ({
      transcribe_language_mode: 'auto',
      transcribe_language_code: 'ko-KR',
      transcribe_language_options: [],
    }));

  const showVlWarning =
    ocrSettings.ocr_model === 'paddleocr-vl' && useOcr && maxPdfPages >= 20;

  // Document prompt - initialized from project default
  const [documentPrompt, setDocumentPrompt] = useState(
    projectDocumentPrompt || '',
  );

  useEffect(() => {
    setDocumentPrompt(projectDocumentPrompt || '');
  }, [projectDocumentPrompt]);

  useEffect(() => {
    setLanguage(projectLanguage || 'en');
  }, [projectLanguage]);

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

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileArray = Array.from(e.target.files ?? []);
      if (fileArray.length > 0) {
        setFiles((prev) => [...prev, ...fileArray]);
      }
      // Reset input (must happen after files are copied from the live FileList)
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

    // Generate filename: hostname + path hint + timestamp
    let filename = 'webpage';
    try {
      const url = new URL(webUrl);
      const host = url.hostname.replace(/^www\./, '').replace(/\./g, '_');
      const pathHint = url.pathname
        .replace(/\.[^/]+$/, '')
        .split('/')
        .filter(Boolean)
        .slice(-2)
        .join('_');
      const ts = new Date()
        .toISOString()
        .slice(0, 16)
        .replace(/[-:]/g, '')
        .replace('T', '_');
      filename = [host, pathHint, ts].filter(Boolean).join('_');
    } catch {
      // Use default filename if URL parsing fails
    }

    const blob = new Blob([webreqContent], { type: 'application/x-webreq' });
    return new File([blob], `${filename}.webreq`, {
      type: 'application/x-webreq',
    });
  }, [webUrl, webInstruction]);

  const buildOptions = useCallback((): DocumentProcessingOptions => {
    const opts: DocumentProcessingOptions = {
      use_bda: useBda,
      use_ocr: useOcr,
      use_transcribe: useTranscribe,
    };

    if (useOcr) {
      const ocrOpts: Record<string, unknown> = {};
      if (ocrSettings.ocr_lang) ocrOpts.lang = ocrSettings.ocr_lang;
      if (ocrSettings.use_doc_orientation_classify)
        ocrOpts.use_doc_orientation_classify = true;
      if (ocrSettings.use_doc_unwarping) ocrOpts.use_doc_unwarping = true;
      if (ocrSettings.use_textline_orientation)
        ocrOpts.use_textline_orientation = true;

      opts.ocr_model = ocrSettings.ocr_model;
      if (Object.keys(ocrOpts).length > 0) opts.ocr_options = ocrOpts;
    }

    if (
      useTranscribe &&
      transcribeSettings.transcribe_language_mode !== 'auto'
    ) {
      const tOpts: DocumentProcessingOptions['transcribe_options'] = {
        language_mode: transcribeSettings.transcribe_language_mode,
      };
      if (transcribeSettings.transcribe_language_mode === 'direct') {
        tOpts.language_code = transcribeSettings.transcribe_language_code;
      } else if (transcribeSettings.transcribe_language_mode === 'multi') {
        if (transcribeSettings.transcribe_language_options.length > 0) {
          tOpts.language_options =
            transcribeSettings.transcribe_language_options;
        }
      }
      opts.transcribe_options = tOpts;
    }

    if (documentPrompt.trim()) opts.document_prompt = documentPrompt.trim();
    opts.language = language;

    return opts;
  }, [
    useBda,
    useOcr,
    useTranscribe,
    ocrSettings,
    transcribeSettings,
    documentPrompt,
    language,
  ]);

  const handleUpload = useCallback(async () => {
    if (activeTab === 'file') {
      if (files.length === 0) return;
      await onUpload(files, buildOptions());
      setFiles([]);
      setPdfPageCounts(new Map());
      setUseBda(false);
      setUseOcr(true);
      setUseTranscribe(true);
      setShowOcr(false);
      setShowTranscribe(false);
      setTranscribeSettings({
        transcribe_language_mode: 'auto',
        transcribe_language_code: 'ko-KR',
        transcribe_language_options: [],
      });
    } else {
      if (!webUrl) return;
      const webreqFile = createWebreqFile();
      await onUpload([webreqFile], {
        use_bda: false,
        language,
        source_url: webUrl,
        crawl_instruction: webInstruction || undefined,
      });
      setWebUrl('');
      setWebInstruction('');
    }
  }, [
    activeTab,
    files,
    webUrl,
    webInstruction,
    language,
    onUpload,
    createWebreqFile,
    buildOptions,
  ]);

  const handleClose = useCallback(() => {
    if (!uploading) {
      setFiles([]);
      setPdfPageCounts(new Map());
      setUseBda(false);
      setUseOcr(true);
      setUseTranscribe(true);
      setShowOcr(false);
      setShowTranscribe(false);
      setTranscribeSettings({
        transcribe_language_mode: 'auto',
        transcribe_language_code: 'ko-KR',
        transcribe_language_options: [],
      });
      setWebUrl('');
      setWebInstruction('');
      setActiveTab('file');
      const defaultLang =
        PROJECT_LANG_TO_OCR_LANG[projectLanguage || 'en'] || 'en';
      setOcrSettings({
        ocr_model: 'pp-ocrv5',
        ocr_lang: defaultLang,
        use_doc_orientation_classify: false,
        use_doc_unwarping: false,
        use_textline_orientation: false,
      });
      setDocumentPrompt(projectDocumentPrompt || '');
      setLanguage(projectLanguage || 'en');
      onClose();
    }
  }, [uploading, onClose, projectLanguage, projectDocumentPrompt]);

  useModal({ isOpen, onClose: handleClose, disableClose: uploading });

  const isUploadDisabled =
    activeTab === 'file' ? files.length === 0 : !webUrl.trim();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/55 dark:bg-black/65 backdrop-blur-md"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="upload-modal-container relative rounded-2xl w-full max-w-lg mx-4 min-h-[50vh] max-h-[90vh] flex flex-col overflow-hidden border border-white/70 dark:border-indigo-500/20 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)] dark:shadow-[0_0_80px_rgba(99,102,241,0.08),0_25px_50px_-12px_rgba(0,0,0,0.5)]">
        {/* Gradient glow (light) */}
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
            {t('documents.uploadDocuments')}
          </h2>
          <button
            onClick={handleClose}
            disabled={uploading}
            className="p-1.5 hover:bg-white/40 dark:hover:bg-[#1e2235] rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-[#64748b]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-black/[0.06] dark:border-[#2a2f45] flex-shrink-0">
          <button
            onClick={() => setActiveTab('file')}
            disabled={uploading}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'file'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[#64748b] hover:text-[#334155] dark:hover:text-[#cbd5e1]'
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
                : 'text-[#64748b] hover:text-[#334155] dark:hover:text-[#cbd5e1]'
            } disabled:opacity-50`}
          >
            <Globe className="h-4 w-4" />
            {t('documents.tabWeb', 'Web')}
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {activeTab === 'file' ? (
            <>
              {/* Drop Zone */}
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
                  htmlFor="file-upload-input"
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
                      : t(
                          'documents.dragDrop',
                          'Drag & drop files or click to browse',
                        )}
                  </p>
                  <p className="text-xs text-[#64748b] text-center">
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
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.gif,.tiff,.mp4,.mov,.avi,.mp3,.wav,.flac,.dxf"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading}
                  />
                </label>
              </div>

              {/* Selected Files */}
              {files.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[#334155] dark:text-[#cbd5e1]">
                    {t('documents.selectedFiles', 'Selected Files')} (
                    {files.length})
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {files.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className="flex items-center gap-2 p-2 bg-transparent dark:bg-[#0d1117] rounded-lg"
                      >
                        <FileText className="h-4 w-4 text-[#94a3b8] flex-shrink-0" />
                        <span className="text-sm text-[#475569] dark:text-[#cbd5e1] truncate flex-1">
                          {file.name}
                        </span>
                        <span className="text-xs text-[#94a3b8]">
                          {(file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button
                          onClick={() => removeFile(index)}
                          disabled={uploading}
                          className="p-1 hover:bg-white/50 dark:hover:bg-[#1e2235] rounded transition-colors disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5 text-[#64748b]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preprocessing */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-violet-500" />
                  <p className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]">
                    {t('documents.preprocessing', 'Preprocessing')}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {/* BDA */}
                  <label
                    className={`relative flex flex-col items-center gap-0.5 px-2 py-2 border rounded-lg cursor-pointer transition-colors ${
                      useBda
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-black/[0.06] dark:border-[#3b4264] hover:border-black/10 dark:hover:border-[#2a2f45] bg-transparent dark:bg-[#0d1117]'
                    } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={useBda}
                      onChange={(e) => setUseBda(e.target.checked)}
                      disabled={uploading}
                      className="sr-only"
                    />
                    <span className="absolute top-1 right-1 group/bda">
                      <Info className="h-3 w-3 text-[#94a3b8] dark:text-[#475569] cursor-help" />
                      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover/bda:block w-48 p-2 text-xs text-[#475569] dark:text-[#cbd5e1] bg-white dark:bg-[#1e2235] border border-black/10 dark:border-[#3b4264] rounded-lg shadow-lg z-10">
                        {t('documents.bdaTooltip')}
                      </span>
                    </span>
                    <span
                      className={`text-xs font-medium ${useBda ? 'text-blue-700 dark:text-blue-300' : 'text-[#475569] dark:text-[#94a3b8]'}`}
                    >
                      {t('documents.bdaAnalysis', 'BDA')}
                    </span>
                    <span className="text-[10px] text-[#94a3b8] dark:text-[#64748b] leading-tight text-center">
                      {t('documents.bdaShort', 'Bedrock Analysis')}
                    </span>
                  </label>

                  {/* OCR */}
                  <div
                    className={`relative flex flex-col items-center gap-0.5 px-2 py-2 border rounded-lg transition-colors ${
                      useOcr
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-black/[0.06] dark:border-[#3b4264] hover:border-black/10 dark:hover:border-[#2a2f45] bg-transparent dark:bg-[#0d1117]'
                    } ${uploading || !hasOcrEligibleFiles ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                    onClick={() => {
                      if (!uploading && hasOcrEligibleFiles) setUseOcr(!useOcr);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={useOcr}
                      readOnly
                      className="sr-only"
                    />
                    <span
                      className={`text-xs font-medium ${useOcr ? 'text-blue-700 dark:text-blue-300' : 'text-[#475569] dark:text-[#94a3b8]'}`}
                    >
                      {t('documents.useOcr', 'OCR')}
                    </span>
                    <span className="text-[10px] text-[#94a3b8] dark:text-[#64748b] leading-tight text-center line-clamp-2 max-w-full">
                      {(() => {
                        const m = OCR_MODELS.find(
                          (o) => o.value === ocrSettings.ocr_model,
                        );
                        return [
                          t(`ocr.models.${ocrSettings.ocr_model}.name`),
                          m?.hasLangOption &&
                            ocrSettings.ocr_lang &&
                            t(`ocr.languages.${ocrSettings.ocr_lang}`),
                          m?.hasOptions &&
                            ocrSettings.use_doc_orientation_classify &&
                            'Orient.',
                          m?.hasOptions &&
                            ocrSettings.use_doc_unwarping &&
                            'Unwarp',
                          m?.hasOptions &&
                            ocrSettings.use_textline_orientation &&
                            'Textline',
                        ]
                          .filter(Boolean)
                          .join(' · ');
                      })()}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowOcr(true);
                      }}
                      className="absolute top-1 left-1 p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800/40 rounded transition-colors"
                    >
                      <Settings className="h-3 w-3 text-blue-500 dark:text-blue-400" />
                    </button>
                    <span
                      className="absolute top-1 right-1 group/ocr"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Info className="h-3 w-3 text-[#94a3b8] dark:text-[#475569] cursor-help" />
                      <span className="absolute top-full right-0 mt-1 hidden group-hover/ocr:block w-48 p-2 text-xs text-[#475569] dark:text-[#cbd5e1] bg-white dark:bg-[#1e2235] border border-black/10 dark:border-[#3b4264] rounded-lg shadow-lg z-10">
                        {t('documents.ocrTooltip')}
                      </span>
                    </span>
                  </div>

                  {/* Transcribe */}
                  <div
                    className={`relative flex flex-col items-center gap-0.5 px-2 py-2 border rounded-lg transition-colors ${
                      useTranscribe
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-black/[0.06] dark:border-[#3b4264] hover:border-black/10 dark:hover:border-[#2a2f45] bg-transparent dark:bg-[#0d1117]'
                    } ${uploading || !hasTranscribeEligibleFiles ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                    onClick={() => {
                      if (!uploading && hasTranscribeEligibleFiles)
                        setUseTranscribe(!useTranscribe);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={useTranscribe}
                      readOnly
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTranscribe(true);
                      }}
                      className="absolute top-1 left-1 p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800/40 rounded transition-colors"
                    >
                      <Settings className="h-3 w-3 text-blue-500 dark:text-blue-400" />
                    </button>
                    <span
                      className="absolute top-1 right-1 group/stt"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Info className="h-3 w-3 text-[#94a3b8] dark:text-[#475569] cursor-help" />
                      <span className="absolute top-full right-0 mt-1 hidden group-hover/stt:block w-48 p-2 text-xs text-[#475569] dark:text-[#cbd5e1] bg-white dark:bg-[#1e2235] border border-black/10 dark:border-[#3b4264] rounded-lg shadow-lg z-10">
                        {t('documents.transcribeTooltip')}
                      </span>
                    </span>
                    <span
                      className={`text-xs font-medium ${useTranscribe ? 'text-blue-700 dark:text-blue-300' : 'text-[#475569] dark:text-[#94a3b8]'}`}
                    >
                      {t('documents.transcribe', 'Transcribe')}
                    </span>
                    <span className="text-[10px] text-[#94a3b8] dark:text-[#64748b] leading-tight text-center line-clamp-2 max-w-full">
                      {t(
                        `transcribe.summary${transcribeSettings.transcribe_language_mode.charAt(0).toUpperCase() + transcribeSettings.transcribe_language_mode.slice(1)}`,
                      )}
                      {transcribeSettings.transcribe_language_mode ===
                        'direct' &&
                        ` · ${transcribeSettings.transcribe_language_code}`}
                      {transcribeSettings.transcribe_language_mode ===
                        'multi' &&
                        transcribeSettings.transcribe_language_options.length >
                          0 &&
                        ` · ${transcribeSettings.transcribe_language_options.length}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* paddleocr-vl page count warning */}
              {showVlWarning && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/[0.07] border border-amber-200 dark:border-amber-400/20 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('ocr.vlPageWarning')}
                  </p>
                </div>
              )}

              {/* Analysis */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <BrainCircuit className="h-3.5 w-3.5 text-emerald-500" />
                  <p className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]">
                    {t('documents.analysis', 'Analysis')}
                  </p>
                </div>
                <div className="space-y-3 p-3 border border-black/[0.06] dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117]">
                  <div className="flex items-start gap-3">
                    <label
                      htmlFor="upload-language"
                      className="w-20 shrink-0 text-sm font-medium text-[#334155] dark:text-[#cbd5e1] pt-1.5"
                    >
                      {t('common.language')}
                    </label>
                    <select
                      id="upload-language"
                      data-modal-input
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      disabled={uploading}
                      className="flex-1 px-2 py-1.5 text-sm border border-black/10 dark:border-[#3b4264] rounded-md bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {t(`languages.${lang.code}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-start gap-3">
                    <label className="w-20 shrink-0 text-sm font-medium text-[#334155] dark:text-[#cbd5e1] pt-2">
                      {t('documents.analysisInstructions', 'Instructions')}
                    </label>
                    <textarea
                      data-modal-input
                      value={documentPrompt}
                      onChange={(e) => setDocumentPrompt(e.target.value)}
                      placeholder={t('analysis.placeholder')}
                      rows={4}
                      disabled={uploading}
                      className="flex-1 px-3 py-2 text-sm border border-black/10 dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] placeholder-[#94a3b8] dark:placeholder-[#94a3b8]/50 placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* OCR Settings Overlay */}
              {showOcr && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center">
                  <div
                    className="absolute inset-0 bg-black/30"
                    onClick={() => setShowOcr(false)}
                  />
                  <div className="upload-modal-container relative rounded-xl w-full max-w-sm mx-4 border border-white/70 dark:border-[#3b4264] shadow-xl overflow-hidden">
                    <div
                      className="hidden dark:block absolute inset-0 pointer-events-none rounded-xl"
                      style={{
                        background:
                          'radial-gradient(ellipse 60% 50% at 80% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
                      }}
                    />
                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.06] dark:border-[#2a2f45]">
                      <h3 className="text-sm font-semibold text-[#1e293b] dark:text-[#f8fafc]">
                        {t('projectSettings.ocrSettings')}
                      </h3>
                      <button
                        onClick={() => setShowOcr(false)}
                        className="p-1 hover:bg-white/40 dark:hover:bg-[#1e2235] rounded-lg transition-colors"
                      >
                        <X className="h-4 w-4 text-[#64748b]" />
                      </button>
                    </div>
                    <div className="p-4">
                      <OcrSettingsForm
                        settings={ocrSettings}
                        onChange={setOcrSettings}
                        variant="compact"
                      />
                    </div>
                    <div className="flex justify-end px-4 py-3 border-t border-black/[0.06] dark:border-[#2a2f45]">
                      <button
                        onClick={() => setShowOcr(false)}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 rounded-lg transition-colors"
                      >
                        {t('common.apply', 'Apply')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Transcribe Settings Overlay */}
              {showTranscribe && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center">
                  <div
                    className="absolute inset-0 bg-black/30"
                    onClick={() => setShowTranscribe(false)}
                  />
                  <div className="upload-modal-container relative rounded-xl w-full max-w-sm mx-4 border border-white/70 dark:border-[#3b4264] shadow-xl overflow-hidden">
                    <div
                      className="hidden dark:block absolute inset-0 pointer-events-none rounded-xl"
                      style={{
                        background:
                          'radial-gradient(ellipse 60% 50% at 80% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
                      }}
                    />
                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.06] dark:border-[#2a2f45]">
                      <h3 className="text-sm font-semibold text-[#1e293b] dark:text-[#f8fafc]">
                        {t('transcribe.title')}
                      </h3>
                      <button
                        onClick={() => setShowTranscribe(false)}
                        className="p-1 hover:bg-white/40 dark:hover:bg-[#1e2235] rounded-lg transition-colors"
                      >
                        <X className="h-4 w-4 text-[#64748b]" />
                      </button>
                    </div>
                    <div className="p-4">
                      <TranscribeSettingsForm
                        settings={transcribeSettings}
                        onChange={setTranscribeSettings}
                      />
                    </div>
                    <div className="flex justify-end px-4 py-3 border-t border-black/[0.06] dark:border-[#2a2f45]">
                      <button
                        onClick={() => setShowTranscribe(false)}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 rounded-lg transition-colors"
                      >
                        {t('common.apply', 'Apply')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Web URL Input */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Link className="h-3.5 w-3.5 text-blue-500" />
                  <label
                    htmlFor="web-url"
                    className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]"
                  >
                    {t('documents.webUrl', 'URL')}
                  </label>
                </div>
                <input
                  id="web-url"
                  data-modal-input
                  type="url"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder={t(
                    'documents.webUrlPlaceholder',
                    'https://example.com/page',
                  )}
                  disabled={uploading}
                  className="w-full px-3 py-2 text-sm border border-black/10 dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] placeholder-[#94a3b8] dark:placeholder-[#94a3b8]/50 placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Web Instruction */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <MessageSquareText className="h-3.5 w-3.5 text-amber-500" />
                  <label
                    htmlFor="web-instruction"
                    className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]"
                  >
                    {t('documents.webInstruction')}
                  </label>
                </div>
                <textarea
                  id="web-instruction"
                  data-modal-input
                  value={webInstruction}
                  onChange={(e) => setWebInstruction(e.target.value)}
                  placeholder={t(
                    'documents.webInstructionPlaceholder',
                    'Enter instructions for content extraction...\n\nExample:\n- Focus on the main article content\n- Extract product specifications\n- Include pricing information',
                  )}
                  disabled={uploading}
                  rows={8}
                  className="w-full px-3 py-2 text-sm border border-black/10 dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] placeholder-[#94a3b8] dark:placeholder-[#94a3b8]/50 placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none"
                />
                <p className="text-xs text-[#64748b]">
                  {t(
                    'documents.webInstructionHint',
                    'Instructions help AI extract relevant content from the web page.',
                  )}
                </p>
              </div>

              {/* Analysis */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <BrainCircuit className="h-3.5 w-3.5 text-emerald-500" />
                  <p className="text-sm font-semibold text-[#334155] dark:text-[#cbd5e1]">
                    {t('documents.analysis', 'Analysis')}
                  </p>
                </div>
                <div className="p-3 border border-black/[0.06] dark:border-[#3b4264] rounded-lg bg-transparent dark:bg-[#0d1117]">
                  <div className="flex items-center gap-3">
                    <label
                      htmlFor="web-language"
                      className="text-sm font-medium text-[#334155] dark:text-[#cbd5e1] whitespace-nowrap"
                    >
                      {t('common.language')}
                    </label>
                    <select
                      id="web-language"
                      data-modal-input
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      disabled={uploading}
                      className="flex-1 px-2 py-1.5 text-sm border border-black/10 dark:border-[#3b4264] rounded-md bg-transparent dark:bg-[#0d1117] text-[#0f172a] dark:text-[#f1f5f9] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {t(`languages.${lang.code}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Web Info */}
              <div className="p-3 bg-blue-50 dark:bg-blue-500/[0.07] border border-blue-200 dark:border-blue-400/20 rounded-lg">
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
            disabled={isUploadDisabled || uploading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:shadow-[0_0_20px_rgba(99,102,241,0.15)]"
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
