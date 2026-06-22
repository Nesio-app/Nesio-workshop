export type QuoteLocale = 'zh' | 'en';

export declare const QUOTE_URL: string;
export declare const MAX_QUOTE_LENGTH: number;
export declare const BLOCKED_TERMS: readonly string[];
export declare const POSITIVE_TERMS: readonly string[];
export declare const POSITIVE_FALLBACK_QUOTES_BY_LOCALE: Record<QuoteLocale, readonly string[]>;

export declare function normalizeQuoteLocale(value: string | null | undefined): QuoteLocale;
export declare function isPositiveEnough(quote: string): boolean;
export declare function fallbackQuote(locale: QuoteLocale): string;
