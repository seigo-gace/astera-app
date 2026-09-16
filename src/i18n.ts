import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Astera's visible copy lives in the existing Text lists (APP_TEXT,
    // PLATFORM_TEXT, etc.). Keep one internal marker per supported language so
    // i18next can resolve `resolvedLanguage` correctly when those external
    // Text lists switch between Japanese and English.
    resources: {
      ja: { translation: { __asteraLanguage: 'ja' } },
      en: { translation: { __asteraLanguage: 'en' } },
    },
    fallbackLng: 'ja',
    supportedLngs: ['ja', 'en'],
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'astera-language',
    },
  });

export default i18n;
