'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clearProfileIdentity, loadProfileSettings, readAvatarFile, saveProfileSettings } from '@/lib/portal/profile';
import { pushProfileToCloud } from '@/lib/portal/cloud-profile-sync';
import { createAppApiClient } from '@/lib/portal/app-api-client';

/** 批次200:dataURL → File，让卡通头像(无源文件)也能上传成云资产,跨端同步。 */
function dataUrlToFile(dataUrl: string, name: string): File | null {
  try {
    const [meta, b64] = dataUrl.split(',');
    if (!b64) return null;
    const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  } catch {
    return null;
  }
}
import { useProfileAvatar } from './use-profile-avatar';
import { AccountSheet, AppearanceSheet, PrivacySheet, SubscriptionSheet, LabSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import RoadmapSheet from './RoadmapSheet';
import RoutineSheet from './RoutineSheet';
import PreviewGuidesSheet from './PreviewGuidesSheet';
import { getTier, trialDaysLeft, guardPaidCloudAi } from '@/lib/portal/entitlement';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { IconClock, IconGift, IconSun, IconShield, IconHelpCircle, IconBulb } from './icons';

// 图3/4/5:档案页删除、账户收进头像区、菜单去分组标题与小灰字
type ActiveSheet = 'account' | 'appearance' | 'privacy' | 'subscription' | 'connectors' | 'roadmap' | 'routine' | 'preview' | 'lab' | null;

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
  const hasName = displayName.trim() && displayName.trim() !== '我';
  const shownName = hasName ? displayName.trim() : L(dict, '我', 'Me');
  const initials = hasName ? displayName.trim().slice(0, 1) : L(dict, '我', 'Me');
  // 图5:真 Pro(非试用)王冠金色,否则灰色
  const isPro = getTier() === 'pro' && trialDaysLeft() <= 0;

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
    // 批次200:头像**总是**上传成云资产 —— 卡通头像(acceptCartoon)没有源 file,以前就不上云、
    // 于是没有 avatarStoragePath、跨端同步不了(婧/F/朋 各端不同的真因之一)。这里用 dataURL 兜底成 File。
    try {
      const uploadFile = file || dataUrlToFile(dataUrl, 'avatar.png');
      if (uploadFile) {
        const client = createAppApiClient();
        const result = await client.uploadCloudAsset({ file: uploadFile, purpose: 'avatar' });
        if (result.ok && result.storagePath) {
          saveProfileSettings({ avatarStoragePath: result.storagePath }); // bump identityUpdatedAt
          await pushProfileToCloud(); // 一次性推 displayName + avatarStoragePath + identityUpdatedAt
        }
      }
    } catch { /* 云端是增强,本地已显示 */ }
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
    // 安全审计 #2:卡通头像是付费云视觉,免费(分层启用后)→ 升级引导,不打云;原照片仍可用。
    if (!guardPaidCloudAi('avatar_ai')) return;
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

  // 图3/4:档案与账户分组删掉(账户进头像区、档案页删),菜单只留偏好项且不带分组标题/小灰字
  const menuItems: Array<{ key: ActiveSheet; icon: ReactNode; iconBg: string; label: string }> = [
    { key: 'appearance', icon: <IconSun />, iconBg: 'var(--chip-indigo)', label: L(dict, '外观与语言', 'Appearance & language') },
    { key: 'privacy', icon: <IconShield />, iconBg: 'var(--chip-blue)', label: L(dict, '数据与隐私', 'Data & privacy') },
  ];
  // 图1:Lab(实验功能 + 新手提醒/预览引导)从隐私里独立成底部入口。
  // 用户要求:这几项与上面两张卡同形态 —— 合进同一套整行卡(图标块 + 名称 + 箭头)。
  const bottomItems: Array<{ key: ActiveSheet; icon: ReactNode; iconBg: string; label: string }> = [
    { key: 'subscription', icon: <IconGift />, iconBg: 'var(--chip-amber)', label: L(dict, '会员 · Pro', 'Membership · Pro') },
    { key: 'routine', icon: <IconClock />, iconBg: 'var(--chip-mint)', label: L(dict, '例行提醒', 'Routines') },
    { key: 'roadmap', icon: <IconHelpCircle />, iconBg: 'var(--chip-periwinkle)', label: L(dict, '帮助与反馈', 'Help & feedback') },
    { key: 'lab', icon: <IconBulb />, iconBg: 'var(--chip-violet)', label: 'Lab' },
  ];

  return (
    <>
      <div className="nesio-profile-card">
        {/* 图5:头像区 = 头像(Pro 王冠)+ 昵称 + 箭头 → 点进账户;「返回今天」留在右侧 */}
        <div className="nesio-profile-card-top">
          <button
            type="button"
            className="nesio-profile-identity"
            aria-label={L(dict, '账户', 'Account')}
            onClick={() => setActiveSheet('account')}
          >
            <span className="nesio-profile-avatar-lg nesio-profile-avatar-lg--nav">
              {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} onError={refreshAvatar} /> : initials}
              <span className={`nesio-profile-pro-badge${isPro ? ' nesio-profile-pro-badge--pro' : ''}`} aria-hidden>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M3 7l4.5 3.2L12 4l4.5 6.2L21 7l-1.7 11.4a1 1 0 0 1-1 .85H5.7a1 1 0 0 1-1-.85L3 7z"/></svg>
              </span>
            </span>
            <span className="nesio-profile-identity-name">{shownName}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="nesio-profile-identity-chev"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="nesio-visually-hidden"
            onChange={(event) => handleAvatarFile(event.currentTarget.files?.[0])}
          />

          {/* 批次 6:数字统计改「返回今天」——设置页最常见的下一步 */}
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

        {/* 图4:菜单去掉分组标题与每行小灰字,只留图标 + 名称 + 箭头 */}
        {/* 用户要求:会员/例行提醒/帮助反馈/Lab 与上面两张同形态,合进同一套整行卡 */}
        <nav className="nesio-profile-menu" aria-label={L(dict, '设置菜单', 'Settings menu')}>
          {[...menuItems, ...bottomItems].map((item) => (
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
      <AccountSheet open={activeSheet === 'account'} onClose={() => setActiveSheet(null)} onOpenMembership={() => setActiveSheet('subscription')} onPickAvatar={() => { setActiveSheet(null); setTimeout(() => avatarInputRef.current?.click(), 80); }} />
      <AppearanceSheet open={activeSheet === 'appearance'} onClose={() => setActiveSheet(null)} />
      <PrivacySheet open={activeSheet === 'privacy'} onClose={() => setActiveSheet(null)} onOpenConnect={() => setActiveSheet('connectors')} />
      <SubscriptionSheet open={activeSheet === 'subscription'} onClose={() => setActiveSheet(null)} />
      <ConnectorsHub open={activeSheet === 'connectors'} onClose={() => setActiveSheet(null)} />
      <RoadmapSheet open={activeSheet === 'roadmap'} onClose={() => setActiveSheet(null)} />
      <RoutineSheet open={activeSheet === 'routine'} onClose={() => setActiveSheet(null)} />
      <LabSheet open={activeSheet === 'lab'} onClose={() => setActiveSheet(null)} onOpenPreview={() => setActiveSheet('preview')} />
      <PreviewGuidesSheet open={activeSheet === 'preview'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
