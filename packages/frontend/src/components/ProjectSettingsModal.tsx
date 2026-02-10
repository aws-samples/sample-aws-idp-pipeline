import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Hash, Type, AlignLeft, Globe, Palette } from 'lucide-react';
import OcrSettingsForm, { type OcrSettings } from './OcrSettingsForm';

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

interface AdvancedSettings extends OcrSettings {
  document_prompt: string;
}

type SectionKey = 'basic' | 'ocr' | 'instructions';

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
  const [activeSection, setActiveSection] = useState<SectionKey>('basic');

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
    setActiveSection('basic');
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

  const menuItems: { key: SectionKey; label: string; icon: React.ReactNode }[] =
    [
      {
        key: 'basic',
        label: t('projectSettings.basicSettings'),
        icon: (
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        ),
      },
      {
        key: 'ocr',
        label: t('projectSettings.ocrSettings'),
        icon: (
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
        ),
      },
      {
        key: 'instructions',
        label: t('projectSettings.analysisInstructions'),
        icon: (
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        ),
      },
    ];

  return (
    <div className="bento-modal-overlay">
      <div
        className="bento-modal"
        style={
          {
            width: '740px',
            height: '760px',
            '--modal-glow-color': modalColor.border,
          } as React.CSSProperties
        }
      >
        {/* Header */}
        <h2 className="bento-modal-title">
          {isCreating ? t('projects.createProject') : t('projects.editProject')}
        </h2>

        {/* Body: Side Menu + Content */}
        <div className="bento-settings-body">
          {/* Left Menu */}
          <nav className="bento-settings-nav">
            {menuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={`bento-settings-nav-item ${
                  activeSection === item.key ? 'active' : ''
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Right Content */}
          <div className="bento-settings-content">
            {activeSection === 'basic' && (
              <div className="bento-modal-form">
                {project && !isCreating && (
                  <div className="bento-form-group">
                    <label className="bento-form-label">
                      <Hash size={14} />
                      {t('projects.projectId')}
                    </label>
                    <div className="bento-form-readonly">
                      {project.project_id}
                    </div>
                  </div>
                )}

                <div className="bento-form-group">
                  <label className="bento-form-label">
                    <Type size={14} />
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
                    <AlignLeft size={14} />
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
                    <Globe size={14} />
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
                    <Palette size={14} />
                    {t('projects.folderColor')}
                  </label>
                  <div className="bento-color-picker">
                    {CARD_COLORS.map((color, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() =>
                          setFormData({ ...formData, color: index })
                        }
                        className={`bento-color-option ${
                          formData.color === index ? 'active' : ''
                        }`}
                        style={{ background: color.border }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'ocr' && (
              <div className="bento-modal-form">
                <OcrSettingsForm
                  settings={advancedSettings}
                  onChange={(ocrSettings) =>
                    setAdvancedSettings({
                      ...advancedSettings,
                      ...ocrSettings,
                    })
                  }
                  variant="bento"
                />
              </div>
            )}

            {activeSection === 'instructions' && (
              <div className="bento-modal-form">
                <div className="bento-form-group">
                  <label className="bento-form-label">
                    {t('analysis.title')}
                  </label>
                  <textarea
                    value={advancedSettings.document_prompt}
                    onChange={(e) =>
                      setAdvancedSettings({
                        ...advancedSettings,
                        document_prompt: e.target.value,
                      })
                    }
                    placeholder={t('analysis.placeholder')}
                    rows={12}
                    className="bento-form-textarea"
                  />
                  <p className="bento-form-hint">{t('analysis.hint')}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="bento-modal-footer"
          style={{ justifyContent: 'flex-end' }}
        >
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
    </div>
  );
}
