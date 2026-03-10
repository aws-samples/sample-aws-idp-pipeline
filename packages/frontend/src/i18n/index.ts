import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';

const resources = {
  ko: { translation: ko },
  en: { translation: en },
  ja: { translation: ja },
};

const LANGUAGE_KEY = 'i18nextLng';
const SUPPORTED_LANGS = ['ko', 'en', 'ja'];

if (!localStorage.getItem(LANGUAGE_KEY)) {
  const browserLang = navigator.language.split('-')[0];
  const detected = SUPPORTED_LANGS.includes(browserLang) ? browserLang : 'en';
  localStorage.setItem(LANGUAGE_KEY, detected);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    lng: localStorage.getItem(LANGUAGE_KEY) || 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_KEY,
    },
  });

export default i18n;
