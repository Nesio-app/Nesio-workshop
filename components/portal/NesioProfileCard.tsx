'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clearProfileIdentity, loadProfileSettings, readAvatarFile, saveProfileSettings } from '@/lib/portal/profile';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { useProfileAvatar } from './use-profile-avatar';
import { AccountSheet, ProfileSheet, AppearanceSheet, HabitsSheet, PrivacySheet, SubscriptionSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import RoadmapSheet from './RoadmapSheet';
import RoutineSheet from './RoutineSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { IconClock, IconGear, IconGift, IconUser, IconSun, IconMapPin, IconShield, IconHelpCircle } from './icons';

// 批次 138 设计「设置重组」:档案/账户拆开 · 通用拆成外观语言+记录习惯 · 底部次要行
type ActiveSheet = 'profile' | 'account' | 'appearance' | 'habits' | 'privacy' | 'subscription' | 'connectors' | 'roadmap' | 'routine' | null;

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
  // 批次 95/96:上传头像自动卡通化
  const [cartoonBusy, setCartoonBusy] = useState(false);
  const [cartoonPreview, setCartoonPreview] = useState('');   // 生成结果 dataURL(待接受)
  const [cartoonSource, setCartoonSource] = useState('');     // 原图 dataURL(重新生成用)
  const [cartoonMsg, setCartoonMsg] = useState('');
  const [avatarSourceFile, setAvatarSourceFile] = useState<File | null>(null);

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

  // 把 dataURL 存成头像(本地永久 + 云端跨设备)
  async function commitAvatar(dataUrl: string, file?: File) {
    let localSaved = false;
    try { saveProfileSettings({ avatarUrl: dataUrl }); localSaved = true; } catch { /* 存不下退云端 */ }
    if (file) {
      try {
        const client = createAppApiClient();
        const result = await client.uploadCloudAsset({ file, purpose: 'avatar' });
        if (result.ok && result.storagePath) {
          await client.saveCloudProfileSettings({ avatarStoragePath: result.storagePath });
          saveProfileSettings({ avatarStoragePath: result.storagePath });
        }
      } catch { /* 云端是增强,本地已显示 */ }
    }
    if (!localSaved) setAvatarError(L(dict, '头像没有保存，请选择一张较小的图片。', "Avatar wasn't saved — try a smaller image."));
  }

  // 批次 96(用户定案):上传头像后**自动**卡通化 —— 不再单独按钮。
  // 生成中弹窗;预览可「用卡通头像 / 用原照片 / 取消」;失败给原图兜底。
  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError('');
    let originalDataUrl = '';
    try {
      const { compressToDataUrl } = await import('@/lib/portal/local-image-store');
      originalDataUrl = await compressToDataUrl(file, 1024, 0.85);
    } catch {
      try { originalDataUrl = await readAvatarFile(file); } catch { /* ignore */ }
    }
    if (!originalDataUrl) { setAvatarError(L(dict, '这张图读不了,换一张试试。', "Couldn't read that image — try another.")); return; }
    setCartoonSource(originalDataUrl);
    setAvatarSourceFile(file);
    await generateCartoon(originalDataUrl);
  }

  // 批次 95:照片 → app 主题色卡通头像(生成 → 预览 → 接受设为头像)
  async function generateCartoon(dataUrl: string) {
    setCartoonBusy(true);
    setCartoonMsg('');
    try {
      const [meta, b64] = dataUrl.split(',');
      const mimeType = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg';
      const res = await fetch('/api/portal/avatarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64, mimeType }),
      });
      const data = await res.json() as { ok?: boolean; dataUrl?: string; message?: string };
      if (data.ok && data.dataUrl) setCartoonPreview(data.dataUrl);
      else setCartoonMsg(data.message || L(dict, '生成失败，稍后再试。', 'Generation failed — try again later.'));
    } catch {
      setCartoonMsg(L(dict, '生成没连上，稍后再试。', "Couldn't reach the generator — try again later."));
    }
    setCartoonBusy(false);
  }

  function acceptCartoon() {
    if (!cartoonPreview) return;
    void commitAvatar(cartoonPreview);
    setCartoonPreview(''); setCartoonSource(''); setCartoonMsg(''); setAvatarSourceFile(null);
  }

  function useOriginalPhoto() {
    if (!cartoonSource) return;
    void commitAvatar(cartoonSource, avatarSourceFile || undefined);
    setCartoonPreview(''); setCartoonSource(''); setCartoonMsg(''); setAvatarSourceFile(null);
  }

  function cancelCartoon() {
    setCartoonPreview(''); setCartoonSource(''); setCartoonMsg(''); setAvatarSourceFile(null);
  }

  // 批次 138:分组主菜单(档案与账户 / 偏好)+ 底部次要行
  const menuGroups: Array<{ label: string; items: Array<{ key: ActiveSheet; icon: ReactNode; iconBg: string; label: string; sublabel: string }> }> = [
    { label: L(dict, '档案与账户', 'Profile & account'), items: [
      { key: 'profile', icon: <IconUser />, iconBg: 'var(--chip-frost)', label: L(dict, '档案', 'Profile'), sublabel: L(dict, '昵称 · 头像', 'Nickname · avatar') },
      { key: 'account', icon: <IconGear />, iconBg: 'var(--chip-frost)', label: L(dict, '账户', 'Account'), sublabel: L(dict, '邮箱 · 密码 · 套餐 · 退出', 'Email · password · plan · sign out') },
    ] },
    { label: L(dict, '偏好', 'Preferences'), items: [
      { key: 'appearance', icon: <IconSun />, iconBg: 'var(--chip-indigo)', label: L(dict, '外观与语言', 'Appearance & language'), sublabel: L(dict, '明暗 · 语言', 'Theme · language') },
      { key: 'habits', icon: <IconMapPin />, iconBg: 'var(--chip-green)', label: L(dict, '记录习惯', 'Capture habits'), sublabel: L(dict, '日报 · 触感 · 定位 · 数据接入', 'Report · haptics · location · sources') },
      { key: 'privacy', icon: <IconShield />, iconBg: 'var(--chip-blue)', label: L(dict, '数据与隐私', 'Data & privacy'), sublabel: L(dict, '我的数据 · 备份恢复 · 删除区', 'Your data · backup · delete zone') },
    ] },
  ];
  const bottomItems: Array<{ key: ActiveSheet; icon: ReactNode; label: string }> = [
    { key: 'subscription', icon: <IconGift />, label: L(dict, '会员 · Pro', 'Membership · Pro') },
    { key: 'routine', icon: <IconClock />, label: L(dict, '例行提醒', 'Routines') },
    { key: 'roadmap', icon: <IconHelpCircle />, label: L(dict, '帮助与反馈', 'Help & feedback') },
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
        {/* 批次 35:顶部退出行删除 —— 邮箱与退出都在「账户」页里,重复入口去掉 */}

        {/* Menu */}
        <nav className="nesio-profile-menu" aria-label={L(dict, '设置菜单', 'Settings menu')}>
          {menuGroups.map((group) => (
            <div key={group.label} className="nesio-profile-menu-group">
              <p className="nesio-profile-menu-group-label">{group.label}</p>
              {group.items.map((item) => (
                <button key={String(item.key)} type="button" className="nesio-profile-menu-item" onClick={() => setActiveSheet(item.key)}>
                  <span className="nesio-profile-menu-icon" style={{ background: item.iconBg }}>{item.icon}</span>
                  <div className="nesio-profile-menu-text">
                    <span className="nesio-profile-menu-label">{item.label}</span>
                    <span className="nesio-profile-menu-sublabel">{item.sublabel}</span>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="nesio-profile-menu-chevron"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* 批次 138:次要入口收进底部一行,主菜单更清爽 */}
        <div className="nesio-profile-menu-bottom">
          {bottomItems.map((item) => (
            <button key={String(item.key)} type="button" className="nesio-profile-menu-bottom-item" onClick={() => setActiveSheet(item.key)}>
              <span className="nesio-profile-menu-bottom-icon" aria-hidden>{item.icon}</span>
              <span className="nesio-profile-menu-bottom-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 批次 95:卡通头像 —— 生成中 / 预览接受 / 报错 */}
      {(cartoonBusy || cartoonPreview || cartoonMsg) && (
        <div className="nesio-cartoon-overlay" role="dialog" aria-modal="true">
          <div className="nesio-cartoon-card">
            {cartoonBusy ? (
              <>
                <div className="nesio-cartoon-spinner" aria-hidden />
                <p className="nesio-cartoon-title">{L(dict, '正在生成你的卡通形象…', 'Drawing your cartoon avatar…')}</p>
                <p className="nesio-cartoon-sub">{L(dict, '约需十几秒', 'Takes ~15 seconds')}</p>
              </>
            ) : cartoonPreview ? (
              <>
                <p className="nesio-cartoon-title">{L(dict, '喜欢这个吗?', 'Like this one?')}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cartoonPreview} alt="" className="nesio-cartoon-preview" draggable={false} />
                <div className="nesio-cartoon-actions">
                  <button type="button" className="nesio-cartoon-accept" onClick={acceptCartoon}>{L(dict, '用卡通头像', 'Use cartoon')}</button>
                  <button type="button" className="nesio-cartoon-retry" onClick={() => { if (cartoonSource) void generateCartoon(cartoonSource); }}>{L(dict, '再生成一张', 'Regenerate')}</button>
                  <button type="button" className="nesio-cartoon-retry" onClick={useOriginalPhoto}>{L(dict, '用原照片', 'Use original')}</button>
                  <button type="button" className="nesio-cartoon-cancel" onClick={cancelCartoon}>{L(dict, '不用了', 'Cancel')}</button>
                </div>
              </>
            ) : (
              <>
                <p className="nesio-cartoon-title">{L(dict, '卡通化没成', "Couldn't cartoonify")}</p>
                <p className="nesio-cartoon-sub">{cartoonMsg}</p>
                <div className="nesio-cartoon-actions">
                  <button type="button" className="nesio-cartoon-accept" onClick={useOriginalPhoto} disabled={!cartoonSource}>{L(dict, '就用原照片', 'Use original photo')}</button>
                  <button type="button" className="nesio-cartoon-retry" onClick={() => { if (cartoonSource) void generateCartoon(cartoonSource); }} disabled={!cartoonSource}>{L(dict, '重试卡通化', 'Retry')}</button>
                  <button type="button" className="nesio-cartoon-cancel" onClick={cancelCartoon}>{L(dict, '取消', 'Cancel')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sub-sheets */}
      <ProfileSheet open={activeSheet === 'profile'} onClose={() => setActiveSheet(null)} onPickAvatar={() => { setActiveSheet(null); setTimeout(() => avatarInputRef.current?.click(), 80); }} />
      <AccountSheet open={activeSheet === 'account'} onClose={() => setActiveSheet(null)} onOpenMembership={() => setActiveSheet('subscription')} />
      <AppearanceSheet open={activeSheet === 'appearance'} onClose={() => setActiveSheet(null)} />
      <HabitsSheet open={activeSheet === 'habits'} onClose={() => setActiveSheet(null)} onOpenConnect={() => setActiveSheet('connectors')} />
      <PrivacySheet open={activeSheet === 'privacy'} onClose={() => setActiveSheet(null)} />
      <SubscriptionSheet open={activeSheet === 'subscription'} onClose={() => setActiveSheet(null)} />
      <ConnectorsHub open={activeSheet === 'connectors'} onClose={() => setActiveSheet(null)} />
      <RoadmapSheet open={activeSheet === 'roadmap'} onClose={() => setActiveSheet(null)} />
      <RoutineSheet open={activeSheet === 'routine'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
