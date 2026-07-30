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
    // 批次 34:本地 data: 头像是永久的,不会过期 —— 别用会过期的签名 URL 覆盖它。
    // 只有本地没有永久头像(换了新设备、只剩 storagePath)时才去换签名 URL。
    if (profile.avatarStoragePath && !profile.avatarUrl?.startsWith('data:')) fetchFreshUrl(profile.avatarStoragePath);

    const onUpdate = () => {
      const p = loadProfileSettings();
      if (p.avatarUrl) { setAvatarUrl(p.avatarUrl); return; }
      // 批次200:跨端拉到别端头像时 applyCloudProfile 会清本地 avatarUrl、只留新 avatarStoragePath。
      // 此时不能停在空头像 —— 必须用新 storagePath 换签重渲染,否则别端的头像换不过来(显示成首字母)。
      if (p.avatarStoragePath) { fetchFreshUrl(p.avatarStoragePath); return; }
      setAvatarUrl('');
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  }, [enabled, fetchFreshUrl]);

  const refreshAvatar = useCallback(() => {
    // 先把坏掉的 URL 摘掉再去换新的:签名 URL 过期时,<img> 会先渲染成浏览器的
    // 「破图」图标(真机看到的那个蓝色问号方块),等换签回来才恢复。
    // 立刻置空 → 退回首字母占位,过程中不出现破图。
    setAvatarUrl('');
    const path = loadProfileSettings().avatarStoragePath;
    if (path) fetchFreshUrl(path);
  }, [fetchFreshUrl]);

  return { avatarUrl, refreshAvatar };
}
