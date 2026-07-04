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
  // 批次 14:惰性初始化直接读存储——此前初始 'zh' 再在 effect 里翻转,
  // 英文界面每次挂载都先闪中文(用户:「一会中文一会英文」)。
  // SSR 下 loadProfileSettings 返回默认值,客户端首帧即正确语言。
  const [locale, setLocale] = useState<PortalLocale>(() => {
    try { return loadProfileSettings().locale; } catch { return 'zh'; }
  });
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
