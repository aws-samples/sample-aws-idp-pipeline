import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatMessage } from '../types/project';

interface ChatPanelProps {
  messages: ChatMessage[];
  inputMessage: string;
  sending: boolean;
  streamingContent: string;
  currentToolUse: string | null;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export default function ChatPanel({
  messages,
  inputMessage,
  sending,
  streamingContent,
  currentToolUse,
  onInputChange,
  onSendMessage,
  onKeyDown,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <div className="w-2/3 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Chat Header */}
      <div className="p-4 border-b border-slate-200">
        <h2 className="font-semibold text-slate-800">{t('chat.title')}</h2>
        <p className="text-sm text-slate-500">{t('chat.askQuestions')}</p>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
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
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-slate-500 mb-2">{t('chat.startConversation')}</p>
            <p className="text-sm text-slate-400">{t('chat.uploadAndAsk')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                    message.role === 'user'
                      ? 'bg-blue-600'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <p
                    className="text-sm whitespace-pre-wrap"
                    style={
                      message.role === 'user' ? { color: 'white' } : undefined
                    }
                  >
                    {message.content}
                  </p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-800 px-4 py-3 rounded-2xl max-w-[80%]">
                  {currentToolUse && (
                    <div className="flex items-center gap-2 mb-2 text-xs text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30 px-2 py-1 rounded-lg">
                      <svg
                        className="h-3.5 w-3.5 animate-spin"
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
                      <span>
                        {t('chat.usingTool', { tool: currentToolUse })}
                      </span>
                    </div>
                  )}
                  {streamingContent ? (
                    <p className="text-sm whitespace-pre-wrap">
                      {streamingContent}
                    </p>
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
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Chat Input */}
      <div className="p-4 border-t border-slate-200">
        <div className="flex items-end gap-2">
          <textarea
            value={inputMessage}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
            className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={onSendMessage}
            disabled={!inputMessage.trim() || sending}
            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">{t('chat.enterToSend')}</p>
      </div>
    </div>
  );
}
