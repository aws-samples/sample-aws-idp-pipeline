import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import BouncingCirclesLoader from '../ui/bouncing-circles-loader';
import ToolResultCard from './ToolResultCard';
import ToolUseIndicator from './ToolUseIndicator';
import { prepareMarkdown, getFileTypeInfo } from './utils';
import { renderMessageWithMentions } from './renderMessageWithMentions';
import type {
  StreamingBlock,
  ChatMessage,
  ChatArtifact,
  Document,
} from './types';

interface MessageListProps {
  messages: ChatMessage[];
  streamingBlocks: StreamingBlock[];
  sending: boolean;
  voiceChatMode: boolean;
  expandedSources: Set<string>;
  onToggleExpand: (key: string) => void;
  onArtifactView?: (artifactId: string) => void;
  onArtifactDownload?: (artifact: ChatArtifact) => void;
  downloadingArtifact?: string | null;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
  onImageClick?: (img: { src: string; alt: string }) => void;
  onViewDetails?: (content: string) => void;
  documents: Document[];
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

export default function MessageList({
  messages,
  streamingBlocks,
  sending,
  voiceChatMode,
  expandedSources,
  onToggleExpand,
  onArtifactView,
  onArtifactDownload,
  downloadingArtifact,
  onSourceClick,
  loadingSourceKey,
  onImageClick,
  onViewDetails,
  documents,
  chatEndRef,
}: MessageListProps) {
  const { t } = useTranslation();

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto w-full">
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} />
        ) : message.isToolUse ? (
          <ToolUseIndicator
            key={message.id}
            name={message.toolUseName || ''}
            status={message.toolUseStatus}
          />
        ) : message.isToolResult ? (
          <ToolResultCard
            key={message.id}
            toolName={message.toolName}
            resultType={
              message.toolResultType as
                | 'image'
                | 'artifact'
                | 'text'
                | undefined
            }
            content={message.content}
            artifact={message.artifact}
            sources={message.sources}
            attachments={message.attachments}
            expandKeyPrefix={message.id}
            expandedSources={expandedSources}
            onToggleExpand={onToggleExpand}
            onArtifactView={onArtifactView}
            onArtifactDownload={onArtifactDownload}
            downloadingArtifact={downloadingArtifact}
            onSourceClick={onSourceClick}
            loadingSourceKey={loadingSourceKey}
            onImageClick={onImageClick}
            onViewDetails={onViewDetails}
            documents={documents}
          />
        ) : message.isStageResult ? (
          <StageResult key={message.id} message={message} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            onImageClick={onImageClick}
          />
        ),
      )}

      {/* Streaming blocks */}
      {(sending || (voiceChatMode && streamingBlocks.length > 0)) && (
        <div className="space-y-3">
          {streamingBlocks.length > 0 ? (
            streamingBlocks.map((block, idx) => {
              if (block.type === 'text') {
                return (
                  <div
                    key={idx}
                    className="prose prose-sm dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 [&_strong]:!text-inherit"
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                    >
                      {prepareMarkdown(block.content)}
                    </ReactMarkdown>
                  </div>
                );
              }
              if (block.type === 'stage_start') {
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-amber-200 dark:border-amber-500/40 bg-gradient-to-r from-amber-50/80 to-orange-50/80 dark:from-amber-900/20 dark:to-orange-900/20 shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm flex-shrink-0">
                        <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-amber-200">
                        {t(`chat.stage.${block.stage}`, block.stage)}
                      </span>
                      <div className="flex-1" />
                      <Loader2 className="w-4 h-4 animate-spin text-amber-500 dark:text-amber-400" />
                    </div>
                    <div className="h-0.5 bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      <div className="shimmer-bar h-full w-1/3 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 rounded-full" />
                    </div>
                  </div>
                );
              }
              if (block.type === 'stage_complete') {
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-emerald-200 dark:border-emerald-500/40 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 dark:from-emerald-900/15 dark:to-teal-900/15 shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-emerald-100 dark:border-emerald-500/20">
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm flex-shrink-0">
                        <Check className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-emerald-200">
                        {t(`chat.stageResult.${block.stage}`, block.stage)}
                      </span>
                    </div>
                    <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-emerald-100 [&_strong]:!text-inherit">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                      >
                        {prepareMarkdown(block.result)}
                      </ReactMarkdown>
                    </div>
                  </div>
                );
              }
              if (block.type === 'voice_transcript') {
                const isUser = block.role === 'user';
                return (
                  <div
                    key={idx}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        isUser
                          ? 'bg-purple-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">
                        {block.content}
                        <span className="inline-block w-1.5 h-4 ml-1 bg-current opacity-60 animate-pulse rounded-sm" />
                      </p>
                    </div>
                  </div>
                );
              }
              if (block.type === 'tool_result') {
                return (
                  <ToolResultCard
                    key={idx}
                    toolName={block.toolName}
                    resultType={block.resultType}
                    content={block.content}
                    images={block.images}
                    sources={block.sources}
                    expandKeyPrefix={`streaming-tool-result-${idx}`}
                    expandedSources={expandedSources}
                    onToggleExpand={onToggleExpand}
                    onSourceClick={onSourceClick}
                    onImageClick={onImageClick}
                    onViewDetails={onViewDetails}
                    documents={documents}
                  />
                );
              }
              // tool_use
              return (
                <ToolUseIndicator
                  key={idx}
                  name={block.name}
                  status={block.status}
                />
              );
            })
          ) : (
            <BouncingCirclesLoader
              size={40}
              circleSize={8}
              circleCount={8}
              color="#94a3b8"
              speed={1.2}
            />
          )}
        </div>
      )}
      <div ref={chatEndRef} />
    </div>
  );
}

// --- Internal sub-components ---

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] space-y-2">
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {message.attachments.map((attachment) => {
              if (attachment.type === 'image' && attachment.preview) {
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
                    <FileIcon className={`w-5 h-5 ${fileInfo.color}`} />
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
            <p className="text-sm">
              {renderMessageWithMentions(message.content)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StageResult({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/40 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 dark:from-emerald-900/15 dark:to-teal-900/15 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-emerald-100 dark:border-emerald-500/20">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-medium text-slate-700 dark:text-emerald-200">
          {t(`chat.stageResult.${message.stageName}`, message.stageName ?? '')}
        </span>
      </div>
      {message.content && (
        <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-emerald-100 [&_strong]:!text-inherit">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
          >
            {prepareMarkdown(message.content)}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  onImageClick,
}: {
  message: ChatMessage;
  onImageClick?: (img: { src: string; alt: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {/* AI generated images */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.attachments.map((attachment) =>
            attachment.type === 'image' && attachment.preview ? (
              <button
                key={attachment.id}
                type="button"
                onClick={() =>
                  onImageClick?.({
                    src: attachment.preview ?? '',
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
  );
}
