'use client';

import { useEffect, useRef, useState } from 'react';
import { clearProfileIdentity, loadProfileSettings, readAvatarFile, saveProfileSettings } from '@/lib/portal/profile';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { useProfileAvatar } from './use-profile-avatar';
import { GeneralSheet, DataSheet, PrivacySheet, SubscriptionSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import RoadmapSheet from './RoadmapSheet';
import { t } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { IconDatabase, IconGear, IconStar as IconStarOutline, IconGift } from './icons';

type ActiveSheet = 'mirror' | 'general' | 'data' | 'privacy' | 'subscription' | 'connectors' | 'roadmap' | null;

export default function NesioProfileCard() {
  const [displayName, setDisplayName] = useState('Jessy');
  // 头像统一走 useProfileAvatar(批次 11:与主页「我」按钮同一数据源,不再各自刷新)
  const { avatarUrl, refreshAvatar } = useProfileAvatar();
  const locale = usePortalLocale();
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);

    // Check auth session
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d: { loggedIn?: boolean }) => setIsSignedIn(Boolean(d?.loggedIn)))
      .catch(() => {});

  }, []);

  const initials = displayName.trim().slice(0, 1) || 'J';

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } catch { /* ignore */ }
    clearProfileIdentity(); // 清除后 PROFILE_UPDATED_EVENT 会让头像自行清空
    setDisplayName('我');
    setIsSignedIn(false);
    window.location.href = '/';
  }

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError('');
    try {
      const client = createAppApiClient();
      const result = await client.uploadCloudAsset({ file, purpose: 'avatar' });
      if (result.ok && result.storagePath) {
        await client.saveCloudProfileSettings({ avatarStoragePath: result.storagePath });
        const readResult = await client.fetchCloudAssetReadUrl({ storagePath: result.storagePath });
        const displayUrl = readResult.ok && readResult.signedUrl ? readResult.signedUrl : '';
        if (displayUrl) {
          // saveProfileSettings 广播 PROFILE_UPDATED_EVENT,useProfileAvatar 自动更新
          saveProfileSettings({ avatarUrl: displayUrl, avatarStoragePath: result.storagePath });
        } else {
          // Signed URL unavailable now; save path only — hook 下次挂载/刷新时换签名
          saveProfileSettings({ avatarStoragePath: result.storagePath });
        }
        return;
      }
    } catch {
      // Cloud avatar upload is a signed-in enhancement; local avatar should keep working offline.
    }
    try {
      const avatar = await readAvatarFile(file);
      saveProfileSettings({ avatarUrl: avatar, avatarStoragePath: '' });
    } catch {
      setAvatarError('头像没有保存，请选择一张较小的图片。');
    }
  }

  const menuItems = [
    { key: 'general' as ActiveSheet,
      icon: <IconGear />,
      iconBg: 'var(--chip-indigo)', label: t(locale, 'menuGeneral'), sublabel: t(locale, 'menuGeneralHint') },
    { key: 'data' as ActiveSheet,
      icon: <IconDatabase />,
      iconBg: 'var(--chip-green)', label: t(locale, 'menuData'), sublabel: t(locale, 'menuDataHint') },
    { key: 'subscription' as ActiveSheet,
      icon: <IconGift />,
      iconBg: 'var(--chip-lemon)', label: t(locale, 'menuEarlyAccess'), sublabel: t(locale, 'menuEarlyAccessHint') },
    { key: 'roadmap' as ActiveSheet,
      icon: <IconStarOutline />,
      iconBg: 'var(--chip-amber)', label: t(locale, 'menuRoadmap'), sublabel: t(locale, 'menuRoadmapHint') },
  ];

  return (
    <>
      <div className="nesio-profile-card">
        {/* Avatar + name + stats */}
        <div className="nesio-profile-card-top">
          <button
            type="button"
            className="nesio-profile-avatar-lg"
            aria-label="上传头像"
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} onError={refreshAvatar} /> : initials}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="nesio-visually-hidden"
            onChange={(event) => handleAvatarFile(event.currentTarget.files?.[0])}
          />
          {/* 批次 6:数字统计改「返回今天」——设置页最常见的下一步;
              洞察(原 mirror)从主页左上角 logo 进,不再从这里开 */}
          <a href="/" className="nesio-profile-stat" aria-label="返回今天">
            <span className="nesio-profile-stat-label" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--portal-blue-deep)' }}>返回今天</span>
          </a>
        </div>
        {avatarError && <p className="nesio-profile-avatar-error">{avatarError}</p>}

        {/* Auth status */}
        {!isSignedIn && (
          <a href="/login" className="nesio-profile-auth-banner">
            <span>登录以跨设备同步 Memory</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>
          </a>
        )}
        {isSignedIn && (
          <button type="button" className="nesio-profile-auth-banner" onClick={handleLogout}>
            <span>退出登录</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M15 18l6-6-6-6"/><path d="M21 12H9"/></svg>
          </button>
        )}

        {/* Menu */}
        <nav className="nesio-profile-menu" aria-label="设置菜单">
          {menuItems.map((item) => (
            <button key={String(item.key)} type="button" className="nesio-profile-menu-item" onClick={() => setActiveSheet(item.key)}>
              <span className="nesio-profile-menu-icon" style={{ background: item.iconBg }}>{item.icon}</span>
              <div className="nesio-profile-menu-text">
                <span className="nesio-profile-menu-label">{item.label}</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="nesio-profile-menu-chevron"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ))}
        </nav>
      </div>

      {/* Sub-sheets */}
      <GeneralSheet open={activeSheet === 'general'} onClose={() => setActiveSheet(null)} />
      <DataSheet open={activeSheet === 'data'} onClose={() => setActiveSheet(null)} onOpenMine={() => setActiveSheet('privacy')} onOpenConnect={() => setActiveSheet('connectors')} />
      <PrivacySheet open={activeSheet === 'privacy'} onClose={() => setActiveSheet(null)} />
      <SubscriptionSheet open={activeSheet === 'subscription'} onClose={() => setActiveSheet(null)} />
      <ConnectorsHub open={activeSheet === 'connectors'} onClose={() => setActiveSheet(null)} />
      <RoadmapSheet open={activeSheet === 'roadmap'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
