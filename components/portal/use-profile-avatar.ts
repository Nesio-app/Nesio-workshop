'use client';

/**
 * useProfileAvatar — 全站唯一的头像数据源(批次 11)。
 *
 * 头像「时不时丢失」的根因:云端头像存的是有时效的签名 URL。此前只有
 * 设置页(NesioProfileCard)挂载时会用 avatarStoragePath 换一个新签名,
 * 主页「我」按钮只读 localStorage 里缓存的旧 URL——签名过期后 <img>
 * 请求 403,头像就消失了;去一趟设置页又"恢复",看起来像随机丢失。
 *
 * 统一策略:先出缓存立即渲染;若有 storagePath 就后台换新签名并回写;
 * <img> onError 时用 refreshAvatar 再强制换一次;各组件间由
 * PROFILE_UPDATED_EVENT 驱动同步,不再各自为政。
 */

import { useCallback, useEffect, useState } from 'react';
import { PROFILE_UPDATED_EVENT, loadProfileSettings, saveProfileSettings } from '@/lib/portal/profile';
import { createAppApiClient } from '@/lib/portal/app-api-client';

export function useProfileAvatar(enabled: boolean = true): {
  avatarUrl: string;
  /** img onError 时调用:强制用 storagePath 重新换签名 URL */
  refreshAvatar: () => void;
} {
  const [avatarUrl, setAvatarUrl] = useState('');

  const fetchFreshUrl = useCallback((storagePath: string) => {
    createAppApiClient()
      .fetchCloudAssetReadUrl({ storagePath })
      .then((result) => {
        if (result.ok && result.signedUrl) {
          setAvatarUrl(result.signedUrl);
          // 回写缓存(会广播 PROFILE_UPDATED_EVENT,其他挂载点同步更新)
          saveProfileSettings({ avatarUrl: result.signedUrl, avatarStoragePath: storagePath });
        }
      })
      .catch(() => { /* 离线/未登录时保留缓存 URL,能显示多久算多久 */ });
  }, []);

  useEffect(() => {
    if (!enabled) { setAvatarUrl(''); return; }
    const profile = loadProfileSettings();
    setAvatarUrl(profile.avatarUrl || '');
    if (profile.avatarStoragePath) fetchFreshUrl(profile.avatarStoragePath);

    const onUpdate = () => setAvatarUrl(loadProfileSettings().avatarUrl || '');
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  }, [enabled, fetchFreshUrl]);

  const refreshAvatar = useCallback(() => {
    const path = loadProfileSettings().avatarStoragePath;
    if (path) fetchFreshUrl(path);
    else setAvatarUrl('');
  }, [fetchFreshUrl]);

  return { avatarUrl, refreshAvatar };
}
