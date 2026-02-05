import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Terminal, Mic, Save, Loader2 } from 'lucide-react';

type PromptType = 'chat' | 'voice';

interface PromptTab {
  type: PromptType;
  onLoad: () => Promise<string>;
  onSave: (content: string) => Promise<void>;
}

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  tabs: PromptTab[];
  initialTab?: PromptType;
}

export default function SystemPromptModal({
  isOpen,
  onClose,
  tabs,
  initialTab = 'chat',
}: SystemPromptModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PromptType>(initialTab);
  const [contents, setContents] = useState<Record<PromptType, string>>({
    chat: '',
    voice: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<PromptType>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTabConfig = tabs.find((tab) => tab.type === activeTab);

  const loadTabContent = useCallback(
    async (type: PromptType) => {
      const tabConfig = tabs.find((tab) => tab.type === type);
      if (!tabConfig) return;

      setLoading(true);
      try {
        const data = await tabConfig.onLoad();
        setContents((prev) => ({ ...prev, [type]: data }));
        setLoadedTabs((prev) => new Set(prev).add(type));
      } catch (error) {
        console.error(`Failed to load ${type} prompt:`, error);
      } finally {
        setLoading(false);
      }
    },
    [tabs],
  );

  useEffect(() => {
    if (!isOpen) {
      setLoadedTabs(new Set());
      setContents({ chat: '', voice: '' });
      return;
    }

    loadTabContent(activeTab);
  }, [isOpen, activeTab, loadTabContent]);

  useEffect(() => {
    if (isOpen && !loading && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, loading, activeTab]);

  const handleSave = useCallback(async () => {
    if (!activeTabConfig) return;

    setSaving(true);
    try {
      await activeTabConfig.onSave(contents[activeTab]);
      onClose();
    } catch (error) {
      console.error(`Failed to save ${activeTab} prompt:`, error);
    } finally {
      setSaving(false);
    }
  }, [activeTabConfig, activeTab, contents, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'Enter' &&
        !saving &&
        !loading
      ) {
        e.preventDefault();
        handleSave();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, saving, loading, handleSave]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !saving) {
      onClose();
    }
  };

  const handleTabChange = (type: PromptType) => {
    if (type === activeTab || saving) return;
    setActiveTab(type);
    if (!loadedTabs.has(type)) {
      loadTabContent(type);
    }
  };

  if (!isOpen) return null;

  const tabLabels: Record<
    PromptType,
    { label: string; icon: typeof Terminal }
  > = {
    chat: { label: t('systemPrompt.tabChat'), icon: Terminal },
    voice: { label: t('systemPrompt.tabVoice'), icon: Mic },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div
        className="relative flex flex-col bg-white dark:bg-slate-900 rounded-2xl animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200 dark:border-slate-700/80"
        style={{
          boxShadow:
            '0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 40px rgba(99, 102, 241, 0.08)',
          width: '720px',
          maxWidth: '95vw',
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('systemPrompt.title')}
            </h3>

            {/* Tabs */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {tabs.map((tab) => {
                const { label, icon: Icon } = tabLabels[tab.type];
                const isActive = activeTab === tab.type;
                return (
                  <button
                    key={tab.type}
                    onClick={() => handleTabChange(tab.type)}
                    disabled={saving}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      isActive
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    } disabled:opacity-50`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>

            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
              Ctrl+Shift+S
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <span className="text-sm text-slate-400">
                {t('common.loading')}
              </span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={contents[activeTab]}
              onChange={(e) =>
                setContents((prev) => ({
                  ...prev,
                  [activeTab]: e.target.value,
                }))
              }
              placeholder={t('systemPrompt.placeholder')}
              spellCheck={false}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-950/60 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all resize-none p-4"
              style={{
                fontFamily:
                  "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
                fontSize: '13px',
                lineHeight: '1.7',
                height: '420px',
                tabSize: 2,
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700/80 bg-slate-50/30 dark:bg-slate-800/30">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {t('systemPrompt.saveHint')}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 transition-all disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
