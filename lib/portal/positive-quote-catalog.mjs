export const QUOTE_URL = 'https://v1.hitokoto.cn/?c=i&c=k&encode=json';

export const MAX_QUOTE_LENGTH = 140;

export const BLOCKED_TERMS = [
  '死',
  '亡',
  '病',
  '杀',
  '恨',
  '愁',
  '悲',
  '伤',
  '泪',
  '孤',
  '墓',
  '沙场',
  '马革',
  '离别',
  '断肠',
  '并无新事',
];

export const POSITIVE_TERMS = [
  '希望',
  '勇气',
  '温柔',
  '平安',
  '安心',
  '晴',
  '春',
  '花',
  '笑',
  '爱',
  '光明',
  '成长',
  '梦想',
  '前进',
  '稳',
  '允许',
  '变好',
  '完成',
  '路上',
  '一点点',
];

export const POSITIVE_FALLBACK_QUOTES_BY_LOCALE = {
  zh: [
    '你已经在路上了，今天只需要再往前一点点。',
    '慢一点，深一点，稳一点。',
    '先完成一个小闭环，再决定下一件事。',
    '允许自己慢慢来，也允许事情变好。',
    '把复杂留给系统，把下一步留给自己。',
  ],
  en: [
    'You are not behind. You are growing at your own rhythm.',
    'Start with the smallest honest step.',
    'Let today be steady, not perfect.',
    'You can move gently and still move forward.',
    'Keep the next step simple enough to begin.',
  ],
};

export function normalizeQuoteLocale(value) {
  return value === 'en' ? 'en' : 'zh';
}

export function isPositiveEnough(quote) {
  if (BLOCKED_TERMS.some((term) => quote.includes(term))) return false;
  return POSITIVE_TERMS.some((term) => quote.includes(term));
}

export function fallbackQuote(locale) {
  const normalized = normalizeQuoteLocale(locale);
  const quotes = POSITIVE_FALLBACK_QUOTES_BY_LOCALE[normalized];
  return quotes[Math.floor(Math.random() * quotes.length)];
}
