import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  Plus,
  X,
  FileText,
  Archive,
  Box,
  Sparkles,
  ChevronDown,
  ChevronUp,
  MessageSquarePlus,
  Download,
  File,
  Search,
  Loader2,
  FileSpreadsheet,
  FileCode,
  type LucideIcon,
} from 'lucide-react';
import DOMPurify from 'isomorphic-dompurify';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Agent, ChatArtifact } from '../types/project';
import { useAwsClient } from '../hooks/useAwsClient';
import { useToast } from './Toast';
import ImageModal from './ImageModal';

export interface AttachedFile {
  id: string;
  file: File;
  type: string;
  preview: string | null;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  inputMessage: string;
  sending: boolean;
  streamingContent: string;
  currentToolUse: string | null;
  loadingHistory?: boolean;
  selectedAgent: Agent | null;
  onInputChange: (value: string) => void;
  onSendMessage: (files: AttachedFile[]) => void;
  onAgentClick: () => void;
  onNewChat: () => void;
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getFileTypeInfo = (
  filename: string,
): { icon: LucideIcon; color: string; bgColor: string } => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return {
        icon: FileText,
        color: 'text-red-500',
        bgColor: 'bg-red-100 dark:bg-red-900/30',
      };
    case 'doc':
    case 'docx':
      return {
        icon: FileText,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      };
    case 'xls':
    case 'xlsx':
    case 'csv':
      return {
        icon: FileSpreadsheet,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
      };
    case 'html':
    case 'md':
      return {
        icon: FileCode,
        color: 'text-purple-500',
        bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      };
    case 'txt':
      return {
        icon: File,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100 dark:bg-slate-600',
      };
    default:
      return {
        icon: File,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100 dark:bg-slate-600',
      };
  }
};

/** Prepare content for markdown parsing */
const prepareMarkdown = (content: string): string => {
  // Decode HTML entities in a single pass to avoid double-unescaping
  const entityMap: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  let result = content.replace(
    /&(?:lt|gt|amp|quot|nbsp|#39);/g,
    (match) => entityMap[match] ?? match,
  );

  // Strip HTML tags (except strong/em which we'll add)
  result = result
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<(?!\/?(?:strong|em))[^>]*>/g, '');

  // Unescape markdown characters (backslash-escaped)
  result = result
    .replace(/\\\*/g, '___ESCAPED_ASTERISK___')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\`/g, '`')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']');

  // Convert bold markdown to HTML (handles non-ASCII characters after closing **)
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Convert italic markdown to HTML
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Restore escaped asterisks
  result = result.replace(/___ESCAPED_ASTERISK___/g, '*');

  return DOMPurify.sanitize(result);
};

