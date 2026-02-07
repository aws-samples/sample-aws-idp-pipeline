import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, X, Eye, EyeOff } from 'lucide-react';
import type { BidiModelType, VoiceModelConfig } from '../hooks/useVoiceChat';

const VOICE_MODEL_STORAGE_KEY = 'voice_model_config';

export interface VoiceModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: VoiceModelConfig) => void;
  selectedModel?: BidiModelType; // If provided, only show settings for this model
}

const MODEL_OPTIONS: {
  value: BidiModelType;
  label: string;
  requiresApiKey: boolean;
}[] = [
  { value: 'nova_sonic', label: 'Amazon Nova Sonic', requiresApiKey: false },
  { value: 'gemini', label: 'Google Gemini Live', requiresApiKey: true },
  { value: 'openai', label: 'OpenAI Realtime', requiresApiKey: true },
];

const VOICE_OPTIONS: Record<BidiModelType, { value: string; label: string }[]> =
  {
    nova_sonic: [
      { value: 'tiffany', label: 'Tiffany (Female)' },
      { value: 'matthew', label: 'Matthew (Male)' },
    ],
    gemini: [
      { value: 'Kore', label: 'Kore (Female)' },
      { value: 'Puck', label: 'Puck (Male)' },
      { value: 'Charon', label: 'Charon (Male)' },
      { value: 'Fenrir', label: 'Fenrir (Male)' },
      { value: 'Aoede', label: 'Aoede (Female)' },
    ],
    openai: [
      { value: 'alloy', label: 'Alloy' },
      { value: 'ash', label: 'Ash' },
      { value: 'ballad', label: 'Ballad' },
      { value: 'coral', label: 'Coral' },
      { value: 'echo', label: 'Echo' },
      { value: 'sage', label: 'Sage' },
      { value: 'shimmer', label: 'Shimmer' },
      { value: 'verse', label: 'Verse' },
    ],
  };

export function getStoredVoiceModelConfig(): VoiceModelConfig {
  try {
    const stored = localStorage.getItem(VOICE_MODEL_STORAGE_KEY);
    if (stored) {
      const config = JSON.parse(stored) as VoiceModelConfig;
      // Set apiKey from the stored apiKeys for the current model
      if (config.apiKeys) {
        config.apiKey = config.apiKeys[config.modelType as 'gemini' | 'openai'];
      }
      return config;
    }
  } catch {
    // ignore
  }
  return { modelType: 'nova_sonic', voice: 'tiffany', apiKeys: {} };
}

export function saveVoiceModelConfig(config: VoiceModelConfig): void {
  localStorage.setItem(VOICE_MODEL_STORAGE_KEY, JSON.stringify(config));
}

function getApiKeyForModel(
  config: VoiceModelConfig,
  modelType: BidiModelType,
): string {
  if (modelType === 'nova_sonic') return '';
  return config.apiKeys?.[modelType] || '';
}

export default function VoiceModelSettingsModal({
  isOpen,
  onClose,
  onSave,
  selectedModel,
}: VoiceModelSettingsModalProps) {
  const { t } = useTranslation();
  const [modelType, setModelType] = useState<BidiModelType>('nova_sonic');
  const [apiKey, setApiKey] = useState('');
  const [voice, setVoice] = useState('tiffany');
  const [showApiKey, setShowApiKey] = useState(false);
  const [storedApiKeys, setStoredApiKeys] = useState<{
    gemini?: string;
    openai?: string;
  }>({});

  // If selectedModel is provided, lock to that model
  const isModelLocked = selectedModel !== undefined;
  const effectiveModelType = isModelLocked ? selectedModel : modelType;

  useEffect(() => {
    if (isOpen) {
      const config = getStoredVoiceModelConfig();
      // If model is locked, use the locked model; otherwise use stored model
      const targetModel = isModelLocked ? selectedModel : config.modelType;
      setModelType(targetModel);
      setStoredApiKeys(config.apiKeys || {});
      setApiKey(getApiKeyForModel(config, targetModel));
      // Load stored voice for this specific model, or use default
      const storedVoice =
        config.modelType === targetModel ? config.voice : undefined;
      setVoice(storedVoice || VOICE_OPTIONS[targetModel][0]?.value || '');
    }
  }, [isOpen, isModelLocked, selectedModel]);

  useEffect(() => {
    if (!isOpen) return;
    // Reset voice and load API key when model changes (only when not locked)
    const voices = VOICE_OPTIONS[effectiveModelType];
    if (voices && voices.length > 0 && !voice) {
      setVoice(voices[0].value);
    }
    // Load stored API key for this model
    setApiKey(storedApiKeys[effectiveModelType as 'gemini' | 'openai'] || '');
  }, [effectiveModelType, storedApiKeys, isOpen, voice]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = () => {
    const modelOption = MODEL_OPTIONS.find(
      (m) => m.value === effectiveModelType,
    );
    if (modelOption?.requiresApiKey && !apiKey.trim()) {
      return;
    }

    // Update stored API keys with current key
    const updatedApiKeys = { ...storedApiKeys };
    if (effectiveModelType === 'gemini' || effectiveModelType === 'openai') {
      if (apiKey.trim()) {
        updatedApiKeys[effectiveModelType] = apiKey.trim();
      } else {
        delete updatedApiKeys[effectiveModelType];
      }
    }

    const config: VoiceModelConfig = {
      modelType: effectiveModelType,
      voice,
      apiKey: apiKey.trim() || undefined,
      apiKeys: updatedApiKeys,
    };

    saveVoiceModelConfig(config);
    onSave(config);
    onClose();
  };

  const modelOption = MODEL_OPTIONS.find((m) => m.value === effectiveModelType);
  const requiresApiKey = modelOption?.requiresApiKey ?? false;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        style={{
          border: '1px solid rgba(139, 92, 246, 0.3)',
          boxShadow:
            '0 0 40px rgba(139, 92, 246, 0.08), 0 25px 50px -12px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="relative p-8">
          {/* Icon */}
          <div className="w-14 h-14 mx-auto mb-5 rounded-xl flex items-center justify-center bg-purple-100 dark:bg-purple-500/10">
            <Settings className="w-7 h-7 text-purple-600 dark:text-purple-400" />
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-center text-slate-900 dark:text-white mb-6">
            {t('voiceModel.settings', 'Voice Model Settings')}
          </h3>

          {/* Model Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('voiceModel.model', 'Model')}
            </label>
            {isModelLocked ? (
              <div className="w-full px-4 py-3 text-sm bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                {modelOption?.label || effectiveModelType}
              </div>
            ) : (
              <select
                value={modelType}
                onChange={(e) => setModelType(e.target.value as BidiModelType)}
                className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* API Key (conditional) */}
          {requiresApiKey && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {t('voiceModel.apiKey', 'API Key')}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={modelType === 'gemini' ? 'AIza...' : 'sk-...'}
                  className="w-full px-4 py-3 pr-12 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showApiKey ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {t(
                  'voiceModel.apiKeyHint',
                  'Stored locally in your browser only',
                )}
              </p>
            </div>
          )}

          {/* Voice Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('voiceModel.voice', 'Voice')}
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all"
            >
              {VOICE_OPTIONS[effectiveModelType]?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div className="flex gap-4">
            <button
              onClick={onClose}
              className="flex-1 px-5 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl transition-all"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={requiresApiKey && !apiKey.trim()}
              className="flex-1 px-5 py-3 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
