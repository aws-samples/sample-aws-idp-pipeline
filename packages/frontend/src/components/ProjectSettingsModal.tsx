import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';

export interface Project {
  project_id: string;
  name: string;
  description: string;
  status: string;
  created_by?: string | null;
  language: string | null;
  color: number | null;
  document_prompt?: string | null;
  ocr_model?: string | null;
  ocr_options?: Record<string, unknown> | null;
  started_at?: string;
  created_at?: string;
  updated_at?: string | null;
  ended_at?: string | null;
}

const OCR_MODELS = [
  {
    value: 'paddleocr-vl',
    hasLangOption: false,
    hasOptions: false,
  },
  {
    value: 'pp-ocrv5',
    hasLangOption: true,
    hasOptions: true,
  },
  {
    value: 'pp-structurev3',
    hasLangOption: true,
    hasOptions: true,
  },
];

const OCR_LANGUAGES = [
  { code: '', name: 'Default (Not specified)' },
  { code: 'ch', name: 'Chinese & English' },
  { code: 'en', name: 'English' },
  { code: 'korean', name: 'Korean' },
  { code: 'japan', name: 'Japanese' },
  { code: 'chinese_cht', name: 'Chinese Traditional' },
  { code: 'french', name: 'French' },
  { code: 'german', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'ms', name: 'Malay' },
  { code: 'id', name: 'Indonesian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'latin', name: 'Latin (Multi-language)' },
  { code: 'arabic', name: 'Arabic Script (Multi-language)' },
  { code: 'cyrillic', name: 'Cyrillic Script (Multi-language)' },
  { code: 'devanagari', name: 'Devanagari Script (Multi-language)' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ne', name: 'Nepali' },
  { code: 'bn', name: 'Bengali' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'fa', name: 'Persian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'he', name: 'Hebrew' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'sw', name: 'Swahili' },
];

export const LANGUAGES = [
  { code: 'ko', name: 'Korean', flag: 'KR' },
  { code: 'ja', name: 'Japanese', flag: 'JP' },
  { code: 'zh', name: 'Chinese', flag: 'CN' },
  { code: 'zh-tw', name: 'Chinese (Traditional)', flag: 'TW' },
  { code: 'en', name: 'English', flag: 'US' },
  { code: 'fr', name: 'French', flag: 'FR' },
  { code: 'de', name: 'German', flag: 'DE' },
  { code: 'it', name: 'Italian', flag: 'IT' },
  { code: 'es', name: 'Spanish', flag: 'ES' },
  { code: 'pt', name: 'Portuguese', flag: 'PT' },
  { code: 'nl', name: 'Dutch', flag: 'NL' },
  { code: 'pl', name: 'Polish', flag: 'PL' },
  { code: 'ru', name: 'Russian', flag: 'RU' },
  { code: 'uk', name: 'Ukrainian', flag: 'UA' },
  { code: 'cs', name: 'Czech', flag: 'CZ' },
  { code: 'hu', name: 'Hungarian', flag: 'HU' },
  { code: 'ro', name: 'Romanian', flag: 'RO' },
  { code: 'bg', name: 'Bulgarian', flag: 'BG' },
  { code: 'sv', name: 'Swedish', flag: 'SE' },
  { code: 'no', name: 'Norwegian', flag: 'NO' },
  { code: 'da', name: 'Danish', flag: 'DK' },
  { code: 'fi', name: 'Finnish', flag: 'FI' },
  { code: 'vi', name: 'Vietnamese', flag: 'VN' },
  { code: 'th', name: 'Thai', flag: 'TH' },
  { code: 'id', name: 'Indonesian', flag: 'ID' },
  { code: 'ms', name: 'Malay', flag: 'MY' },
  { code: 'tl', name: 'Tagalog', flag: 'PH' },
  { code: 'hi', name: 'Hindi', flag: 'IN' },
  { code: 'bn', name: 'Bengali', flag: 'BD' },
  { code: 'ne', name: 'Nepali', flag: 'NP' },
  { code: 'ar', name: 'Arabic', flag: 'SA' },
  { code: 'fa', name: 'Persian', flag: 'IR' },
  { code: 'tr', name: 'Turkish', flag: 'TR' },
  { code: 'he', name: 'Hebrew', flag: 'IL' },
  { code: 'mn', name: 'Mongolian', flag: 'MN' },
  { code: 'sw', name: 'Swahili', flag: 'KE' },
];

export const CARD_COLORS = [
  {
    border: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.15)',
    back: '#3b82f6',
    tab: '#2563eb',
    front: '#60a5fa',
  },
  {
    border: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.15)',
    back: '#8b5cf6',
    tab: '#7c3aed',
    front: '#a78bfa',
  },
  {
    border: '#10b981',
    glow: 'rgba(16, 185, 129, 0.15)',
    back: '#10b981',
    tab: '#059669',
    front: '#34d399',
  },
  {
    border: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.15)',
    back: '#f59e0b',
    tab: '#d97706',
    front: '#fbbf24',
  },
  {
    border: '#ec4899',
    glow: 'rgba(236, 72, 153, 0.15)',
    back: '#ec4899',
    tab: '#db2777',
    front: '#f472b6',
  },
  {
    border: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.15)',
    back: '#06b6d4',
    tab: '#0891b2',
    front: '#22d3ee',
  },
  {
    border: '#6366f1',
    glow: 'rgba(99, 102, 241, 0.15)',
    back: '#6366f1',
    tab: '#4f46e5',
    front: '#818cf8',
  },
  {
    border: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.15)',
    back: '#ef4444',
    tab: '#dc2626',
    front: '#f87171',
  },
];

