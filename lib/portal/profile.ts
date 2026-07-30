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
  // 批次200:身份字段(名字/头像)最后修改时刻 —— 跨端 profile 同步的 last-write-wins 依据。
  identityUpdatedAt: 'treasurebox-profile-updated-at',
} as const;

export const PROFILE_UPDATED_EVENT = 'treasurebox-profile-updated';

/** 批次200:本地身份(名字/头像/语言/教练/日报)最后修改时刻(ISO)。跨端同步比对用,无 → ''。 */
export function profileIdentityUpdatedAt(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(KEYS.identityUpdatedAt) || ''; } catch { return ''; }
}

/** 批次205:主题在 saveProfileSettings 之外单存(AppearanceSheet 的 treasurebox-theme),
 *  改主题时调此把 profile LWW 时间戳打新 + 广播,让自动回推与别端拉取生效。 */
export function touchProfileIdentity(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEYS.identityUpdatedAt, new Date().toISOString());
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
  } catch { /* ignore */ }
}

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
    return { displayName: fallbackName, avatarUrl: '', avatarStoragePath: '', locale: 'zh', coachStyle: 'warm', dailyReportEnabled: true };
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
      // 2026-07-30 用户拍板:每日日报**默认开**。
      // 判据写成 !== '0' 而不是 === '1' —— 差别在**明确关过的人**:
      //   · 从没设过(null)→ 开(新默认)
      //   · 设过 '1' → 开
      //   · 设过 '0' → **关**(他亲手关的,不许被新默认覆盖回来)
      // 写成 === '1' 的话老用户全都是关的,「默认开」等于没生效;
      // 写成 `raw !== '0'` 之外的任何宽松写法都会把「亲手关掉」这个决定抹掉。
      dailyReportEnabled: localStorage.getItem(KEYS.dailyReportEnabled) !== '0',
    };
  } catch {
    return { displayName: fallbackName, avatarUrl: '', avatarStoragePath: '', locale: 'zh', coachStyle: 'warm', dailyReportEnabled: true };
  }
}

export function saveProfileSettings(
  patch: Partial<PortalProfileSettings>,
  // 批次200:cloud-apply 时传云端 updatedAt,避免刚拉回就被当成本地新改反推(乒乓)。
  opts?: { identityUpdatedAt?: string },
) {
  if (typeof window === 'undefined') return;
  try {
    // 身份 last-write-wins:只在名字 / 头像 storagePath **实际变化**时更新时间戳。
    // 刻意排除「只改 avatarUrl」—— 那是签名 URL 刷新(useProfileAvatar 定期换签),非用户编辑,
    // 若也算「新改」会让每次刷新都误判本地更新 → 跨端乒乓。
    const prevName = localStorage.getItem(KEYS.displayName) || '';
    const prevPath = localStorage.getItem(KEYS.avatarStoragePath) || '';
    const prevLocale = localStorage.getItem(KEYS.locale) || '';
    const prevCoach = localStorage.getItem(KEYS.coachStyle) || '';
    const prevDaily = localStorage.getItem(KEYS.dailyReportEnabled) || '';
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
    // 批次200/205:profile LWW 时间戳 —— 名字/头像/语言/教练风格/日报开关**实际变化**时更新。
    // 排除「只改 avatarUrl」(签名 URL 刷新,非用户编辑,否则跨端乒乓)。
    const nameChanged = patch.displayName !== undefined && (patch.displayName.trim() || '我') !== prevName;
    const pathChanged = patch.avatarStoragePath !== undefined && (patch.avatarStoragePath || '') !== prevPath;
    const localeChanged = patch.locale !== undefined && patch.locale !== prevLocale;
    const coachChanged = patch.coachStyle !== undefined && patch.coachStyle !== prevCoach;
    const dailyChanged = patch.dailyReportEnabled !== undefined && (patch.dailyReportEnabled ? '1' : '0') !== prevDaily;
    if (nameChanged || pathChanged || localeChanged || coachChanged || dailyChanged) {
      localStorage.setItem(KEYS.identityUpdatedAt, opts?.identityUpdatedAt || new Date().toISOString());
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
