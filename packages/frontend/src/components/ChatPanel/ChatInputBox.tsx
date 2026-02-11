import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  Plus,
  X,
  Archive,
  FileText,
  Search,
  Settings2,
  Sparkles,
  Mic,
} from 'lucide-react';
import { formatFileSize, getFileTypeInfo } from './utils';
import ToolsMenuPopover from './ToolsMenuPopover';
import type {
  AttachedFile,
  Artifact,
  Document,
  Agent,
  BidiModelType,
  VoiceChatState,
} from './types';

interface ChatInputBoxProps {
  inputMessage: string;
  sending: boolean;
  attachedFiles: AttachedFile[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  artifacts: Artifact[];
  documents: Document[];
  agents: Agent[];
  selectedAgent: Agent | null;
  researchMode: boolean;
  voiceChatMode: boolean;
  voiceChatState?: VoiceChatState;
  selectedVoiceModel?: BidiModelType;
  voiceChatAvailable?: boolean;
  onInputChange: (value: string) => void;
  onSendMessage: (files: AttachedFile[], message?: string) => void;
  onResearch?: (files: AttachedFile[], message?: string) => void;
  onAgentSelect?: (agentName: string | null) => void;
  onAgentClick: () => void;
  onVoiceChatText?: (text: string) => void;
  onVoiceModelSelect?: (modelType: BidiModelType) => void;
  onVoiceChatDisconnect?: () => void;
  onVoiceChatSettings?: () => void;
  setResearchMode: (mode: boolean) => void;
  setNovaSonicMode: (mode: boolean) => void;
  handleNovaSonicDisable: () => void;
  handleResearchDisable: () => void;
  messagesLength: number;
  setPendingAgentChange: (val: string | null) => void;
  setShowRemoveAgentConfirm: (val: boolean) => void;
  // Expose refs for parent
  inputRef: React.RefObject<HTMLDivElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export default function ChatInputBox({
  inputMessage,
  sending,
  attachedFiles,
  setAttachedFiles,
  artifacts,
  documents,
  agents,
  selectedAgent,
  researchMode,
  voiceChatMode,
  voiceChatState,
  selectedVoiceModel,
  voiceChatAvailable,
  onInputChange,
  onSendMessage,
  onResearch,
  onAgentSelect,
  onAgentClick,
  onVoiceChatText,
  onVoiceModelSelect,
  onVoiceChatDisconnect,
  setResearchMode,
  setNovaSonicMode,
  handleNovaSonicDisable,
  handleResearchDisable,
  messagesLength,
  setPendingAgentChange,
  setShowRemoveAgentConfirm,
  inputRef,
  fileInputRef,
}: ChatInputBoxProps) {
  const { t } = useTranslation();
  const isComposingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // Mention state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearchQuery, setMentionSearchQuery] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [mentionTab, setMentionTab] = useState<'artifacts' | 'documents'>(
    'artifacts',
  );
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const mentionRangeRef = useRef<Range | null>(null);

  const filteredArtifacts = artifacts.filter((artifact) =>
    artifact.filename.toLowerCase().includes(mentionSearchQuery.toLowerCase()),
  );
  const filteredDocuments = documents
    .filter((doc) => doc.status === 'completed')
    .filter((doc) =>
      doc.name.toLowerCase().includes(mentionSearchQuery.toLowerCase()),
    );

  const hasContent = inputMessage.trim().length > 0 || attachedFiles.length > 0;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mentionDropdownRef.current &&
        !mentionDropdownRef.current.contains(e.target as Node)
      ) {
        setShowMentionDropdown(false);
      }
      if (
        toolsMenuRef.current &&
        !toolsMenuRef.current.contains(e.target as Node)
      ) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll selected mention item into view
  useEffect(() => {
    if (showMentionDropdown && mentionDropdownRef.current) {
      const selectedItem = mentionDropdownRef.current.querySelector(
        `[data-mention-index="${selectedMentionIndex}"]`,
      );
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedMentionIndex, showMentionDropdown]);

  // Sync input content when inputMessage changes externally
  useEffect(() => {
    if (
      inputRef.current &&
      inputMessage === '' &&
      inputRef.current.innerHTML !== ''
    ) {
      inputRef.current.innerHTML = '';
    }
  }, [inputMessage, inputRef]);

  // Get text content from contenteditable
  const getInputContent = useCallback(() => {
    if (!inputRef.current) return '';
    let result = '';
    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.dataset.artifactId) {
          result += `[artifact:${el.dataset.artifactId}](${el.dataset.artifactFilename})`;
        } else if (el.dataset.documentId) {
          result += `[document:${el.dataset.documentId}](${el.dataset.documentFilename})`;
        } else if (el.tagName === 'BR') {
          result += '\n';
        } else {
          el.childNodes.forEach(processNode);
        }
      }
    };
    inputRef.current.childNodes.forEach(processNode);
    return result;
  }, [inputRef]);

  const getPlainTextContent = useCallback(() => {
    if (!inputRef.current) return '';
    return inputRef.current.textContent || '';
  }, [inputRef]);

  // Handle input change with @ mention detection
  const handleInputChange = useCallback(() => {
    const content = getPlainTextContent();
    onInputChange(content);

    const selection = window.getSelection();
    const hasMentionables = artifacts.length > 0 || documents.length > 0;
    if (!selection || selection.rangeCount === 0 || !hasMentionables) {
      setShowMentionDropdown(false);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      setShowMentionDropdown(false);
      return;
    }

    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      setShowMentionDropdown(false);
      return;
    }

    const textBeforeCursor =
      node.textContent?.slice(0, range.startOffset) || '';
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        const mentionRange = document.createRange();
        mentionRange.setStart(node, lastAtIndex);
        mentionRange.setEnd(node, range.startOffset);
        mentionRangeRef.current = mentionRange;

        setShowMentionDropdown(true);
        setMentionSearchQuery(textAfterAt);
        setSelectedMentionIndex(0);
        if (artifacts.length === 0 && documents.length > 0) {
          setMentionTab('documents');
        } else {
          setMentionTab('artifacts');
        }
        return;
      }
    }

    setShowMentionDropdown(false);
    setMentionSearchQuery('');
    mentionRangeRef.current = null;
  }, [onInputChange, artifacts.length, documents.length, getPlainTextContent]);

  // Create chip elements
  const createArtifactChip = useCallback((artifact: Artifact) => {
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.artifactId = artifact.artifact_id;
    chip.dataset.artifactFilename = artifact.filename;
    chip.className =
      'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-700 rounded text-xs font-medium text-violet-700 dark:text-violet-300 align-middle';
    chip.innerHTML = `<svg class="w-3 h-3 text-violet-500 dark:text-violet-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg><span class="max-w-24 truncate">${artifact.filename}</span>`;
    return chip;
  }, []);

  const createDocumentChip = useCallback((doc: Document) => {
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.documentId = doc.document_id;
    chip.dataset.documentFilename = doc.name;
    chip.className =
      'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded text-xs font-medium text-blue-700 dark:text-blue-300 align-middle';
    chip.innerHTML = `<svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg><span class="max-w-24 truncate">${doc.name}</span>`;
    return chip;
  }, []);

  // Mention selection handlers
  const handleArtifactSelect = useCallback(
    (artifact: Artifact) => {
      if (!mentionRangeRef.current || !inputRef.current) {
        setShowMentionDropdown(false);
        return;
      }
      mentionRangeRef.current.deleteContents();
      const chip = createArtifactChip(artifact);
      mentionRangeRef.current.insertNode(chip);
      const selection = window.getSelection();
      if (selection) {
        const newRange = document.createRange();
        newRange.setStartAfter(chip);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      onInputChange(getPlainTextContent());
      setShowMentionDropdown(false);
      setMentionSearchQuery('');
      mentionRangeRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [createArtifactChip, onInputChange, getPlainTextContent, inputRef],
  );

  const handleDocumentSelect = useCallback(
    (doc: Document) => {
      if (!mentionRangeRef.current || !inputRef.current) {
        setShowMentionDropdown(false);
        return;
      }
      mentionRangeRef.current.deleteContents();
      const chip = createDocumentChip(doc);
      mentionRangeRef.current.insertNode(chip);
      const selection = window.getSelection();
      if (selection) {
        const newRange = document.createRange();
        newRange.setStartAfter(chip);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      onInputChange(getPlainTextContent());
      setShowMentionDropdown(false);
      setMentionSearchQuery('');
      mentionRangeRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [createDocumentChip, onInputChange, getPlainTextContent, inputRef],
  );

  // Insert a chip at end of input
  const insertChipAtEnd = useCallback(
    (chip: HTMLElement) => {
      if (!inputRef.current) return;
      inputRef.current.appendChild(chip);
      const space = document.createTextNode('\u00A0');
      inputRef.current.appendChild(space);
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStartAfter(space);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      inputRef.current.focus();
      onInputChange(getInputContent());
    },
    [onInputChange, getInputContent, inputRef],
  );

  // File handling
  const handleFiles = useCallback(
    (newFilesList: FileList | File[]) => {
      const newFiles = Array.from(newFilesList).map((file) => {
        const isImage =
          file.type.startsWith('image/') ||
          /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
        return {
          id: Math.random().toString(36).substr(2, 9),
          file,
          type: isImage ? 'image' : file.type || 'application/octet-stream',
          preview: isImage ? URL.createObjectURL(file) : null,
        };
      });
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    },
    [setAttachedFiles],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = '';
  };

  const removeFile = (id: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // Drag & Drop
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const artifactData = e.dataTransfer.getData('application/x-artifact');
    if (artifactData) {
      try {
        const { artifact_id, filename } = JSON.parse(artifactData);
        const chip = createArtifactChip({ artifact_id, filename } as Artifact);
        insertChipAtEnd(chip);
      } catch {
        /* ignore */
      }
      return;
    }

    const documentData = e.dataTransfer.getData('application/x-document');
    if (documentData) {
      try {
        const { document_id, name } = JSON.parse(documentData);
        const chip = createDocumentChip({ document_id, name } as Document);
        insertChipAtEnd(chip);
      } catch {
        /* ignore */
      }
      return;
    }

    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const handleSend = useCallback(() => {
    if (!hasContent || sending) return;

    const messageContent = getInputContent();

    if (voiceChatMode && onVoiceChatText) {
      onVoiceChatText(messageContent);
    } else if (researchMode && onResearch) {
      onResearch(attachedFiles, messageContent);
    } else {
      onSendMessage(attachedFiles, messageContent);
    }
    setAttachedFiles([]);

    if (inputRef.current) {
      inputRef.current.innerHTML = '';
      inputRef.current.focus();
    }
    onInputChange('');
  }, [
    hasContent,
    sending,
    researchMode,
    voiceChatMode,
    onResearch,
    onVoiceChatText,
    onSendMessage,
    attachedFiles,
    onInputChange,
    getInputContent,
    inputRef,
    setAttachedFiles,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const currentItems =
        mentionTab === 'artifacts' ? filteredArtifacts : filteredDocuments;

      if (showMentionDropdown && currentItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev < currentItems.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev > 0 ? prev - 1 : currentItems.length - 1,
          );
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const newTab = mentionTab === 'artifacts' ? 'documents' : 'artifacts';
          setMentionTab(newTab);
          setSelectedMentionIndex(0);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (mentionTab === 'artifacts') {
            handleArtifactSelect(filteredArtifacts[selectedMentionIndex]);
          } else {
            handleDocumentSelect(filteredDocuments[selectedMentionIndex]);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentionDropdown(false);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      handleSend,
      showMentionDropdown,
      filteredArtifacts,
      filteredDocuments,
      selectedMentionIndex,
      mentionTab,
      handleArtifactSelect,
      handleDocumentSelect,
    ],
  );

  return (
    <div
      className="relative w-full max-w-3xl mx-auto"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="chat-input-box flex flex-col rounded-2xl border transition-all duration-200 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:shadow-md focus-within:shadow-lg">
        <div className="flex flex-col px-3 pt-3 pb-2 gap-2">
          {/* Attached Files Preview */}
          {attachedFiles.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2 px-1">
              {attachedFiles.map((file) => {
                const fileInfo = getFileTypeInfo(file.file.name);
                const FileIcon = fileInfo.icon;
                return (
                  <div
                    key={file.id}
                    className="relative group flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 transition-all hover:border-slate-300 dark:hover:border-slate-500"
                  >
                    {file.type === 'image' && file.preview ? (
                      <img
                        src={file.preview}
                        alt={file.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full p-2 flex flex-col">
                        <div
                          className={`flex items-center justify-center w-full h-10 rounded-lg ${fileInfo.bgColor}`}
                        >
                          <FileIcon className={`w-5 h-5 ${fileInfo.color}`} />
                        </div>
                        <div className="flex-1 flex flex-col justify-end mt-1">
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                            {file.file.name.split('.').pop()}
                          </span>
                          <p
                            className="text-[10px] font-medium text-slate-700 dark:text-slate-300 truncate"
                            title={file.file.name}
                          >
                            {file.file.name.split('.').slice(0, -1).join('.')}
                          </p>
                          <p className="text-[9px] text-slate-400 dark:text-slate-500">
                            {formatFileSize(file.file.size)}
                          </p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => removeFile(file.id)}
                      className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Contenteditable Input */}
          <div className="max-h-48 w-full overflow-y-auto">
            <div
              ref={inputRef}
              contentEditable
              onInput={handleInputChange}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              data-placeholder={t('chat.placeholder')}
              className="chat-input-editable w-full border-0 outline-none text-base py-0 leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none"
              style={{
                minHeight: '1.5em',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            />
          </div>

          {/* Action Bar */}
          <div className="flex gap-2 w-full items-center">
            <div className="flex-1 flex items-center gap-1">
              {/* Attach file button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95"
              >
                <Plus className="w-5 h-5" />
              </button>

              {/* Tools popover */}
              {(onResearch || onAgentSelect || voiceChatAvailable) && (
                <div className="relative" ref={toolsMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowToolsMenu((v) => !v)}
                    className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                      showToolsMenu
                        ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                    } active:scale-95`}
                  >
                    <Settings2 className="w-4 h-4" />
                    <span>{t('chat.tools', 'Tools')}</span>
                  </button>

                  {showToolsMenu && (
                    <ToolsMenuPopover
                      onResearch={onResearch ? () => undefined : undefined}
                      researchMode={researchMode}
                      onAgentSelect={onAgentSelect}
                      selectedAgent={selectedAgent}
                      agents={agents}
                      voiceChatAvailable={voiceChatAvailable}
                      voiceChatMode={voiceChatMode}
                      selectedVoiceModel={selectedVoiceModel}
                      onVoiceModelSelect={onVoiceModelSelect}
                      onVoiceChatDisable={handleNovaSonicDisable}
                      onResearchToggle={() => setResearchMode(!researchMode)}
                      messagesLength={messagesLength}
                      onAgentClick={onAgentClick}
                      onClose={() => setShowToolsMenu(false)}
                      onPendingAgentChange={(val) => setPendingAgentChange(val)}
                      onShowRemoveAgentConfirm={() =>
                        setShowRemoveAgentConfirm(true)
                      }
                      setNovaSonicMode={setNovaSonicMode}
                      setResearchMode={setResearchMode}
                      onVoiceChatDisconnect={onVoiceChatDisconnect}
                    />
                  )}
                </div>
              )}

              {/* Selected tool chips */}
              {(researchMode || selectedAgent || voiceChatMode) && (
                <>
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                  {researchMode && onResearch && (
                    <button
                      type="button"
                      onClick={handleResearchDisable}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 transition-colors"
                    >
                      <Search className="w-3.5 h-3.5" />
                      {t('chat.research')}
                      <X className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  )}
                  {selectedAgent && onAgentSelect && (
                    <button
                      type="button"
                      onClick={() => {
                        if (messagesLength > 0) {
                          setPendingAgentChange(null);
                          setShowRemoveAgentConfirm(true);
                        } else {
                          onAgentSelect(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {selectedAgent.name}
                      <X className="w-3.5 h-3.5 ml-0.5 opacity-60 hover:opacity-100" />
                    </button>
                  )}
                  {voiceChatMode && (
                    <button
                      type="button"
                      onClick={handleNovaSonicDisable}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/40 transition-colors"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      {selectedVoiceModel === 'nova_sonic'
                        ? 'Nova Sonic'
                        : selectedVoiceModel === 'gemini'
                          ? 'Gemini'
                          : selectedVoiceModel === 'openai'
                            ? 'OpenAI'
                            : t('voiceChat.title')}
                      <X className="w-3.5 h-3.5 ml-0.5 opacity-60 hover:opacity-100" />
                    </button>
                  )}
                </>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!hasContent || sending}
              type="button"
              className={`inline-flex items-center justify-center h-8 w-8 rounded-xl transition-all active:scale-95 ${
                hasContent && !sending
                  ? voiceChatMode
                    ? 'bg-purple-500 hover:bg-purple-600 text-white shadow-md'
                    : researchMode
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-md'
                      : 'bg-blue-500 hover:bg-blue-600 text-white shadow-md'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
            >
              {sending ? (
                <svg
                  className="w-4 h-4 animate-spin"
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
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mention Dropdown */}
      {showMentionDropdown &&
        (filteredArtifacts.length > 0 || filteredDocuments.length > 0) && (
          <div
            ref={mentionDropdownRef}
            className="absolute bottom-full left-0 mb-2 w-72 max-h-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden"
          >
            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setMentionTab('artifacts');
                  setSelectedMentionIndex(0);
                }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  mentionTab === 'artifacts'
                    ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-500'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t('chat.artifacts', 'Artifacts')} ({filteredArtifacts.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setMentionTab('documents');
                  setSelectedMentionIndex(0);
                }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  mentionTab === 'documents'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t('chat.documents', 'Documents')} ({filteredDocuments.length})
              </button>
            </div>

            {/* Tab hint */}
            <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {t('chat.tabToSwitch', 'Press Tab to switch')}
              </span>
            </div>

            {/* Content */}
            <div className="max-h-44 overflow-y-auto">
              {mentionTab === 'artifacts' ? (
                filteredArtifacts.length > 0 ? (
                  filteredArtifacts.slice(0, 10).map((artifact, index) => (
                    <button
                      key={artifact.artifact_id}
                      type="button"
                      data-mention-index={index}
                      onClick={() => handleArtifactSelect(artifact)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        index === selectedMentionIndex
                          ? 'bg-violet-50 dark:bg-violet-900/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-center justify-center w-7 h-7 rounded bg-violet-100 dark:bg-violet-900/40">
                        <svg
                          className="w-4 h-4 text-violet-500 dark:text-violet-400"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
                          <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
                          <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                          {artifact.filename}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {artifact.content_type}
                        </p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                    {t('chat.noArtifacts', 'No artifacts found')}
                  </div>
                )
              ) : filteredDocuments.length > 0 ? (
                filteredDocuments.slice(0, 10).map((doc, index) => (
                  <button
                    key={doc.document_id}
                    type="button"
                    data-mention-index={index}
                    onClick={() => handleDocumentSelect(doc)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      index === selectedMentionIndex
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded bg-blue-100 dark:bg-blue-900/40">
                      <FileText className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                        {doc.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {doc.file_type}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                  {t('chat.noDocuments', 'No documents found')}
                </div>
              )}
            </div>
          </div>
        )}

      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50/90 dark:bg-blue-900/30 border-2 border-dashed border-blue-500 rounded-2xl z-50 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none">
          <Archive className="w-10 h-10 text-blue-500 mb-2 animate-bounce" />
          <p className="text-blue-600 dark:text-blue-400 font-medium">
            {t('documents.dropHere')}
          </p>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.csv,.doc,.docx,.xls,.xlsx,.html,.txt,.md"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