interface FormData {
  name: string;
  description: string;
  language: string;
  color: number;
}

interface AdvancedSettings {
  ocr_model: string;
  ocr_lang: string;
  use_doc_orientation_classify: boolean;
  use_doc_unwarping: boolean;
  use_textline_orientation: boolean;
  document_prompt: string;
}

interface ProjectSettingsModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description: string;
    language: string;
    color: number;
    document_prompt: string;
    ocr_model: string;
    ocr_options: Record<string, unknown>;
  }) => Promise<void>;
  isCreating?: boolean;
}

export default function ProjectSettingsModal({
  project,
  isOpen,
  onClose,
  onSave,
  isCreating = false,
}: ProjectSettingsModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [showOcrAccordion, setShowOcrAccordion] = useState(true);
  const [showInstructionsAccordion, setShowInstructionsAccordion] =
    useState(false);

  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    language: 'en',
    color: 0,
  });

  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>({
    ocr_model: 'paddleocr-vl',
    ocr_lang: '',
    use_doc_orientation_classify: false,
    use_doc_unwarping: false,
    use_textline_orientation: false,
    document_prompt: '',
  });

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name,
        description: project.description || '',
        language: project.language || 'en',
        color: project.color ?? 0,
      });
      const ocrOptions = project.ocr_options || {};
      setAdvancedSettings({
        ocr_model: project.ocr_model || 'paddleocr-vl',
        ocr_lang: (ocrOptions.lang as string) || '',
        use_doc_orientation_classify:
          (ocrOptions.use_doc_orientation_classify as boolean) || false,
        use_doc_unwarping: (ocrOptions.use_doc_unwarping as boolean) || false,
        use_textline_orientation:
          (ocrOptions.use_textline_orientation as boolean) || false,
        document_prompt: project.document_prompt || '',
      });
    } else {
      setFormData({
        name: '',
        description: '',
        language: 'en',
        color: 0,
      });
      setAdvancedSettings({
        ocr_model: 'paddleocr-vl',
        ocr_lang: '',
        use_doc_orientation_classify: false,
        use_doc_unwarping: false,
        use_textline_orientation: false,
        document_prompt: '',
      });
    }
    setShowAdvancedModal(false);
  }, [project, isOpen]);

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    setSaving(true);
    try {
      await onSave({
        name: formData.name.trim(),
        description: formData.description.trim(),
        language: formData.language,
        color: formData.color,
        document_prompt: advancedSettings.document_prompt,
        ocr_model: advancedSettings.ocr_model,
        ocr_options: {
          lang: advancedSettings.ocr_lang || undefined,
          use_doc_orientation_classify:
            advancedSettings.use_doc_orientation_classify || undefined,
          use_doc_unwarping: advancedSettings.use_doc_unwarping || undefined,
          use_textline_orientation:
            advancedSettings.use_textline_orientation || undefined,
        },
      });
      onClose();
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalColor = CARD_COLORS[formData.color] || CARD_COLORS[0];

  return (
    <div className="bento-modal-overlay">
      <div
        className="bento-modal"
        style={
          {
            width: showAdvancedModal ? '1000px' : '500px',
            '--modal-glow-color': modalColor.border,
          } as React.CSSProperties
        }
      >
        {/* Main Panel */}
        <div
          className={`bento-modal-main ${showAdvancedModal ? 'with-advanced' : ''}`}
        >
          <h2 className="bento-modal-title">
            {isCreating
              ? t('projects.createProject')
              : t('projects.editProject')}
          </h2>

          <div className="bento-modal-form">
            {project && !isCreating && (
              <div className="bento-form-group">
                <label className="bento-form-label">
                  {t('projects.projectId')}
                </label>
                <div className="bento-form-readonly">{project.project_id}</div>
              </div>
            )}

            <div className="bento-form-group">
              <label className="bento-form-label">
                {t('projects.projectName')}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={t('projects.projectNamePlaceholder')}
                className="bento-form-input"
              />
            </div>

            <div className="bento-form-group">
              <label className="bento-form-label">
                {t('projects.description')}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    description: e.target.value,
                  })
                }
                placeholder={t('projects.descriptionPlaceholder')}
                rows={3}
                className="bento-form-textarea"
              />
            </div>

            <div className="bento-form-group">
              <label className="bento-form-label">
                {t('common.language')}
                <span className="bento-tooltip-wrapper">
                  <Info className="bento-tooltip-icon" size={14} />
                  <span className="bento-tooltip">
                    {t('projects.languageTooltip')}
                  </span>
                </span>
              </label>
              <select
                value={formData.language}
                onChange={(e) =>
                  setFormData({ ...formData, language: e.target.value })
                }
                className="bento-form-select"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {t(`languages.${lang.code}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="bento-form-group">
              <label className="bento-form-label">
                {t('projects.folderColor')}
              </label>
              <div className="bento-color-picker">
                {CARD_COLORS.map((color, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setFormData({ ...formData, color: index })}
                    className={`bento-color-option ${
                      formData.color === index ? 'active' : ''
                    }`}
                    style={{ background: color.border }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="bento-modal-footer">
            <button
              type="button"
              onClick={() => setShowAdvancedModal(!showAdvancedModal)}
              className={`bento-btn-advanced ${showAdvancedModal ? 'active' : ''}`}
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {t('projects.advancedSettings')}
              <svg
                className={`w-4 h-4 transition-transform ${showAdvancedModal ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
            <div className="bento-modal-actions">
              <button onClick={onClose} className="bento-btn-cancel">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name.trim() || saving}
                className="bento-btn-save"
              >
                {saving
                  ? t('common.saving')
                  : isCreating
                    ? t('common.create')
                    : t('common.save')}
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Settings Panel */}
        {showAdvancedModal && (
          <div className="bento-modal-advanced">
            <h3 className="bento-modal-advanced-title">
              {t('projects.advancedSettings')}
            </h3>

            <div className="bento-accordion">
              {/* OCR Settings */}
              <div className="bento-accordion-item">
                <button
                  type="button"
                  onClick={() => setShowOcrAccordion(!showOcrAccordion)}
                  className="bento-accordion-header"
                >
                  <span>{t('ocr.title')}</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${showOcrAccordion ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {showOcrAccordion && (
                  <div className="bento-accordion-content">
                    <div className="bento-form-group">
                      <label className="bento-form-label">
                        {t('ocr.model')}
                      </label>
                      <div className="bento-radio-group">
                        {OCR_MODELS.map((model) => (
                          <label
                            key={model.value}
                            className={`bento-radio-option ${
                              advancedSettings.ocr_model === model.value
                                ? 'active'
                                : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name="ocr_model"
                              value={model.value}
                              checked={
                                advancedSettings.ocr_model === model.value
                              }
                              onChange={(e) =>
                                setAdvancedSettings({
                                  ...advancedSettings,
                                  ocr_model: e.target.value,
                                  ...(e.target.value === 'paddleocr-vl'
                                    ? {
                                        ocr_lang: '',
                                        use_doc_orientation_classify: false,
                                        use_doc_unwarping: false,
                                        use_textline_orientation: false,
                                      }
                                    : {}),
                                })
                              }
                            />
                            <div>
                              <div className="bento-radio-label">
                                {t(`ocr.models.${model.value}.name`)}
                              </div>
                              <div className="bento-radio-desc">
                                {t(`ocr.models.${model.value}.description`)}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {OCR_MODELS.find(
                      (m) => m.value === advancedSettings.ocr_model,
                    )?.hasLangOption && (
                      <div className="bento-form-group">
                        <label className="bento-form-label">
                          {t('ocr.language')}
                          <span className="bento-tooltip-wrapper">
                            <Info className="bento-tooltip-icon" size={14} />
                            <span className="bento-tooltip">
                              {t('ocr.languageTooltip')}
                            </span>
                          </span>
                        </label>
                        <select
                          value={advancedSettings.ocr_lang}
                          onChange={(e) =>
                            setAdvancedSettings({
                              ...advancedSettings,
                              ocr_lang: e.target.value,
                            })
                          }
                          className="bento-form-select"
                        >
                          {OCR_LANGUAGES.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                              {lang.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {OCR_MODELS.find(
                      (m) => m.value === advancedSettings.ocr_model,
                    )?.hasOptions && (
                      <div className="bento-form-group">
                        <label className="bento-form-label">
                          {t('ocr.processingOptions')}
                        </label>
                        <div className="bento-checkbox-group">
                          <label className="bento-checkbox-option">
                            <input
                              type="checkbox"
                              checked={
                                advancedSettings.use_doc_orientation_classify
                              }
                              onChange={(e) =>
                                setAdvancedSettings({
                                  ...advancedSettings,
                                  use_doc_orientation_classify:
                                    e.target.checked,
                                })
                              }
                            />
                            <div>
                              <div className="bento-checkbox-label">
                                {t('ocr.documentOrientation')}
                              </div>
                              <div className="bento-checkbox-desc">
                                {t('ocr.documentOrientationDesc')}
                              </div>
                            </div>
                          </label>

                          <label className="bento-checkbox-option">
                            <input
                              type="checkbox"
                              checked={advancedSettings.use_doc_unwarping}
                              onChange={(e) =>
                                setAdvancedSettings({
                                  ...advancedSettings,
                                  use_doc_unwarping: e.target.checked,
                                })
                              }
                            />
                            <div>
                              <div className="bento-checkbox-label">
                                {t('ocr.documentUnwarping')}
                              </div>
                              <div className="bento-checkbox-desc">
                                {t('ocr.documentUnwarpingDesc')}
                              </div>
                            </div>
                          </label>

                          {advancedSettings.ocr_model === 'pp-ocrv5' && (
                            <label className="bento-checkbox-option">
                              <input
                                type="checkbox"
                                checked={
                                  advancedSettings.use_textline_orientation
                                }
                                onChange={(e) =>
                                  setAdvancedSettings({
                                    ...advancedSettings,
                                    use_textline_orientation: e.target.checked,
                                  })
                                }
                              />
                              <div>
                                <div className="bento-checkbox-label">
                                  {t('ocr.textlineOrientation')}
                                </div>
                                <div className="bento-checkbox-desc">
                                  {t('ocr.textlineOrientationDesc')}
                                </div>
                              </div>
                            </label>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Document Analysis Instructions */}
              <div className="bento-accordion-item">
                <button
                  type="button"
                  onClick={() =>
                    setShowInstructionsAccordion(!showInstructionsAccordion)
                  }
                  className="bento-accordion-header"
                >
                  <span>{t('analysis.title')}</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${
                      showInstructionsAccordion ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {showInstructionsAccordion && (
                  <div className="bento-accordion-content">
                    <textarea
                      value={advancedSettings.document_prompt}
                      onChange={(e) =>
                        setAdvancedSettings({
                          ...advancedSettings,
                          document_prompt: e.target.value,
                        })
                      }
                      placeholder={t('analysis.placeholder')}
                      rows={6}
                      className="bento-form-textarea"
                    />
                    <p className="bento-form-hint">{t('analysis.hint')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
