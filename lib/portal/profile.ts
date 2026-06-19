export type PortalLocale = 'zh' | 'en';
export type PortalCoachStyle = 'minimal' | 'warm' | 'professional';

export interface PortalProfileSettings {
  displayName: string;
  avatarUrl: string;
  locale: PortalLocale;
  coachStyle: PortalCoachStyle;
}

const KEYS = {
  avatar: 'treasurebox-profile-avatar',
  displayName: 'treasurebox-profile-name',
  locale: 'treasurebox-locale',
  coachStyle: 'treasurebox-coach-style',
} as const;

export const PROFILE_UPDATED_EVENT = 'treasurebox-profile-updated';

export function loadProfileSettings(fallbackName = '婧'): PortalProfileSettings {
  if (typeof window === 'undefined') {
    return { displayName: fallbackName, avatarUrl: '', locale: 'zh', coachStyle: 'warm' };
  }
  try {
    const localeRaw = localStorage.getItem(KEYS.locale);
    const locale: PortalLocale = localeRaw === 'en' ? 'en' : 'zh';
    const coachStyleRaw = localStorage.getItem(KEYS.coachStyle);
    const coachStyle: PortalCoachStyle =
      coachStyleRaw === 'minimal' || coachStyleRaw === 'professional' ? coachStyleRaw : 'warm';
    return {
      displayName: localStorage.getItem(KEYS.displayName) || fallbackName,
      avatarUrl: localStorage.getItem(KEYS.avatar) || '',
      locale,
      coachStyle,
    };
  } catch {
    return { displayName: fallbackName, avatarUrl: '', locale: 'zh', coachStyle: 'warm' };
  }
}

export function saveProfileSettings(patch: Partial<PortalProfileSettings>) {
  if (typeof window === 'undefined') return;
  try {
    if (patch.displayName !== undefined) {
      localStorage.setItem(KEYS.displayName, patch.displayName.trim() || '婧');
    }
    if (patch.avatarUrl !== undefined) {
      if (patch.avatarUrl) localStorage.setItem(KEYS.avatar, patch.avatarUrl);
      else localStorage.removeItem(KEYS.avatar);
    }
    if (patch.locale !== undefined) {
      localStorage.setItem(KEYS.locale, patch.locale);
      document.documentElement.lang = patch.locale === 'en' ? 'en' : 'zh-CN';
    }
    if (patch.coachStyle !== undefined) {
      localStorage.setItem(KEYS.coachStyle, patch.coachStyle);
    }
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
