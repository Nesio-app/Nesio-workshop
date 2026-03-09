import { LANGUAGES, type LangCode } from './types';

export const langName = (code: LangCode): string =>
  LANGUAGES.find((l) => l.code === code)?.name ?? code;

// OpenAI TTS and language labels
export const TTS_LANG_MAP: Record<LangCode, string> = {
  en: 'en',
  zh: 'zh',
  hi: 'hi',
  es: 'es',
  fr: 'fr',
  ar: 'ar',
  bn: 'bn',
  pt: 'pt',
  ru: 'ru',
  ja: 'ja',
};
