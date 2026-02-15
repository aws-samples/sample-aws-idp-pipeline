import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { CARD_COLORS } from '../ProjectSettingsModal';

interface WelcomeScreenProps {
  voiceChatPanel: React.ReactNode;
  inputBox: React.ReactNode;
  projectName?: string;
  projectColor?: number;
}

export default function WelcomeScreen({
  voiceChatPanel,
  inputBox,
  projectName,
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

      {/* Divider */}
      <div
        className="w-16 h-px mt-5 mb-4 animate-[fadeInUp_0.6s_ease-out_0.2s_both]"
        style={{
          background: `linear-gradient(to right, transparent, ${color.border}60, transparent)`,
        }}
      />

      {/* Welcome description card */}
      <div
        className="relative inline-flex items-center gap-2 px-5 py-2.5 rounded-full
                   backdrop-blur-md
                   animate-[fadeInUp_0.6s_ease-out_0.3s_both]"
        style={{
          background: `linear-gradient(135deg, ${color.border}08, ${color.front}08)`,
          border: `1px solid ${color.border}20`,
          boxShadow: `0 0 20px ${color.border}08, 0 4px 12px rgba(0,0,0,0.03)`,
        }}
      >
        <Sparkles
          className="h-3.5 w-3.5 flex-shrink-0"
          style={{ color: color.border }}
        />
        <span
          className="text-sm font-medium bg-clip-text text-transparent"
          style={{
            backgroundImage: `linear-gradient(135deg, ${color.border}cc, ${color.front}cc)`,
          }}
        >
          {t('chat.welcomeDescription')}
        </span>
      </div>

      {/* Input area */}
      <div
        className="mt-10 w-full flex flex-col items-center
                   animate-[fadeInUp_0.6s_ease-out_0.4s_both]"
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
