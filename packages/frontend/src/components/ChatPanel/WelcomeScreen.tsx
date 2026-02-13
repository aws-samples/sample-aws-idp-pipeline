import { useTranslation } from 'react-i18next';
import { CARD_COLORS } from '../ProjectSettingsModal';

interface WelcomeScreenProps {
  voiceChatPanel: React.ReactNode;
  inputBox: React.ReactNode;
  projectName?: string;
  projectDescription?: string;
  projectColor?: number;
}

export default function WelcomeScreen({
  voiceChatPanel,
  inputBox,
  projectName,
  projectDescription,
  projectColor = 0,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const color =
    CARD_COLORS[projectColor % CARD_COLORS.length] || CARD_COLORS[0];

  return (
    <div className="flex flex-col items-center h-full p-6 max-w-3xl mx-auto w-full">
      <div className="flex-[3]" />

      {/* 3D Cube */}
      <div className="relative mb-6 animate-[fadeInUp_0.6s_ease-out_both]">
        <div
          className="absolute -inset-6 rounded-full blur-3xl opacity-15"
          style={{ background: color.border }}
        />
        <div className="welcome-cube-scene">
          <div className="welcome-cube-wrapper">
            <div
              className="welcome-cube-core"
              style={{
                background: color.border,
                boxShadow: `0 0 24px ${color.border}cc`,
              }}
            />
            <div
              className="welcome-cube-face welcome-cube-front"
              style={{
                background: `${color.border}12`,
                borderColor: `${color.border}60`,
                boxShadow: `0 0 10px ${color.border}30`,
              }}
            />
            <div
              className="welcome-cube-face welcome-cube-back"
              style={{
                background: `${color.border}12`,
                borderColor: `${color.border}60`,
                boxShadow: `0 0 10px ${color.border}30`,
              }}
            />
            <div
              className="welcome-cube-face welcome-cube-right"
              style={{
                background: `${color.front}12`,
                borderColor: `${color.front}60`,
                boxShadow: `0 0 10px ${color.front}30`,
              }}
            />
            <div
              className="welcome-cube-face welcome-cube-left"
              style={{
                background: `${color.front}12`,
                borderColor: `${color.front}60`,
                boxShadow: `0 0 10px ${color.front}30`,
              }}
            />
            <div
              className="welcome-cube-face welcome-cube-top"
              style={{
                background: `${color.border}18`,
                borderColor: `${color.border}80`,
                boxShadow: `0 0 10px ${color.border}40`,
              }}
            />
            <div
              className="welcome-cube-face welcome-cube-bottom"
              style={{
                background: `${color.front}08`,
                borderColor: `${color.front}40`,
                boxShadow: `0 0 10px ${color.front}20`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Project name */}
      <h1
        className="text-4xl font-bold tracking-tight text-center
                   bg-clip-text text-transparent
                   animate-[fadeInUp_0.6s_ease-out_0.1s_both]"
        style={{
          backgroundImage: `linear-gradient(135deg, ${color.border}, ${color.front})`,
        }}
      >
        {projectName || t('chat.welcomeTitle')}
      </h1>

      {/* Project description */}
      {projectDescription && (
        <div
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full
                     bg-white/60 dark:bg-white/[0.06] backdrop-blur-md
                     border border-white/40 dark:border-white/[0.08]
                     shadow-sm
                     animate-[fadeInUp_0.6s_ease-out_0.2s_both]"
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: color.border }}
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {projectDescription}
          </span>
        </div>
      )}

      {/* Divider */}
      <div
        className="w-12 h-px my-5 animate-[fadeInUp_0.6s_ease-out_0.3s_both]"
        style={{
          background: `linear-gradient(to right, transparent, ${color.border}50, transparent)`,
        }}
      />

      {/* Welcome subtitle */}
      <p
        className="text-sm text-slate-400 dark:text-slate-500
                   animate-[fadeInUp_0.6s_ease-out_0.35s_both]"
      >
        {t('chat.welcomeDescription')}
      </p>

      {/* Input area */}
      <div
        className="mt-10 w-full flex flex-col items-center
                   animate-[fadeInUp_0.6s_ease-out_0.45s_both]"
      >
        {voiceChatPanel}
        {inputBox}
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-3">
          {t('chat.enterToSend')}
        </p>
      </div>

      <div className="flex-[5]" />
    </div>
  );
}
