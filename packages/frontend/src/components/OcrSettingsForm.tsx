import { useTranslation } from 'react-i18next';

export const OCR_MODELS = [
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

export const OCR_LANGUAGES = [
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

export interface OcrSettings {
  ocr_model: string;
  ocr_lang: string;
  use_doc_orientation_classify: boolean;
  use_doc_unwarping: boolean;
  use_textline_orientation: boolean;
}

interface OcrSettingsFormProps {
  settings: OcrSettings;
  onChange: (settings: OcrSettings) => void;
  variant?: 'bento' | 'compact';
}

export default function OcrSettingsForm({
  settings,
  onChange,
  variant = 'bento',
}: OcrSettingsFormProps) {
  const { t } = useTranslation();

  const isBento = variant === 'bento';

  const selectedModel = OCR_MODELS.find((m) => m.value === settings.ocr_model);

  return (
    <div className={isBento ? undefined : 'space-y-4'}>
      {/* OCR Model */}
      <div className={isBento ? 'bento-form-group' : 'space-y-2'}>
        <label
          className={
            isBento
              ? 'bento-form-label'
              : 'block text-sm font-medium text-slate-700 dark:text-slate-300'
          }
        >
          {t('ocr.model')}
        </label>
        <div className={isBento ? 'bento-radio-group' : 'space-y-1.5'}>
          {OCR_MODELS.map((model) => (
            <label
              key={model.value}
              className={
                isBento
                  ? `bento-radio-option ${settings.ocr_model === model.value ? 'active' : ''}`
                  : `flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                      settings.ocr_model === model.value
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`
              }
            >
              <input
                type="radio"
                name="ocr_model"
                value={model.value}
                checked={settings.ocr_model === model.value}
                onChange={(e) =>
                  onChange({
                    ...settings,
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
                className={isBento ? undefined : 'mt-0.5'}
              />
              <div>
                <div
                  className={
                    isBento
                      ? 'bento-radio-label'
                      : 'text-sm font-medium text-slate-700 dark:text-slate-300'
                  }
                >
                  {t(`ocr.models.${model.value}.name`)}
                </div>
                <div
                  className={
                    isBento
                      ? 'bento-radio-desc'
                      : 'text-xs text-slate-500 dark:text-slate-400'
                  }
                >
                  {t(`ocr.models.${model.value}.description`)}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Language */}
      {selectedModel?.hasLangOption && (
        <div className={isBento ? 'bento-form-group' : 'space-y-2'}>
          <label
            className={
              isBento
                ? 'bento-form-label'
                : 'block text-sm font-medium text-slate-700 dark:text-slate-300'
            }
          >
            {t('ocr.language')}
          </label>
          <select
            value={settings.ocr_lang}
            onChange={(e) =>
              onChange({ ...settings, ocr_lang: e.target.value })
            }
            className={
              isBento
                ? 'bento-form-select'
                : 'w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
            }
          >
            {OCR_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Processing Options */}
      {selectedModel?.hasOptions && (
        <div className={isBento ? 'bento-form-group' : 'space-y-2'}>
          <label
            className={
              isBento
                ? 'bento-form-label'
                : 'block text-sm font-medium text-slate-700 dark:text-slate-300'
            }
          >
            {t('ocr.processingOptions')}
          </label>
          <div className={isBento ? 'bento-checkbox-group' : 'space-y-1.5'}>
            <label
              className={
                isBento
                  ? 'bento-checkbox-option'
                  : 'flex items-start gap-2 cursor-pointer'
              }
            >
              <input
                type="checkbox"
                checked={settings.use_doc_orientation_classify}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    use_doc_orientation_classify: e.target.checked,
                  })
                }
                className={isBento ? undefined : 'mt-0.5'}
              />
              <div>
                <div
                  className={
                    isBento
                      ? 'bento-checkbox-label'
                      : 'text-sm text-slate-700 dark:text-slate-300'
                  }
                >
                  {t('ocr.documentOrientation')}
                </div>
                <div
                  className={
                    isBento
                      ? 'bento-checkbox-desc'
                      : 'text-xs text-slate-500 dark:text-slate-400'
                  }
                >
                  {t('ocr.documentOrientationDesc')}
                </div>
              </div>
            </label>

            <label
              className={
                isBento
                  ? 'bento-checkbox-option'
                  : 'flex items-start gap-2 cursor-pointer'
              }
            >
              <input
                type="checkbox"
                checked={settings.use_doc_unwarping}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    use_doc_unwarping: e.target.checked,
                  })
                }
                className={isBento ? undefined : 'mt-0.5'}
              />
              <div>
                <div
                  className={
                    isBento
                      ? 'bento-checkbox-label'
                      : 'text-sm text-slate-700 dark:text-slate-300'
                  }
                >
                  {t('ocr.documentUnwarping')}
                </div>
                <div
                  className={
                    isBento
                      ? 'bento-checkbox-desc'
                      : 'text-xs text-slate-500 dark:text-slate-400'
                  }
                >
                  {t('ocr.documentUnwarpingDesc')}
                </div>
              </div>
            </label>

            {settings.ocr_model === 'pp-ocrv5' && (
              <label
                className={
                  isBento
                    ? 'bento-checkbox-option'
                    : 'flex items-start gap-2 cursor-pointer'
                }
              >
                <input
                  type="checkbox"
                  checked={settings.use_textline_orientation}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      use_textline_orientation: e.target.checked,
                    })
                  }
                  className={isBento ? undefined : 'mt-0.5'}
                />
                <div>
                  <div
                    className={
                      isBento
                        ? 'bento-checkbox-label'
                        : 'text-sm text-slate-700 dark:text-slate-300'
                    }
                  >
                    {t('ocr.textlineOrientation')}
                  </div>
                  <div
                    className={
                      isBento
                        ? 'bento-checkbox-desc'
                        : 'text-xs text-slate-500 dark:text-slate-400'
                    }
                  >
                    {t('ocr.textlineOrientationDesc')}
                  </div>
                </div>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
