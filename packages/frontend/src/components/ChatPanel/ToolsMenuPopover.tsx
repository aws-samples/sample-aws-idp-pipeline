import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronRight,
  Mic,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type { Agent, BidiModelType } from './types';

const VOICE_MODELS: { key: BidiModelType; label: string }[] = [
  { key: 'nova_sonic', label: 'Nova Sonic' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'openai', label: 'OpenAI' },
];

interface ToolsMenuPopoverProps {
  onResearch?: () => void;
  researchMode: boolean;
  onAgentSelect?: (agentName: string | null) => void;
  selectedAgent: Agent | null;
  agents: Agent[];
  voiceChatAvailable?: boolean;
  voiceChatMode: boolean;
  selectedVoiceModel?: BidiModelType;
  onVoiceModelSelect?: (modelType: BidiModelType) => void;
  onVoiceChatDisable: () => void;
  onResearchToggle: () => void;
  messagesLength: number;
  onAgentClick: () => void;
  onClose: () => void;
  onPendingAgentChange: (agentName: string | null) => void;
  onShowRemoveAgentConfirm: () => void;
  setNovaSonicMode: (mode: boolean) => void;
  setResearchMode: (mode: boolean) => void;
  onVoiceChatDisconnect?: () => void;
}

export default function ToolsMenuPopover({
  onResearch,
  researchMode,
  onAgentSelect,
  selectedAgent,
  agents,
  voiceChatAvailable,
  voiceChatMode,
  selectedVoiceModel,
  onVoiceModelSelect,
  onVoiceChatDisable,
  onResearchToggle,
  messagesLength,
  onAgentClick,
  onClose,
  onPendingAgentChange,
  onShowRemoveAgentConfirm,
  setNovaSonicMode,
  setResearchMode,
  onVoiceChatDisconnect,
}: ToolsMenuPopoverProps) {
  const { t } = useTranslation();
  const [showAgentSubmenu, setShowAgentSubmenu] = useState(false);
  const [showVoiceModelSubmenu, setShowVoiceModelSubmenu] = useState(false);

  return (
    <div className="absolute bottom-full left-0 mb-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1">
      {/* Research toggle */}
      {onResearch && (
        <button
          type="button"
          disabled={!!selectedAgent || voiceChatMode || messagesLength > 0}
          onClick={() => {
            if (!researchMode) {
              if (selectedAgent && onAgentSelect) {
                onAgentSelect(null);
              }
              if (voiceChatMode) {
                setNovaSonicMode(false);
                onVoiceChatDisconnect?.();
              }
            }
            onResearchToggle();
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
            selectedAgent || voiceChatMode || messagesLength > 0
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Search
            className={`w-4 h-4 ${researchMode ? 'text-blue-500' : 'text-slate-500 dark:text-slate-400'}`}
          />
          <span
            className={
              researchMode
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-700 dark:text-slate-300'
            }
          >
            {t('chat.research')}
          </span>
          {researchMode && <Check className="w-4 h-4 text-blue-500 ml-auto" />}
        </button>
      )}

      {/* Voice Chat submenu */}
      {voiceChatAvailable && onVoiceModelSelect && (
        <div className="relative">
          <button
            type="button"
            disabled={!!selectedAgent || researchMode}
            onClick={() => {
              setShowVoiceModelSubmenu((v) => !v);
              setShowAgentSubmenu(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              selectedAgent || researchMode
                ? 'opacity-40 cursor-not-allowed'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            <Mic
              className={`w-4 h-4 ${voiceChatMode ? 'text-purple-500' : 'text-slate-500 dark:text-slate-400'}`}
            />
            <span
              className={`flex-1 text-left ${
                voiceChatMode ? 'text-purple-600 dark:text-purple-400' : ''
              }`}
            >
              {t('voiceChat.title')}
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>

          {/* Voice Model submenu panel */}
          {showVoiceModelSubmenu && (
            <div className="absolute left-full bottom-0 ml-1 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-[60] py-1">
              {VOICE_MODELS.map((model) => (
                <button
                  key={model.key}
                  type="button"
                  onClick={() => {
                    if (voiceChatMode && selectedVoiceModel === model.key) {
                      onVoiceChatDisable();
                    } else {
                      if (selectedAgent && onAgentSelect) {
                        onAgentSelect(null);
                      }
                      if (researchMode) {
                        setResearchMode(false);
                      }
                      onVoiceModelSelect(model.key);
                      if (!voiceChatMode) {
                        setNovaSonicMode(true);
                      }
                    }
                    onClose();
                    setShowVoiceModelSubmenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <Mic
                    className={`w-4 h-4 ${voiceChatMode && selectedVoiceModel === model.key ? 'text-purple-500' : 'text-slate-400 dark:text-slate-500'}`}
                  />
                  <span
                    className={`flex-1 text-left ${
                      voiceChatMode && selectedVoiceModel === model.key
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {model.label}
                  </span>
                  {voiceChatMode && selectedVoiceModel === model.key && (
                    <Check className="w-4 h-4 text-purple-500 ml-auto" />
                  )}
                </button>
              ))}

              {/* Disable option */}
              {voiceChatMode && (
                <>
                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={() => {
                      onVoiceChatDisable();
                      onClose();
                      setShowVoiceModelSubmenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <X className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                    <span>{t('voiceChat.disable', 'Disable Voice Chat')}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Agent submenu */}
      {onAgentSelect && (
        <>
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <div className="relative">
            <button
              type="button"
              disabled={researchMode || voiceChatMode}
              onClick={() => {
                setShowAgentSubmenu((v) => !v);
                setShowVoiceModelSubmenu(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                researchMode || voiceChatMode
                  ? 'opacity-40 cursor-not-allowed'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}
            >
              <Sparkles className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span className="flex-1 text-left">{t('chat.useAgent')}</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            {/* Agent submenu panel */}
            {showAgentSubmenu && (
              <div className="absolute left-full bottom-0 ml-1 w-52 max-h-72 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-[60] py-1">
                {/* Default agent */}
                <button
                  type="button"
                  onClick={() => {
                    if (messagesLength > 0 && selectedAgent !== null) {
                      onPendingAgentChange(null);
                      onShowRemoveAgentConfirm();
                    } else {
                      onAgentSelect(null);
                    }
                    onClose();
                    setShowAgentSubmenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <Sparkles
                    className={`w-4 h-4 ${!selectedAgent ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}`}
                  />
                  <span
                    className={
                      !selectedAgent
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }
                  >
                    {t('agent.default')}
                  </span>
                  {!selectedAgent && (
                    <Check className="w-4 h-4 text-blue-500 ml-auto" />
                  )}
                </button>

                {/* Custom agents */}
                {agents.map((agent) => {
                  const isSelected = selectedAgent?.agent_id === agent.agent_id;
                  return (
                    <button
                      key={agent.agent_id}
                      type="button"
                      onClick={() => {
                        if (
                          messagesLength > 0 &&
                          selectedAgent?.agent_id !== agent.agent_id
                        ) {
                          onPendingAgentChange(agent.name);
                          onShowRemoveAgentConfirm();
                        } else {
                          if (voiceChatMode) {
                            setNovaSonicMode(false);
                            onVoiceChatDisconnect?.();
                          }
                          if (researchMode) {
                            setResearchMode(false);
                          }
                          onAgentSelect(agent.name);
                        }
                        onClose();
                        setShowAgentSubmenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    >
                      <Sparkles
                        className={`w-4 h-4 ${isSelected ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}`}
                      />
                      <span
                        className={`flex-1 text-left truncate ${
                          isSelected
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {agent.name}
                      </span>
                      {isSelected && (
                        <Check className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}

                {/* Manage agents */}
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setShowAgentSubmenu(false);
                    onAgentClick();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                  <span>{t('chat.manageAgents')}</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
