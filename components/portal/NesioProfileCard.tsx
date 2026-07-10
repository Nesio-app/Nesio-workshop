'use client';

import { useEffect, useRef, useState } from 'react';
import { clearProfileIdentity, loadProfileSettings, readAvatarFile, saveProfileSettings } from '@/lib/portal/profile';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { useProfileAvatar } from './use-profile-avatar';
import { GeneralSheet, DataSheet, PrivacySheet, SubscriptionSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import RoadmapSheet from './RoadmapSheet';
import RoutineSheet from './RoutineSheet';
import { IconClock } from './icons';
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { IconDatabase, IconGear, IconStar as IconStarOutline, IconGift } from './icons';

type ActiveSheet = 'mirror' | 'general' | 'data' | 'privacy' | 'subscription' | 'connectors' | 'roadmap' | 'routine' | null;

export default function NesioProfileCard() {
  const [displayName, setDisplayName] = useState('Jessy');
  // 头像统一走 useProfileAvatar(批次 11:与主页「我」按钮同一数据源,不再各自刷新)
  const { avatarUrl, refreshAvatar } = useProfileAvatar();
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);

    // Check auth session(P1-6:顺带取邮箱,账号区显示「登录的是谁」)
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d: { loggedIn?: boolean; user?: { email?: string } }) => {
        setIsSignedIn(Boolean(d?.loggedIn));
        setAccountEmail(d?.user?.email || '');
      })
      .catch(() => {});

  }, []);

  // 批次 12:缺省名「我」是 profile store 的 zh 回落值,英文界面显示 Me
  const initials = displayName.trim() && displayName.trim() !== '我'
    ? displayName.trim().slice(0, 1)
    : L(dict, '我', 'Me');

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } catch { /* ignore */ }
    clearProfileIdentity(); // 清除后 PROFILE_UPDATED_EVENT 会让头像自行清空
    setDisplayName(L(dict, '我', 'Me'));
    setIsSignedIn(false);
    window.location.href = '/';
  }

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError('');
    // 批次 34:头像「时不时消失」根治 —— 先存一份永久本地 data: 头像(不会像签名 URL 那样过期),
    // 立即显示且不再随过期消失;云端上传只用来存 storagePath 做跨设备,不覆盖本地永久头像。
    let localSaved = false;
    try {
      const avatar = await readAvatarFile(file);
      saveProfileSettings({ avatarUrl: avatar });
      localSaved = true;
    } catch { /* 本地存不下就退到只云端 */ }
    try {
      const client = createAppApiClient();
      const result = await client.uploadCloudAsset({ file, purpose: 'avatar' });
      if (result.ok && result.storagePath) {
        await client.saveCloudProfileSettings({ avatarStoragePath: result.storagePath });
        saveProfileSettings({ avatarStoragePath: result.storagePath }); // 只补 storagePath,保留本地 data: 头像
      }
    } catch {
      // 云端是跨设备增强;本地永久头像已经能显示。
    }
    if (!localSaved) setAvatarError(L(dict, '头像没有保存，请选择一张较小的图片。', "Avatar wasn't saved — try a smaller image."));
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
    { key: 'routine' as ActiveSheet,
      icon: <IconClock />,
      iconBg: 'var(--chip-blue)', label: L(dict, '例行提醒', 'Routines'), sublabel: L(dict, '到点在 Today 出卡提醒', 'Due reminders appear on Today') },
    { key: 'roadmap' as ActiveSheet,
      icon: <IconStarOutline />,
      iconBg: 'var(--chip-violet)', label: t(locale, 'menuRoadmap'), sublabel: t(locale, 'menuRoadmapHint') },
  ];

  return (
    <>
      <div className="nesio-profile-card">
        {/* Avatar + name + stats */}
        <div className="nesio-profile-card-top">
          <button
            type="button"
            className="nesio-profile-avatar-lg"
            aria-label={L(dict, '上传头像', 'Upload avatar')}
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
          <a href="/" className="nesio-profile-stat" aria-label={L(dict, '返回今天', 'Back to Today')}>
            <span className="nesio-profile-stat-label" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--portal-blue-deep)' }}>{L(dict, '返回今天', 'Back to Today')}</span>
          </a>
        </div>
        {avatarError && <p className="nesio-profile-avatar-error">{avatarError}</p>}

        {/* Auth status */}
        {!isSignedIn && (
          <a href="/login" className="nesio-profile-auth-banner">
            <span>{L(dict, '登录以跨设备同步 Memory', 'Sign in to sync Memory across devices')}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>
          </a>
        )}
        {isSignedIn && (
          <button type="button" className="nesio-profile-auth-banner" onClick={handleLogout}>
            {/* P1-6:显示登录的是哪个账号 —— 之前只有「退出登录」,用户不知道当前身份 */}
            <span>
              {accountEmail
                ? <>{accountEmail}<span style={{ opacity: 0.65, marginLeft: '0.5rem' }}>{L(dict, '· 退出登录', '· Sign out')}</span></>
                : L(dict, '退出登录', 'Sign out')}
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M15 18l6-6-6-6"/><path d="M21 12H9"/></svg>
          </button>
        )}

        {/* Menu */}
        <nav className="nesio-profile-menu" aria-label={L(dict, '设置菜单', 'Settings menu')}>
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
      <RoutineSheet open={activeSheet === 'routine'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
