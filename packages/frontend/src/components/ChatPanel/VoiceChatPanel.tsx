import { useTranslation } from 'react-i18next';
import { Loader2, Mic, Settings2 } from 'lucide-react';
import { AnimatedAudioBars } from '../AnimatedAudioBars';
import type { VoiceChatState } from './types';

interface VoiceChatPanelProps {
  voiceChatState: VoiceChatState;
  voiceChatAudioLevel?: { input: number; output: number };
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSettings?: () => void;
}

export default function VoiceChatPanel({
  voiceChatState,
  voiceChatAudioLevel,
  onConnect,
  onDisconnect,
  onSettings,
}: VoiceChatPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-3 w-full relative overflow-hidden rounded-2xl">
      {/* Animated gradient background */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          voiceChatState.status === 'connected' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-violet-600/20 via-purple-600/20 to-indigo-600/20 dark:from-violet-600/30 dark:via-purple-600/30 dark:to-indigo-600/30 animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-400/10 via-transparent to-transparent" />
      </div>

      {/* Glass card */}
      <div className="relative backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-2 border-purple-300 dark:border-purple-500/60 rounded-2xl p-5 shadow-xl shadow-purple-500/10">
        {/* Glow effect when connected */}
        {voiceChatState.status === 'connected' && (
          <div className="absolute -inset-[1px] bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 rounded-2xl opacity-20 blur-sm -z-10" />
        )}

        {/* Close button */}
        {(voiceChatState.status === 'connected' ||
          voiceChatState.status === 'connecting') && (
          <button
            type="button"
            onClick={() => onDisconnect?.()}
            className="absolute right-3 top-3 p-2 rounded-full text-slate-400 hover:text-white hover:bg-red-500 transition-all duration-200 group"
            title="Stop"
          >
            <svg
              className="w-4 h-4"
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
        )}

        {/* Content */}
        <div className="flex items-center justify-center gap-6 min-h-[80px]">
          {/* Idle or Error state */}
          {(voiceChatState.status === 'idle' ||
            voiceChatState.status === 'error') && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {voiceChatState.status === 'error'
                  ? t('voiceChat.connectionFailed')
                  : voiceChatState.disconnectReason === 'timeout'
                    ? t('voiceChat.sessionTimedOut')
                    : t('voiceChat.description')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onConnect?.()}
                  className="flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 text-white text-sm font-medium hover:shadow-lg hover:shadow-purple-500/40 hover:scale-105 transition-all duration-200"
                >
                  <Mic className="w-4 h-4" />
                  <span>
                    {voiceChatState.status === 'error'
                      ? t('voiceChat.retryConnection')
                      : t('voiceChat.startVoiceChat')}
                  </span>
                </button>
                {onSettings && (
                  <button
                    type="button"
                    onClick={onSettings}
                    className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300 transition-all duration-200"
                    title={t('voiceModel.settings')}
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Connecting state */}
          {voiceChatState.status === 'connecting' && (
            <div className="flex items-center justify-center gap-4">
              <div className="relative">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/50 dark:to-indigo-900/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-purple-400/50 animate-ping" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('voiceChat.connecting')}
                </p>
              </div>
            </div>
          )}

          {/* Connected state */}
          {voiceChatState.status === 'connected' && (
            <div className="flex items-center gap-8">
              {/* AI indicator */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${
                    voiceChatState.isSpeaking
                      ? 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-purple-500/50'
                      : 'bg-slate-100 dark:bg-slate-800'
                  }`}
                >
                  {voiceChatState.isSpeaking && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-purple-400/30 animate-ping" />
                      <div
                        className="absolute inset-[-4px] rounded-full border-2 border-purple-400/50 animate-pulse"
                        style={{ animationDelay: '0.2s' }}
                      />
                    </>
                  )}
                  <AnimatedAudioBars
                    audioLevel={voiceChatAudioLevel?.output || 0}
                    barCount={5}
                    color={
                      voiceChatState.isSpeaking
                        ? 'bg-white'
                        : 'bg-slate-300 dark:bg-slate-600'
                    }
                    minHeight={4}
                    maxHeight={20}
                    isActive={voiceChatState.isSpeaking}
                    threshold={0.2}
                  />
                </div>
                <span
                  className={`text-xs font-medium ${
                    voiceChatState.isSpeaking
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-slate-400'
                  }`}
                >
                  {t('voiceChat.ai')}
                </span>
              </div>

              {/* Connection indicator */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-green-600 dark:text-green-400 font-medium uppercase tracking-wider">
                    {t('voiceChat.live')}
                  </span>
                </div>
                <div className="w-8 h-px bg-gradient-to-r from-transparent via-slate-300 dark:via-slate-600 to-transparent" />
              </div>

              {/* User mic indicator */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-violet-600 shadow-lg shadow-purple-500/50">
                  <div
                    className="absolute inset-[-4px] rounded-full border-2 border-purple-400/50 animate-pulse"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <AnimatedAudioBars
                    audioLevel={voiceChatAudioLevel?.input || 0}
                    barCount={5}
                    color="bg-white"
                    minHeight={4}
                    maxHeight={20}
                    isActive={voiceChatState.isListening}
                    threshold={0.5}
                  />
                </div>
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                  {t('voiceChat.you')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
