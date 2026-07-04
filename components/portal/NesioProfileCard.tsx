'use client';

import { useEffect, useRef, useState } from 'react';
import { clearProfileIdentity, loadProfileSettings, readAvatarFile, saveProfileSettings } from '@/lib/portal/profile';
import { getRecentNodes } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { GeneralSheet, DataSheet, PrivacySheet, SubscriptionSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import InsightsSheet from './InsightsSheet';
import RoadmapSheet from './RoadmapSheet';
import { t } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { IconDatabase, IconGear, IconStar as IconStarOutline } from './icons';

type ActiveSheet = 'mirror' | 'general' | 'data' | 'privacy' | 'subscription' | 'connectors' | 'roadmap' | null;

export default function NesioProfileCard() {
  const [displayName, setDisplayName] = useState('Jessy');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
  const locale = usePortalLocale();
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);
    setAvatarUrl(profile.avatarUrl || '');
    setMemoryCount(getRecentNodes(100).length);

    if (profile.avatarStoragePath) {
      const client = createAppApiClient();
      client
        .fetchCloudAssetReadUrl({ storagePath: profile.avatarStoragePath })
        .then((result) => {
          if (result.ok && result.signedUrl) {
            setAvatarUrl(result.signedUrl);
            saveProfileSettings({
              avatarUrl: result.signedUrl,
              avatarStoragePath: profile.avatarStoragePath,
            });
          }
        })
        .catch(() => {});
    }

    // Check auth session
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d: { loggedIn?: boolean }) => setIsSignedIn(Boolean(d?.loggedIn)))
      .catch(() => {});

    const onUpdate = () => setMemoryCount(getRecentNodes(100).length);
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
  }, []);

  const initials = displayName.trim().slice(0, 1) || 'J';

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } catch { /* ignore */ }
    clearProfileIdentity();
    setDisplayName('我');
    setAvatarUrl('');
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
          saveProfileSettings({ avatarUrl: displayUrl, avatarStoragePath: result.storagePath });
          setAvatarUrl(displayUrl);
        } else {
          // Signed URL unavailable now; save path only — will refresh on next open
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
      setAvatarUrl(avatar);
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
      icon: <IconStarOutline />,
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
            {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} /> : initials}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="nesio-visually-hidden"
            onChange={(event) => handleAvatarFile(event.currentTarget.files?.[0])}
          />
          {memoryCount > 0 && (
            <button
              type="button"
              className="nesio-profile-stat"
              aria-label="打开 Nesio 整理出的线索"
              onClick={() => setActiveSheet('mirror')}
            >
              <span className="nesio-profile-stat-num">{memoryCount}</span>
              <span className="nesio-profile-stat-label">条记忆</span>
            </button>
          )}
        </div>
        {avatarError && <p className="nesio-profile-avatar-error">{avatarError}</p>}

        {/* Auth status */}
        {!isSignedIn && (
          <a href="/login" className="nesio-profile-auth-banner">
            <span>🔐 登录以跨设备同步 Memory</span>
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
                <span className="nesio-profile-menu-sublabel">{item.sublabel}</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="nesio-profile-menu-chevron"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ))}
        </nav>
      </div>

      {/* Sub-sheets */}
      {activeSheet === 'mirror' && (
        <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="Nesio 的洞察">
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setActiveSheet(null)} aria-label="关闭" />
          <div className="nesio-settings-sheet-card nesio-insights-sheet-card">
            <div className="nesio-sheet-handle" aria-hidden />
            <InsightsSheet onClose={() => setActiveSheet(null)} />
          </div>
        </div>
      )}
      <GeneralSheet open={activeSheet === 'general'} onClose={() => setActiveSheet(null)} />
      <DataSheet open={activeSheet === 'data'} onClose={() => setActiveSheet(null)} onOpenMine={() => setActiveSheet('privacy')} onOpenConnect={() => setActiveSheet('connectors')} />
      <PrivacySheet open={activeSheet === 'privacy'} onClose={() => setActiveSheet(null)} />
      <SubscriptionSheet open={activeSheet === 'subscription'} onClose={() => setActiveSheet(null)} />
      <ConnectorsHub open={activeSheet === 'connectors'} onClose={() => setActiveSheet(null)} />
      <RoadmapSheet open={activeSheet === 'roadmap'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
