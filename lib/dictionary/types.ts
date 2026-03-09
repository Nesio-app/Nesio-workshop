// Top 10 languages by number of speakers (native + L2)
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese (Mandarin)' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

export interface LookupResult {
  term: string;
  definition: string;
  imageUrl: string | null;
  examples: { target: string; native: string }[];
  usageNote: string;
  nativeLang: LangCode;
  targetLang: LangCode;
}

export interface NotebookEntry {
  id: string;
  savedAt: number;
  result: LookupResult;
}

export interface StoryResult {
  story: string;
  highlightedTerms: string[];
}
