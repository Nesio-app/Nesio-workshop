'use client';

/**
 * usePortalLocale — 订阅个人资料语言设置的客户端 hook。
 * 与 MemoryTab/SettingsSheets 相同的 PROFILE_UPDATED_EVENT 机制:
 * 设置页切换语言 → saveProfileSettings 广播 → 各订阅组件即时切换。
 */

import { useEffect, useState } from 'react';
import {
  PROFILE_UPDATED_EVENT,
  loadProfileSettings,
  type PortalLocale,
} from '@/lib/portal/profile';

export function usePortalLocale(): PortalLocale {
  const [locale, setLocale] = useState<PortalLocale>('zh');
  useEffect(() => {
    const sync = () => {
      try { setLocale(loadProfileSettings().locale); } catch { /* 保持默认 zh */ }
    };
    sync();
    window.addEventListener(PROFILE_UPDATED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, sync);
  }, []);
  return locale;
}
