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

interface ToolsMenuVoiceChat {
  available?: boolean;
  mode: boolean;
  selectedModel?: BidiModelType;
  onModelSelect?: (modelType: BidiModelType) => void;
  onDisable: () => void;
  setMode: (mode: boolean) => void;
  onDisconnect?: () => void;
}

interface ToolsMenuResearch {
  available: boolean;
  mode: boolean;
  onToggle: () => void;
  setMode: (mode: boolean) => void;
}

interface ToolsMenuPopoverProps {
  voiceChat: ToolsMenuVoiceChat;
  research: ToolsMenuResearch;
  onAgentSelect?: (agentName: string | null) => void;
  selectedAgent: Agent | null;
  agents: Agent[];
  messagesLength: number;
  onAgentClick: () => void;
  onClose: () => void;
  onPendingAgentChange: (agentName: string | null) => void;
  onShowRemoveAgentConfirm: () => void;
}

export default function ToolsMenuPopover({
  voiceChat,
  research,
  onAgentSelect,
  selectedAgent,
  agents,
  messagesLength,
  onAgentClick,
  onClose,
  onPendingAgentChange,
  onShowRemoveAgentConfirm,
}: ToolsMenuPopoverProps) {
  const { t } = useTranslation();
  const [showAgentSubmenu, setShowAgentSubmenu] = useState(false);
  const [showVoiceModelSubmenu, setShowVoiceModelSubmenu] = useState(false);

  return (
    <div className="glass-panel absolute bottom-full left-0 mb-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/30 rounded-xl shadow-lg z-50 py-1">
      {/* Research toggle */}
      {research.available && (
        <button
          type="button"
          disabled={!!selectedAgent || voiceChat.mode || messagesLength > 0}
          onClick={() => {
            if (!research.mode) {
              if (selectedAgent && onAgentSelect) {
                onAgentSelect(null);
              }
              if (voiceChat.mode) {
                voiceChat.setMode(false);
                voiceChat.onDisconnect?.();
              }
            }
            research.onToggle();
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
            selectedAgent || voiceChat.mode || messagesLength > 0
              ? 'opacity-30 cursor-not-allowed'
              : 'glass-menu-item'
          }`}
        >
          <Search
            className={`w-4 h-4 ${research.mode ? 'text-blue-500' : 'text-slate-500 dark:text-slate-400'}`}
          />
          <span
            className={
              research.mode
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-700 dark:text-slate-300'
            }
          >
            {t('chat.research')}
          </span>
          {research.mode && <Check className="w-4 h-4 text-blue-500 ml-auto" />}
        </button>
      )}

      {/* Voice Chat submenu */}
      {voiceChat.available && voiceChat.onModelSelect && (
        <div className="relative">
          <button
            type="button"
            disabled={!!selectedAgent || research.mode}
            onClick={() => {
              setShowVoiceModelSubmenu((v) => !v);
              setShowAgentSubmenu(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              selectedAgent || research.mode
                ? 'opacity-30 cursor-not-allowed'
                : 'text-slate-700 dark:text-slate-300 glass-menu-item'
            }`}
          >
            <Mic
              className={`w-4 h-4 ${voiceChat.mode ? 'text-purple-500' : 'text-slate-500 dark:text-slate-400'}`}
            />
            <span
              className={`flex-1 text-left ${
                voiceChat.mode ? 'text-purple-600 dark:text-purple-400' : ''
              }`}
            >
              {t('voiceChat.title')}
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>

          {/* Voice Model submenu panel */}
          {showVoiceModelSubmenu && (
            <div className="glass-panel absolute left-full bottom-0 ml-1 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/30 rounded-xl shadow-lg z-[60] py-1">
              {VOICE_MODELS.map((model) => (
                <button
                  key={model.key}
                  type="button"
                  onClick={() => {
                    if (
                      voiceChat.mode &&
                      voiceChat.selectedModel === model.key
                    ) {
                      voiceChat.onDisable();
                    } else {
                      if (selectedAgent && onAgentSelect) {
                        onAgentSelect(null);
                      }
                      if (research.mode) {
                        research.setMode(false);
                      }
                      voiceChat.onModelSelect?.(model.key);
                      if (!voiceChat.mode) {
                        voiceChat.setMode(true);
                      }
                    }
                    onClose();
                    setShowVoiceModelSubmenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors glass-menu-item"
                >
                  <Mic
                    className={`w-4 h-4 ${voiceChat.mode && voiceChat.selectedModel === model.key ? 'text-purple-500' : 'text-slate-400 dark:text-slate-500'}`}
                  />
                  <span
                    className={`flex-1 text-left ${
                      voiceChat.mode && voiceChat.selectedModel === model.key
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {model.label}
                  </span>
                  {voiceChat.mode && voiceChat.selectedModel === model.key && (
                    <Check className="w-4 h-4 text-purple-500 ml-auto" />
                  )}
                </button>
              ))}

              {/* Disable option */}
              {voiceChat.mode && (
                <>
                  <div className="my-1 border-t border-slate-200 dark:border-white/30" />
                  <button
                    type="button"
                    onClick={() => {
                      voiceChat.onDisable();
                      onClose();
                      setShowVoiceModelSubmenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 glass-menu-item transition-colors"
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
          <div className="my-1 border-t border-slate-200 dark:border-white/30" />
          <div className="relative">
            <button
              type="button"
              disabled={research.mode || voiceChat.mode}
              onClick={() => {
                setShowAgentSubmenu((v) => !v);
                setShowVoiceModelSubmenu(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                research.mode || voiceChat.mode
                  ? 'opacity-30 cursor-not-allowed'
                  : 'text-slate-700 dark:text-slate-300 glass-menu-item'
              }`}
            >
              <Sparkles className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span className="flex-1 text-left">{t('chat.useAgent')}</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            {/* Agent submenu panel */}
            {showAgentSubmenu && (
              <div className="glass-panel absolute left-full bottom-0 ml-1 w-52 max-h-72 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/30 rounded-xl shadow-lg z-[60] py-1">
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
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors glass-menu-item"
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
                          if (voiceChat.mode) {
                            voiceChat.setMode(false);
                            voiceChat.onDisconnect?.();
                          }
                          if (research.mode) {
                            research.setMode(false);
                          }
                          onAgentSelect(agent.name);
                        }
                        onClose();
                        setShowAgentSubmenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors glass-menu-item"
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
                <div className="my-1 border-t border-slate-200 dark:border-white/30" />
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setShowAgentSubmenu(false);
                    onAgentClick();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 glass-menu-item transition-colors"
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
