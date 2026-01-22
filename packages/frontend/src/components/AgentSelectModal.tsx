import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Pencil, Trash2, Check, Sparkles } from 'lucide-react';
import { Agent } from '../types/project';
import ConfirmModal from './ConfirmModal';

type ModalView = 'list' | 'create' | 'edit';

interface AgentSelectModalProps {
  isOpen: boolean;
  agents: Agent[];
  selectedAgentName: string | null;
  loading?: boolean;
  onClose: () => void;
  onSelect: (agentName: string | null) => void;
  onCreate: (name: string, content: string) => Promise<void>;
  onUpdate: (name: string, content: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onLoadDetail: (name: string) => Promise<Agent | null>;
}

export default function AgentSelectModal({
  isOpen,
  agents,
  selectedAgentName,
  loading = false,
  onClose,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onLoadDetail,
}: AgentSelectModalProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<ModalView>('list');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [pendingAgentName, setPendingAgentName] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setView('list');
      setEditingAgent(null);
      setName('');
      setContent('');
      setDeleteConfirm(null);
      setPendingAgentName(null);
      setShowConfirm(false);
    }
  }, [isOpen]);

  // Focus input when view changes
  useEffect(() => {
    if (view === 'create' && nameInputRef.current) {
      setTimeout(() => nameInputRef.current?.focus(), 300);
    } else if (view === 'edit' && contentInputRef.current) {
      setTimeout(() => contentInputRef.current?.focus(), 300);
    }
  }, [view]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !deleting && !showConfirm) {
        if (view !== 'list') {
          setView('list');
          setEditingAgent(null);
          setName('');
          setContent('');
        } else {
          onClose();
        }
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
  }, [isOpen, onClose, view, saving, deleting, showConfirm]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !saving && !deleting) {
      onClose();
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), content.trim());
      setView('list');
      setName('');
      setContent('');
    } catch (error) {
      console.error('Failed to create agent:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (agent: Agent) => {
    setLoadingDetail(true);
    try {
      const detail = await onLoadDetail(agent.name);
      if (detail) {
        setEditingAgent(detail);
        setContent(detail.content || '');
        setView('edit');
      }
    } catch (error) {
      console.error('Failed to load agent detail:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingAgent || !content.trim()) return;
    setSaving(true);
    try {
      await onUpdate(editingAgent.name, content.trim());
      setView('list');
      setEditingAgent(null);
      setContent('');
    } catch (error) {
      console.error('Failed to update agent:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agentName: string) => {
    setDeleting(true);
    try {
      await onDelete(agentName);
      setDeleteConfirm(null);
      if (editingAgent?.name === agentName) {
        setView('list');
        setEditingAgent(null);
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handleSelect = (agentName: string | null) => {
    // Same agent selected - just close
    if (agentName === selectedAgentName) {
      onClose();
      return;
    }
    // Different agent - show confirm
    setPendingAgentName(agentName);
    setShowConfirm(true);
  };

  const handleConfirmSelect = () => {
    onSelect(pendingAgentName);
    onClose();
  };

  const showRightPanel = view === 'create' || view === 'edit';

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200 dark:border-slate-700 transition-all duration-300"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
          width: showRightPanel ? '800px' : '420px',
          maxWidth: '95vw',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('agent.selectAgent', 'Select Agent')}
          </h3>
          <button
            onClick={onClose}
            disabled={saving || deleting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex overflow-hidden">
          {/* Left Panel - Agent List */}
          <div
            className={`flex-shrink-0 transition-all duration-300 ease-out ${
              showRightPanel
                ? 'w-[280px] border-r border-slate-200 dark:border-slate-700'
                : 'w-full'
            }`}
          >
            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {/* Default Agent - only shown in list mode (not editable) */}
              {!showRightPanel && (
                <button
                  onClick={() => handleSelect(null)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    selectedAgentName === null
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg flex-shrink-0 ${
                      selectedAgentName === null
                        ? 'bg-blue-100 dark:bg-blue-500/20'
                        : 'bg-slate-100 dark:bg-slate-800'
                    }`}
                  >
                    <Sparkles
                      className={`w-4 h-4 ${
                        selectedAgentName === null
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p
                      className={`text-sm font-medium truncate ${
                        selectedAgentName === null
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t('agent.default', 'AI Assistant')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {t(
                        'agent.defaultDescription',
                        'Project default assistant',
                      )}
                    </p>
                  </div>
                  {selectedAgentName === null && (
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  )}
                </button>
              )}

              {/* Custom Agents */}
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <svg
                    className="w-6 h-6 animate-spin text-slate-400"
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
                </div>
              ) : (
                agents.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() =>
                      showRightPanel
                        ? handleEdit(agent)
                        : handleSelect(agent.name)
                    }
                    disabled={loadingDetail && showRightPanel}
                    className={`w-full group flex items-center gap-2 p-3 rounded-xl border transition-all text-left ${
                      showRightPanel
                        ? editingAgent?.name === agent.name
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                        : selectedAgentName === agent.name
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                    } disabled:opacity-50`}
                  >
                    <div
                      className={`p-2 rounded-lg flex-shrink-0 ${
                        (showRightPanel && editingAgent?.name === agent.name) ||
                        (!showRightPanel && selectedAgentName === agent.name)
                          ? 'bg-blue-100 dark:bg-blue-500/20'
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <Sparkles
                        className={`w-4 h-4 ${
                          (showRightPanel &&
                            editingAgent?.name === agent.name) ||
                          (!showRightPanel && selectedAgentName === agent.name)
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          (showRightPanel &&
                            editingAgent?.name === agent.name) ||
                          (!showRightPanel && selectedAgentName === agent.name)
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {agent.name}
                      </p>
                      {!showRightPanel && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {new Date(agent.updated_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {!showRightPanel && selectedAgentName === agent.name && (
                      <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    )}

                    {/* Edit/Delete buttons - only in list mode */}
                    {!showRightPanel && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(agent);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer"
                          title={t('common.edit', 'Edit')}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(agent.name);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                          title={t('common.delete', 'Delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}
                  </button>
                ))
              )}

              {/* Add new agent button */}
              <button
                onClick={() => {
                  setView('create');
                  setEditingAgent(null);
                  setName('');
                  setContent('');
                }}
                className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed transition-all ${
                  view === 'create'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {t('agent.addAgent', 'Add Agent')}
                </span>
              </button>
            </div>
          </div>

          {/* Right Panel - Create/Edit/Confirm */}
          <div
            className={`flex-1 overflow-hidden transition-all duration-300 ease-out ${
              showRightPanel
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 translate-x-4 w-0'
            }`}
          >
            {showRightPanel && (
              <div className="p-6 h-full animate-in slide-in-from-right-4 duration-300">
                {/* Create Form */}
                {view === 'create' && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                        {t('agent.createAgent', 'Create Agent')}
                      </h4>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('agent.name', 'Name')}
                      </label>
                      <input
                        ref={nameInputRef}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('agent.namePlaceholder', 'my-agent')}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('agent.systemPrompt', 'System Prompt')}
                      </label>
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={t(
                          'agent.promptPlaceholder',
                          'You are a helpful assistant...',
                        )}
                        rows={10}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 placeholder-opacity-30 dark:placeholder-slate-500 dark:placeholder-opacity-30 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all resize-none text-sm font-mono leading-relaxed"
                      />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => {
                          setView('list');
                          setName('');
                          setContent('');
                        }}
                        disabled={saving}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 text-sm"
                      >
                        {t('common.cancel', 'Cancel')}
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={saving || !name.trim() || !content.trim()}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        {saving ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg
                              className="animate-spin h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
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
                            {t('common.saving', 'Saving...')}
                          </span>
                        ) : (
                          t('common.create', 'Create')
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Edit Form */}
                {view === 'edit' && editingAgent && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                        {t('agent.editAgent', 'Edit Agent')}
                      </h4>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('agent.name', 'Name')}
                      </label>
                      <input
                        type="text"
                        value={editingAgent.name}
                        disabled
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 cursor-not-allowed text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('agent.systemPrompt', 'System Prompt')}
                      </label>
                      <textarea
                        ref={contentInputRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={10}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 placeholder-opacity-30 dark:placeholder-slate-500 dark:placeholder-opacity-30 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all resize-none text-sm font-mono leading-relaxed"
                      />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => {
                          setView('list');
                          setEditingAgent(null);
                          setContent('');
                        }}
                        disabled={saving}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 text-sm"
                      >
                        {t('common.cancel', 'Cancel')}
                      </button>
                      <button
                        onClick={handleUpdate}
                        disabled={saving || !content.trim()}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        {saving ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg
                              className="animate-spin h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
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
                            {t('common.saving', 'Saving...')}
                          </span>
                        ) : (
                          t('common.save', 'Save')
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Change Agent Confirm Modal */}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => {
          setShowConfirm(false);
          setPendingAgentName(null);
        }}
        onConfirm={handleConfirmSelect}
        title={t('agent.changeAgent', 'Change Agent')}
        message={t(
          'agent.changeConfirmMessage',
          'Changing agent will start a new conversation. Current conversation will be saved in history.',
        )}
        confirmText={t('agent.startNewChat', 'Start New Chat')}
        variant="info"
        transparentBackdrop
      />

      {/* Delete Agent Confirm Modal */}
      <ConfirmModal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            handleDelete(deleteConfirm);
          }
        }}
        title={t('agent.deleteAgent', 'Delete Agent')}
        message={t(
          'agent.deleteConfirmMessage',
          'Are you sure you want to delete "{{name}}"? This action cannot be undone.',
          { name: deleteConfirm },
        )}
        confirmText={t('common.delete', 'Delete')}
        variant="danger"
        loading={deleting}
        transparentBackdrop
      />
    </div>
  );
}
