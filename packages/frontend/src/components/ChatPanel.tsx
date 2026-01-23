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
  MessageSquarePlus,
  Wand2,
  Download,
  File,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Agent } from '../types/project';

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

/** Prepare content for markdown parsing */
const prepareMarkdown = (content: string): string => {
  // Decode HTML entities
  let result = content
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

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

  return result;
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

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
      if (e.key === 'Enter' && !e.shiftKey) {
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
              {attachedFiles.map((file) => (
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
                    <div className="w-full h-full p-3 flex flex-col justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-200 dark:bg-slate-600 rounded">
                          <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        </div>
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                          {file.file.name.split('.').pop()}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <p
                          className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate"
                          title={file.file.name}
                        >
                          {file.file.name}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
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
              ))}
            </div>
          )}

          {/* Textarea */}
          <div className="max-h-48 w-full overflow-y-auto">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => onInputChange(e.target.value)}
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
        accept="image/*,.pdf,.doc,.docx,.txt"
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
                        {message.attachments.map((attachment) =>
                          attachment.type === 'image' && attachment.preview ? (
                            <img
                              key={attachment.id}
                              src={attachment.preview}
                              alt={attachment.name}
                              className="max-w-48 max-h-48 rounded-xl object-cover border border-slate-200 dark:border-slate-600"
                            />
                          ) : (
                            <div
                              key={attachment.id}
                              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
                            >
                              <FileText className="w-4 h-4 text-slate-500" />
                              <span className="text-sm text-slate-700 dark:text-slate-300">
                                {attachment.name}
                              </span>
                            </div>
                          ),
                        )}
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
                        <Wand2 className="w-3.5 h-3.5 text-white" />
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
                        <a
                          href={message.artifact.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border border-emerald-200 dark:border-emerald-500/40 hover:border-emerald-300 dark:hover:border-emerald-400/60 transition-colors group"
                        >
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                            <FileText className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-emerald-100 truncate">
                              {message.artifact.filename}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-emerald-300/70">
                              {t('chat.clickToDownload', 'Click to download')}
                            </p>
                          </div>
                          <Download className="w-5 h-5 text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                        </a>
                      )}
                    {/* Generated images */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {message.attachments.map((attachment) =>
                          attachment.type === 'image' && attachment.preview ? (
                            <div
                              key={attachment.id}
                              className="relative group overflow-hidden rounded-xl shadow-md"
                            >
                              <img
                                src={attachment.preview}
                                alt={attachment.name}
                                className="max-w-80 max-h-80 object-contain bg-gray-50 dark:bg-violet-950/50"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          ) : null,
                        )}
                      </div>
                    )}
                    {/* Text content */}
                    {message.content && (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-violet-100 [&_strong]:!text-inherit">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                        >
                          {prepareMarkdown(message.content)}
                        </ReactMarkdown>
                      </div>
                    )}
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
                          <img
                            key={attachment.id}
                            src={attachment.preview}
                            alt={attachment.name}
                            className="max-w-80 max-h-80 rounded-xl object-contain border border-slate-200 dark:border-slate-600"
                          />
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
    </div>
  );
}
