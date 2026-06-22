const PROVIDER_ACTION_COPY = {
  flomoRecorded: {
    zh: '已记录',
    en: 'Recorded',
  },
};

export function providerActionCopy(key, locale = 'zh') {
  const entry = PROVIDER_ACTION_COPY[key];
  if (!entry) return key;
  return entry[locale] || entry.zh || key;
}

