'use client';

import { useEffect, useRef, useState } from 'react';
import { clearProfileIdentity, loadProfileSettings, readAvatarFile, saveProfileSettings } from '@/lib/portal/profile';
import { getRecentNodes } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { ToneSheet, PrivacySheet, SubscriptionSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import HealthLogger from './HealthLogger';
import InsightsSheet from './InsightsSheet';
import NamedPlacesSheet from './NamedPlacesSheet';

type ActiveSheet = 'mirror' | 'tone' | 'privacy' | 'subscription' | 'connectors' | 'health' | 'places' | null;

export default function NesioProfileCard() {
  const [displayName, setDisplayName] = useState('Jessy');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
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
    { key: 'tone' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
        </svg>), iconBg: 'var(--chip-indigo)', label: '表达方式', sublabel: '你决定 Nesio 怎么说、什么时候少打扰' },
    { key: 'privacy' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>), iconBg: 'var(--chip-green)', label: '我的数据', sublabel: '你能查看、导出或删除 Nesio 记住的内容' },
    { key: 'subscription' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>), iconBg: 'var(--chip-lemon)', label: '早期体验', sublabel: '全功能免费 · 通知我开放收费版' },
    { key: 'connectors' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>), iconBg: 'var(--chip-blue)', label: '数据接入', sublabel: 'Gmail · Calendar · 天气 · Tesla' },
    { key: 'health' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>), iconBg: 'var(--chip-pink)', label: '健康记录', sublabel: '记录今日症状、睡眠、精力' },
    { key: 'places' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          <circle cx="12" cy="9" r="2.5"/>
        </svg>), iconBg: 'var(--chip-frost)', label: '命名地点', sublabel: '家、公司、常去的地方 · 拍照自动匹配' },
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
      <ToneSheet open={activeSheet === 'tone'} onClose={() => setActiveSheet(null)} />
      <PrivacySheet open={activeSheet === 'privacy'} onClose={() => setActiveSheet(null)} />
      <SubscriptionSheet open={activeSheet === 'subscription'} onClose={() => setActiveSheet(null)} />
      <ConnectorsHub open={activeSheet === 'connectors'} onClose={() => setActiveSheet(null)} />
      <HealthLogger open={activeSheet === 'health'} onClose={() => setActiveSheet(null)} />
      <NamedPlacesSheet open={activeSheet === 'places'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
