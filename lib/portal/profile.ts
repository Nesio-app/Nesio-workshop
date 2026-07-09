import { reportStorageDropped } from './storage-health';

export const SUPPORTED_PORTAL_LOCALES = [
  'zh',
  'en',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'vi',
  'th',
] as const;

export type PortalLocale = (typeof SUPPORTED_PORTAL_LOCALES)[number];
export type PortalCoachStyle = 'minimal' | 'warm' | 'professional';

export const PORTAL_LOCALE_OPTIONS: ReadonlyArray<readonly [PortalLocale, string]> = Object.freeze([
  ['zh', '简体中文'],
  ['en', 'English'],
  ['zh-TW', '繁體中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['vi', 'Tiếng Việt'],
  ['th', 'ไทย'],
]);

export interface PortalProfileSettings {
  displayName: string;
  avatarUrl: string;
  avatarStoragePath: string;
  locale: PortalLocale;
  coachStyle: PortalCoachStyle;
  /** 每日 AI 图文日报:每天自动预生成 + 存记忆(默认关,设置里开)。 */
  dailyReportEnabled: boolean;
}

const KEYS = {
  avatar: 'treasurebox-profile-avatar',
  avatarStoragePath: 'treasurebox-profile-avatar-storage-path',
  displayName: 'treasurebox-profile-name',
  locale: 'treasurebox-locale',
  coachStyle: 'treasurebox-coach-style',
  dailyReportEnabled: 'nesio-daily-report-enabled',
} as const;

export const PROFILE_UPDATED_EVENT = 'treasurebox-profile-updated';

export function normalizePortalLocale(value: string | null | undefined): PortalLocale {
  return SUPPORTED_PORTAL_LOCALES.includes(value as PortalLocale) ? value as PortalLocale : 'zh';
}

export function portalLocaleToHtmlLang(locale: PortalLocale): string {
  return locale === 'zh' ? 'zh-CN' : locale;
}

export function portalLocaleToDictionaryLocale(locale: PortalLocale): 'zh' | 'en' {
  return locale === 'zh' || locale === 'zh-TW' ? 'zh' : 'en';
}

export function loadProfileSettings(fallbackName = '我'): PortalProfileSettings {
  if (typeof window === 'undefined') {
    return { displayName: fallbackName, avatarUrl: '', avatarStoragePath: '', locale: 'zh', coachStyle: 'warm', dailyReportEnabled: false };
  }
  try {
    const localeRaw = localStorage.getItem(KEYS.locale);
    const locale = normalizePortalLocale(localeRaw);
    const coachStyleRaw = localStorage.getItem(KEYS.coachStyle);
    const coachStyle: PortalCoachStyle =
      coachStyleRaw === 'minimal' || coachStyleRaw === 'professional' ? coachStyleRaw : 'warm';
    return {
      displayName: localStorage.getItem(KEYS.displayName) || fallbackName,
      avatarUrl: localStorage.getItem(KEYS.avatar) || '',
      avatarStoragePath: localStorage.getItem(KEYS.avatarStoragePath) || '',
      locale,
      coachStyle,
      dailyReportEnabled: localStorage.getItem(KEYS.dailyReportEnabled) === '1',
    };
  } catch {
    return { displayName: fallbackName, avatarUrl: '', avatarStoragePath: '', locale: 'zh', coachStyle: 'warm', dailyReportEnabled: false };
  }
}

export function saveProfileSettings(patch: Partial<PortalProfileSettings>) {
  if (typeof window === 'undefined') return;
  try {
    if (patch.displayName !== undefined) {
      localStorage.setItem(KEYS.displayName, patch.displayName.trim() || '我');
    }
    if (patch.avatarUrl !== undefined) {
      if (patch.avatarUrl) localStorage.setItem(KEYS.avatar, patch.avatarUrl);
      else localStorage.removeItem(KEYS.avatar);
    }
    if (patch.avatarStoragePath !== undefined) {
      if (patch.avatarStoragePath) localStorage.setItem(KEYS.avatarStoragePath, patch.avatarStoragePath);
      else localStorage.removeItem(KEYS.avatarStoragePath);
    }
    if (patch.locale !== undefined) {
      localStorage.setItem(KEYS.locale, patch.locale);
      document.documentElement.lang = portalLocaleToHtmlLang(patch.locale);
    }
    if (patch.coachStyle !== undefined) {
      localStorage.setItem(KEYS.coachStyle, patch.coachStyle);
    }
    if (patch.dailyReportEnabled !== undefined) {
      localStorage.setItem(KEYS.dailyReportEnabled, patch.dailyReportEnabled ? '1' : '0');
    }
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
  } catch { reportStorageDropped(); }
}

export function clearProfileIdentity() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEYS.displayName);
    localStorage.removeItem(KEYS.avatar);
    localStorage.removeItem(KEYS.avatarStoragePath);
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
  } catch { /* ignore */ }
}

export function readAvatarFile(file: File, maxBytes = 2_400_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('not image'));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error('too large'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