export default function ChatPanel({
  messages,
  inputMessage,
  sending,
  streamingContent,
  currentToolUse,
  loadingHistory = false,
  selectedAgent,
  onInputChange,
  onSendMessage,
  onAgentClick,
  onNewChat,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const { getPresignedDownloadUrl } = useAwsClient();
  const { showToast } = useToast();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // Expansion levels: 0=collapsed, 1=medium, 2=large, 3=full
  const [toolResultExpandLevel, setToolResultExpandLevel] = useState<
    Map<string, number>
  >(new Map());
  const [modalImage, setModalImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [downloadingArtifact, setDownloadingArtifact] = useState<string | null>(
    null,
  );

  const handleArtifactDownload = useCallback(
    async (artifact: ChatArtifact) => {
      setDownloadingArtifact(artifact.artifact_id);
      try {
        // Extract bucket from the original URL
        // URL format: https://{bucket}.s3.{region}.amazonaws.com/...
        const urlMatch = artifact.url.match(
          /https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\//,
        );
        if (!urlMatch || !artifact.s3_key) {
          throw new Error('Invalid artifact URL or missing s3_key');
        }
        const bucket = urlMatch[1];

        const presignedUrl = await getPresignedDownloadUrl(
          bucket,
          artifact.s3_key,
        );

        // Fetch and download as blob
        const response = await fetch(presignedUrl);

        // Check if file exists
        if (!response.ok) {
          if (response.status === 404 || response.status === 403) {
            showToast(
              'error',
              t(
                'chat.artifactNotFound',
                'File not found. It may have been deleted.',
              ),
            );
            return;
          }
          throw new Error(`Download failed: ${response.status}`);
        }

        const blob = await response.blob();

        // Check if response is XML error (S3 returns XML for errors)
        if (blob.type.includes('xml')) {
          const text = await blob.text();
          if (text.includes('NoSuchKey')) {
            showToast(
              'error',
              t(
                'chat.artifactNotFound',
                'File not found. It may have been deleted.',
              ),
            );
            return;
          }
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = artifact.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Failed to download artifact:', error);
        showToast('error', t('chat.downloadFailed', 'Download failed'));
      } finally {
        setDownloadingArtifact(null);
      }
    },
    [getPresignedDownloadUrl, showToast, t],
  );

  const expandToolResult = useCallback((messageId: string) => {
    setToolResultExpandLevel((prev) => {
      const next = new Map(prev);
      const current = next.get(messageId) || 0;
      next.set(messageId, Math.min(current + 1, 6));
      return next;
    });
  }, []);

  const collapseToolResult = useCallback((messageId: string) => {
    setToolResultExpandLevel((prev) => {
      const next = new Map(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputMessage]);

  // File handling
  const handleFiles = useCallback((newFilesList: FileList | File[]) => {
    const newFiles = Array.from(newFilesList).map((file) => {
      const isImage =
        file.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
      return {
        id: Math.random().toString(36).substr(2, 9),
        file,
        type: isImage ? 'image' : file.type || 'application/octet-stream',
        preview: isImage ? URL.createObjectURL(file) : null,
      };
    });
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
    e.target.value = '';
  };

  const removeFile = (id: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  // Drag & Drop
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const hasMessages = messages.length > 0 || sending;
  const hasContent = inputMessage.trim().length > 0 || attachedFiles.length > 0;

  const handleSend = useCallback(() => {
    if (!hasContent || sending) return;
    onSendMessage(attachedFiles);
    setAttachedFiles([]);
  }, [hasContent, sending, onSendMessage, attachedFiles]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ignore Enter during IME composition (Korean, Japanese, Chinese input)
      if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Input Box - inline JSX to prevent re-mounting on every render
  const inputBox = (
    <div
      className="relative w-full max-w-2xl mx-auto"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="chat-input-box flex flex-col rounded-2xl border transition-all duration-200 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:shadow-md focus-within:shadow-lg">
        <div className="flex flex-col px-3 pt-3 pb-2 gap-2">
          {/* Attached Files Preview */}
          {attachedFiles.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2 px-1">
              {attachedFiles.map((file) => {
                const fileInfo = getFileTypeInfo(file.file.name);
                const FileIcon = fileInfo.icon;
                return (
                  <div
                    key={file.id}
                    className="relative group flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 transition-all hover:border-slate-300 dark:hover:border-slate-500"
                  >
                    {file.type === 'image' && file.preview ? (
                      <img
                        src={file.preview}
                        alt={file.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full p-2 flex flex-col">
                        <div
                          className={`flex items-center justify-center w-full h-10 rounded-lg ${fileInfo.bgColor}`}
                        >
                          <FileIcon className={`w-5 h-5 ${fileInfo.color}`} />
                        </div>
                        <div className="flex-1 flex flex-col justify-end mt-1">
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                            {file.file.name.split('.').pop()}
                          </span>
                          <p
                            className="text-[10px] font-medium text-slate-700 dark:text-slate-300 truncate"
                            title={file.file.name}
                          >
                            {file.file.name.split('.').slice(0, -1).join('.')}
                          </p>
                          <p className="text-[9px] text-slate-400 dark:text-slate-500">
                            {formatFileSize(file.file.size)}
                          </p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => removeFile(file.id)}
                      className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Textarea */}
          <div className="max-h-48 w-full overflow-y-auto">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => onInputChange(e.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.placeholder')}
              className="w-full border-0 outline-none text-base resize-none overflow-hidden py-0 leading-relaxed"
              rows={1}
              style={{
                minHeight: '1.5em',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
              }}
            />
          </div>

          {/* Action Bar */}
          <div className="flex gap-2 w-full items-center">
            <div className="flex-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!hasContent || sending}
              type="button"
              className={`inline-flex items-center justify-center h-8 w-8 rounded-xl transition-all active:scale-95 ${
                hasContent && !sending
                  ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-md'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
            >
              {sending ? (
                <svg
                  className="w-4 h-4 animate-spin"
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
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50/90 dark:bg-blue-900/30 border-2 border-dashed border-blue-500 rounded-2xl z-50 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none">
          <Archive className="w-10 h-10 text-blue-500 mb-2 animate-bounce" />
          <p className="text-blue-600 dark:text-blue-400 font-medium">
            {t('documents.dropHere')}
          </p>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.csv,.doc,.docx,.xls,.xlsx,.html,.txt,.md"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Agent Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={onAgentClick}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <Sparkles className="w-4 h-4" />
          <span>
            {selectedAgent?.name || t('agent.default', 'Default Agent')}
          </span>
          <ChevronDown className="w-4 h-4 opacity-70" />
        </button>
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <MessageSquarePlus className="w-4 h-4" />
          <span>{t('chat.newChat')}</span>
        </button>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto">
        {loadingHistory ? (
          /* Loading History */
          <div className="flex flex-col items-center justify-center h-full p-6">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <svg
                className="w-5 h-5 animate-spin"
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
              <span className="text-sm">
                {t('chat.loadingHistory', 'Loading conversation...')}
              </span>
            </div>
          </div>
        ) : !hasMessages ? (
          /* Welcome Screen */
          <div className="flex flex-col items-center h-full p-6 pt-[22%]">
            <div className="mb-6">
              <Box className="w-10 h-10 text-blue-500" strokeWidth={1.5} />
            </div>
            <h3 className="text-xl font-light text-slate-800 dark:text-white mb-2 tracking-tight">
              {t('chat.welcomeTitle')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
              {t('chat.welcomeDescription')}
            </p>
            <div className="mt-10 w-full flex flex-col items-center">
              {inputBox}
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-3">
                {t('chat.enterToSend')}
              </p>
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="p-6 space-y-6">
            {messages.map((message) =>
              message.role === 'user' ? (
                /* User message - bubble style */
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] space-y-2">
                    {/* Attachments */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        {message.attachments.map((attachment) => {
                          if (
                            attachment.type === 'image' &&
                            attachment.preview
                          ) {
                            return (
                              <img
                                key={attachment.id}
                                src={attachment.preview}
                                alt={attachment.name}
                                className="max-w-48 max-h-48 rounded-xl object-cover border border-slate-200 dark:border-slate-600"
                              />
                            );
                          }
                          const fileInfo = getFileTypeInfo(attachment.name);
                          const FileIcon = fileInfo.icon;
                          return (
                            <div
                              key={attachment.id}
                              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 border border-slate-200 dark:border-slate-600 shadow-sm"
                            >
                              <div
                                className={`flex items-center justify-center w-10 h-10 rounded-lg ${fileInfo.bgColor}`}
                              >
                                <FileIcon
                                  className={`w-5 h-5 ${fileInfo.color}`}
                                />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[150px]">
                                  {attachment.name}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-slate-500 uppercase">
                                  {attachment.name.split('.').pop()} file
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Text content */}
                    {message.content && (
                      <div className="px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white">
                        <p className="text-sm whitespace-pre-wrap">
                          {message.content}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : message.isToolResult ? (
                /* Tool result message - special card design */
                <div
                  key={message.id}
                  className="relative overflow-hidden rounded-2xl bg-white dark:bg-gradient-to-br dark:from-violet-600/30 dark:via-purple-600/25 dark:to-fuchsia-600/20 border border-slate-200 dark:border-violet-400 shadow-sm dark:shadow-lg dark:shadow-violet-500/20"
                >
                  {/* Decorative background elements - dark mode only */}
                  <div className="hidden dark:block absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-violet-300/20 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                  <div className="hidden dark:block absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-fuchsia-300/20 to-transparent rounded-full translate-y-1/2 -translate-x-1/2" />

                  {/* Header */}
                  <div className="relative flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-violet-400/50 bg-gray-50 dark:bg-violet-500/20">
                    <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
                      {message.toolResultType === 'artifact' ? (
                        <File className="w-3.5 h-3.5 text-white" />
                      ) : (
                        <Search className="w-3.5 h-3.5 text-white" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-slate-600 dark:text-fuchsia-300">
                      {message.toolResultType === 'artifact'
                        ? t('chat.artifactSaved', 'Artifact Saved')
                        : t('chat.toolResult', 'Tool Result')}
                    </span>
                    <div className="flex-1" />
                    <Sparkles className="w-4 h-4 text-slate-300 dark:text-violet-400/80" />
                  </div>

                  {/* Content */}
                  <div className="relative p-4 space-y-3 dark:bg-violet-500/10">
                    {/* Artifact card */}
                    {message.toolResultType === 'artifact' &&
                      message.artifact && (
                        <button
                          type="button"
                          onClick={() =>
                            handleArtifactDownload(message.artifact!)
                          }
                          disabled={
                            downloadingArtifact === message.artifact.artifact_id
                          }
                          className="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border border-emerald-200 dark:border-emerald-500/40 hover:border-emerald-300 dark:hover:border-emerald-400/60 transition-colors group disabled:opacity-70 disabled:cursor-wait"
                        >
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                            <FileText className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium text-slate-800 dark:text-emerald-100 truncate">
                              {message.artifact.filename}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-emerald-300/70">
                              {t('chat.clickToDownload', 'Click to download')}
                            </p>
                          </div>
                          {downloadingArtifact ===
                          message.artifact.artifact_id ? (
                            <Loader2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400 animate-spin" />
                          ) : (
                            <Download className="w-5 h-5 text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                          )}
                        </button>
                      )}
                    {/* Generated images */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {message.attachments.map((attachment) =>
                          attachment.type === 'image' && attachment.preview ? (
                            <button
                              key={attachment.id}
                              type="button"
                              onClick={() =>
                                setModalImage({
                                  src: attachment.preview!,
                                  alt: attachment.name,
                                })
                              }
                              className="relative group overflow-hidden rounded-xl shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
                            >
                              <img
                                src={attachment.preview}
                                alt={attachment.name}
                                className="max-w-80 max-h-80 object-contain bg-gray-50 dark:bg-violet-950/50"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                                <span className="text-xs text-white font-medium">
                                  {t('chat.clickToEnlarge', 'Click to enlarge')}
                                </span>
                              </div>
                            </button>
                          ) : null,
                        )}
                      </div>
                    )}
                    {/* Text content - multi-level collapsible */}
                    {message.content &&
                      (() => {
                        const contentLength = message.content.length;
                        const expandLevel =
                          toolResultExpandLevel.get(message.id) || 0;

                        // Level configs: [charLimit, maxHeightClass]
                        const levels = [
                          { chars: 150, height: 'max-h-20' },
                          { chars: 400, height: 'max-h-36' },
                          { chars: 800, height: 'max-h-56' },
                          { chars: 1500, height: 'max-h-72' },
                          { chars: 3000, height: 'max-h-96' },
                          { chars: 6000, height: 'max-h-[32rem]' },
                          { chars: Infinity, height: '' },
                        ];

                        const currentLevel = levels[expandLevel];
                        const isFullyExpanded =
                          expandLevel >= levels.length - 1;
                        const canExpand =
                          !isFullyExpanded &&
                          contentLength > currentLevel.chars;
                        const canCollapse = expandLevel > 0;

                        const displayContent =
                          contentLength > currentLevel.chars
                            ? message.content.slice(0, currentLevel.chars) +
                              '...'
                            : message.content;

                        return (
                          <div className="space-y-2">
                            <div
                              className={`prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-violet-100 [&_strong]:!text-inherit ${
                                currentLevel.height
                                  ? `${currentLevel.height} overflow-hidden`
                                  : ''
                              }`}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                              >
                                {prepareMarkdown(displayContent)}
                              </ReactMarkdown>
                            </div>
                            {(canExpand || canCollapse) && (
                              <div className="flex items-center gap-3">
                                {canExpand && (
                                  <button
                                    onClick={() => expandToolResult(message.id)}
                                    className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                                  >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                    {t('common.showMore', 'Show more')}
                                  </button>
                                )}
                                {canCollapse && (
                                  <button
                                    onClick={() =>
                                      collapseToolResult(message.id)
                                    }
                                    className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                  >
                                    <ChevronUp className="w-3.5 h-3.5" />
                                    {t('common.showLess', 'Show less')}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                </div>
              ) : (
                /* AI message - no bubble, markdown */
                <div key={message.id} className="space-y-3">
                  {/* AI generated images */}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {message.attachments.map((attachment) =>
                        attachment.type === 'image' && attachment.preview ? (
                          <button
                            key={attachment.id}
                            type="button"
                            onClick={() =>
                              setModalImage({
                                src: attachment.preview!,
                                alt: attachment.name,
                              })
                            }
                            className="group relative rounded-xl overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                          >
                            <img
                              src={attachment.preview}
                              alt={attachment.name}
                              className="max-w-80 max-h-80 object-contain border border-slate-200 dark:border-slate-600"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="text-xs text-white font-medium">
                                {t('chat.clickToEnlarge', 'Click to enlarge')}
                              </span>
                            </div>
                          </button>
                        ) : null,
                      )}
                    </div>
                  )}
                  {/* Text content */}
                  {message.content && (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 [&_strong]:!text-inherit">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                      >
                        {prepareMarkdown(message.content)}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ),
            )}

            {sending && (
              <div>
                {currentToolUse && (
                  <div className="flex items-center gap-2 mb-3 text-xs text-blue-600 dark:text-blue-400">
                    <svg
                      className="w-3 h-3 animate-spin"
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
                    <span>{t('chat.usingTool', { tool: currentToolUse })}</span>
                  </div>
                )}
                {streamingContent ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 [&_strong]:!text-inherit">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                    >
                      {prepareMarkdown(streamingContent)}
                    </ReactMarkdown>
                  </div>
                ) : !currentToolUse ? (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                    <div
                      className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: '0.1s' }}
                    />
                    <div
                      className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                ) : null}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Bottom Input */}
      {hasMessages && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          {inputBox}
        </div>
      )}

      {/* Image Modal */}
      {modalImage && (
        <ImageModal
          src={modalImage.src}
          alt={modalImage.alt}
          onClose={() => setModalImage(null)}
        />
      )}
    </div>
  );
}
