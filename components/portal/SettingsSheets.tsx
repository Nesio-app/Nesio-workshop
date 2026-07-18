'use client';

/**
 * Settings sub-sheets: 语气与边界 / 隐私与数据 / 生活空间 / 订阅
 * Each is a slide-up bottom sheet opened from NesioProfileCard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PORTAL_LOCALE_OPTIONS, loadProfileSettings, portalLocaleToDictionaryLocale, profileIdentityUpdatedAt, saveProfileSettings, touchProfileIdentity, type PortalLocale } from '@/lib/portal/profile';
import { pushProfileToCloud, syncProfileWithCloud } from '@/lib/portal/cloud-profile-sync';
import { syncMemoryWithCloud } from '@/lib/portal/cloud-memory-sync';
import { runSweepNow } from '@/lib/portal/llm-sweep-auto';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { L, t } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { IconChevronRight, IconHalfMoon, IconLink, IconLock, IconMoon, IconShield, IconSun } from './icons';
import { InfoTip } from './InfoTip';
import NesioSheet from './ui/NesioSheet';
import { captureLocationEnabled, setCaptureLocationEnabled } from '@/lib/portal/capture-location';
import { PROACTIVE_LEVEL_KEY } from './today/proactive-types';
import { deleteLifeNode, getLifeGraph } from '@/lib/portal/life-graph';
import { purgeLocalData } from '@/lib/portal/storage-manifest';
import { purgeIdbBlobs } from '@/lib/portal/idb-blob-store';
import { purgeLocalImages } from '@/lib/portal/local-image-store';
import { getTelemetryDeviceId } from '@/lib/portal/telemetry';
import { FEATURE_CATALOG, loadModuleOverrides, setModuleOverride, MODULE_OVERRIDES_EVENT, defaultResolvesTo, followsLab, isLabModeOn, getPalette, setPalette, PALETTES, type PaletteId } from '@/lib/portal/module-overrides';
import { isAppStoreBuild } from '@/lib/portal/app-build.mjs';
import { canUse, getTier, hasProOverride, hasPaidPro, refreshServerEntitlement, setProEntitlement, trialDaysLeft, TIER_UPDATED_EVENT } from '@/lib/portal/entitlement';
import { isValidBackup } from '@/lib/portal/full-backup';
import { pushBackupToCloud, pullBackupFromCloud, restoreCombinedBackup, buildCombinedBackup, hasCloudEntitlement, lastCloudBackup, type CloudBackupError, type CloudRestoreError } from '@/lib/portal/cloud-backup';

interface SheetProps { open: boolean; onClose: () => void; }

function SheetWrap({ open, onClose, title, tip, children }: SheetProps & { title: string; tip?: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      ariaLabel={title}
    >
      <div className="nesio-settings-sheet-header">
        <h2 className="nesio-settings-sheet-title">{title}{tip && <InfoTip text={tip} />}</h2>
      </div>
      <div className="nesio-settings-sheet-body">{children}</div>
    </NesioSheet>
  );
}

// ── 语气与边界 ────────────────────────────────────────

type ToneStyle = 'direct' | 'warm' | 'minimal';
type InterruptLevel = 'proactive' | 'minimal' | 'silent';
type ThemeChoice = 'day' | 'auto' | 'night';
const HAPTIC_FEEDBACK_KEY = 'nesio-haptic-feedback-enabled-v1';
// 字典真实覆盖的语言 — 翻译完成一种开放一种(下拉里其余禁用,不给假选项)
const READY_LOCALES = new Set<string>(['zh', 'en']);
const THEME_KEY = 'treasurebox-theme';

// Mirror of the anti-flash boot script in app/layout.tsx — keep in sync.
function applyTheme(choice: ThemeChoice) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const h = new Date().getHours();
  const resolved = choice === 'night' ? 'night' : choice === 'day' ? 'day' : (dark || h < 6 || h >= 19) ? 'night' : 'day';
  document.documentElement.setAttribute('data-portal-theme', resolved);
}

/**
 * GeneralSheet(通用)— 语气 / 提醒程度 / 外观 / 语言 / 触感。
 * 一切改动即点即生效(设计红线:不再有"看起来能点但没反应"的控件):
 *   - 语气 → chat 系统提示词(buildSystemPersonality)
 *   - 提醒程度 → Today 主动卡数量(PROACTIVE_LEVEL_KEY,useTodayFeed 消费)
 *   - 外观/语言 → 立即应用;语言 12 种,zh/en 之外先回落英文界面
 */
export function GeneralSheet({ open, onClose }: SheetProps) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [tone, setTone] = useState<ToneStyle>('warm');
  const [interrupt, setInterrupt] = useState<InterruptLevel>('proactive');
  const [hapticsOn, setHapticsOn] = useState(true);
  const [dailyReportOn, setDailyReportOn] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const [themeSaveIssue, setThemeSaveIssue] = useState('');
  const [captureLocOn, setCaptureLocOn] = useState(false);

  useEffect(() => {
    if (!open) return;
    const p = loadProfileSettings();
    setTone((p.coachStyle as ToneStyle) || 'warm');
    setDailyReportOn(p.dailyReportEnabled);
    try {
      const lvl = localStorage.getItem(PROACTIVE_LEVEL_KEY);
      setInterrupt(lvl === 'minimal' || lvl === 'silent' ? lvl : getMirrorProfile().interruptionStyle);
      setHapticsOn(localStorage.getItem(HAPTIC_FEEDBACK_KEY) !== '0');
      const th = localStorage.getItem(THEME_KEY);
      setTheme(th === 'day' || th === 'night' ? th : 'auto');
      setCaptureLocOn(captureLocationEnabled());
    } catch { /* ignore */ }
  }, [open]);

  function pickTone(next: ToneStyle) {
    setTone(next);
    saveProfileSettings({ coachStyle: next as 'warm' | 'minimal' | 'professional' });
  }
  function pickInterrupt(next: InterruptLevel) {
    setInterrupt(next);
    try { localStorage.setItem(PROACTIVE_LEVEL_KEY, next); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('nesio-proactive-level-changed'));
  }
  function pickTheme(next: ThemeChoice) {
    setTheme(next);
    applyTheme(next);
    touchProfileIdentity(); // 批次205:主题跨端 —— 打新 profile 时间戳 + 广播,触发自动回推

    // 批次 51:存储满时 setItem 静默失败 → 当前页面看着切成功,下次加载 boot
    // 脚本读不到选择又跳回「随系统」(用户实测:主页还是黑、设置回跳)。
    // 失败先自动腾空间重试;仍不行就说真话,不装保存成功。
    try {
      localStorage.setItem(THEME_KEY, next);
      setThemeSaveIssue('');
    } catch {
      void (async () => {
        try {
          const { runStorageRelief } = await import('@/lib/portal/storage-relief');
          await runStorageRelief();
          localStorage.setItem(THEME_KEY, next);
          setThemeSaveIssue('');
        } catch {
          setThemeSaveIssue(L(dict, '本机空间满了,这个选择没能保存 —— 先回今天页点「一键腾空间」。', 'Local storage is full — this choice could not be saved. Tap "Free up space" on the Today page first.'));
        }
      })();
    }
  }
  function pickLang(next: PortalLocale) {
    saveProfileSettings({ locale: next }); // PROFILE_UPDATED_EVENT → 全站即时切换
  }
  // 每日 AI 图文日报开关(即点即生效;存 profile,saveProfileSettings 已接 storage-health)。
  function toggleDailyReport() {
    setDailyReportOn((v) => {
      saveProfileSettings({ dailyReportEnabled: !v });
      return !v;
    });
  }
  function toggleHaptics() {
    setHapticsOn((v) => {
      try { localStorage.setItem(HAPTIC_FEEDBACK_KEY, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }

  const [prefsOpen, setPrefsOpen] = useState(false);
  const toneOpts: Array<{ id: ToneStyle; label: string; hint: string }> = [
    { id: 'warm', label: t(locale, 'toneWarm'), hint: t(locale, 'toneWarmHint') },
    { id: 'direct', label: t(locale, 'toneDirect'), hint: t(locale, 'toneDirectHint') },
    { id: 'minimal', label: t(locale, 'toneMinimalist'), hint: t(locale, 'toneMinimalistHint') },
  ];
  const levelOpts: Array<{ id: InterruptLevel; label: string; hint: string }> = [
    { id: 'proactive', label: t(locale, 'levelProactive'), hint: t(locale, 'levelProactiveHint') },
    { id: 'minimal', label: t(locale, 'levelLight'), hint: t(locale, 'levelLightHint') },
    { id: 'silent', label: t(locale, 'levelSilent'), hint: t(locale, 'levelSilentHint') },
  ];
  const themeOpts: Array<{ id: ThemeChoice; label: string; icon: React.ReactNode }> = [
    { id: 'day', label: t(locale, 'themeDay'), icon: <IconSun size={16} /> },
    { id: 'auto', label: t(locale, 'themeAuto'), icon: <IconHalfMoon size={16} /> },
    { id: 'night', label: t(locale, 'themeNight'), icon: <IconMoon size={16} /> },
  ];

  return (
    <SheetWrap open={open} onClose={onClose} title={t(locale, 'generalTitle')} tip={t(locale, 'generalDesc')}>

      {/* 批次 134·设计「通用·精简」:去掉「语气 + 主动提醒程度」和偏好折叠;开关组直接铺开。 */}
      <p className="nesio-settings-section-label">{L(dict, '开关', 'Switches')}</p>
      <button type="button"
        className={`nesio-settings-option${dailyReportOn ? ' nesio-settings-option--active' : ''}`}
        onClick={toggleDailyReport}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '每日 AI 图文日报', 'Daily AI report')}</span>
          <span className="nesio-settings-option-hint">{L(dict, '每天存进记忆 · 首页回顾里给你', 'Saved to Memory daily · shown in Today')}</span>
        </div>
        <span className={`nesio-settings-space-check${dailyReportOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {dailyReportOn ? '✓' : '○'}
        </span>
      </button>
      <button type="button"
        className={`nesio-settings-option${hapticsOn ? ' nesio-settings-option--active' : ''}`}
        onClick={toggleHaptics}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '触感反馈', 'Haptics')}</span>
          <span className="nesio-settings-option-hint">{L(dict, '记录成功/找到/长按录音时轻震', 'Gentle buzz when you save, find something, or hold to record')}</span>
        </div>
        <span className={`nesio-settings-space-check${hapticsOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {hapticsOn ? '✓' : '○'}
        </span>
      </button>
      {/* 批次 56:记忆自动定位 —— 开启即请求手机定位权限(权限时刻在这里,不在记录途中) */}
      <button type="button"
        className={`nesio-settings-option${captureLocOn ? ' nesio-settings-option--active' : ''}`}
        onClick={() => {
          const next = !captureLocOn;
          setCaptureLocOn(next);
          setCaptureLocationEnabled(next);
        }}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '记忆自动定位', 'Auto-locate memories')}</span>
          <span className="nesio-settings-option-hint">{L(dict, '亲手记的带上位置 · 只存本机', 'Your own notes get a location · kept on this device only')}</span>
        </div>
        <span className={`nesio-settings-space-check${captureLocOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {captureLocOn ? '✓' : '○'}
        </span>
      </button>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionAppearance')}<InfoTip text={t(locale, 'generalAutoHint')} /></p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {themeOpts.map((opt) => (
          <button key={opt.id} type="button"
            className={`nesio-settings-option${theme === opt.id ? ' nesio-settings-option--active' : ''}`}
            style={{ flex: 1, justifyContent: 'center', gap: '0.35rem' }}
            onClick={() => pickTheme(opt.id)}>
            {opt.icon}
            <span className="nesio-settings-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
      {themeSaveIssue && (
        <p style={{ marginTop: '0.4rem', fontSize: '0.76rem', color: 'var(--status-risk, #c0564f)' }}>{themeSaveIssue}</p>
      )}

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionLanguage')}<InfoTip text={t(locale, 'langSoonHint')} /></p>
      {/* 批次 5:下拉选择,只开放字典已完成的语言(真实有效红线:不给不生效的选项) */}
      <select
        value={locale}
        onChange={(e) => pickLang(e.target.value as PortalLocale)}
        aria-label={t(locale, 'sectionLanguage')}
        style={{ width: '100%', minHeight: 'var(--tap-min)', borderRadius: '0.75rem', border: '1.5px solid var(--portal-line)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)', fontSize: '0.88rem', padding: '0.55rem 0.75rem', outline: 'none', fontFamily: 'inherit' }}
      >
        <optgroup label={t(locale, 'langGroupReady')}>
          {PORTAL_LOCALE_OPTIONS.filter(([code]) => READY_LOCALES.has(code)).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </optgroup>
        <optgroup label={t(locale, 'langGroupSoon')}>
          {PORTAL_LOCALE_OPTIONS.filter(([code]) => !READY_LOCALES.has(code)).map(([code, label]) => (
            <option key={code} value={code} disabled>{label}</option>
          ))}
        </optgroup>
      </select>

    </SheetWrap>
  );
}

// 兼容旧引用(契约/历史调用点):ToneSheet 即 GeneralSheet
export const ToneSheet = GeneralSheet;

// ── 档案(批次 138·设计「档案与账户分开」):昵称 + 头像,从账户拆出 ──
// 图3:ProfileSheet(档案页)已删除 —— 昵称与更换头像并入 AccountSheet(账户)。

// ── 外观与语言(批次 138:从通用拆出;明暗 + 语言。配色仍在「数据与隐私·实验功能」预览门控下)──
export function AppearanceSheet({ open, onClose }: SheetProps) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const [themeSaveIssue, setThemeSaveIssue] = useState('');

  useEffect(() => {
    if (!open) return;
    try {
      const th = localStorage.getItem(THEME_KEY);
      setTheme(th === 'day' || th === 'night' ? th : 'auto');
    } catch { /* ignore */ }
  }, [open]);

  function pickTheme(next: ThemeChoice) {
    setTheme(next);
    applyTheme(next);
    touchProfileIdentity(); // 批次205:主题跨端 —— 打新 profile 时间戳 + 广播,触发自动回推

    try {
      localStorage.setItem(THEME_KEY, next);
      setThemeSaveIssue('');
    } catch {
      void (async () => {
        try {
          const { runStorageRelief } = await import('@/lib/portal/storage-relief');
          await runStorageRelief();
          localStorage.setItem(THEME_KEY, next);
          setThemeSaveIssue('');
        } catch {
          setThemeSaveIssue(L(dict, '本机空间满了,这个选择没能保存 —— 先回今天页点「一键腾空间」。', 'Local storage is full — this choice could not be saved. Tap "Free up space" on the Today page first.'));
        }
      })();
    }
  }
  function pickLang(next: PortalLocale) {
    saveProfileSettings({ locale: next }); // PROFILE_UPDATED_EVENT → 全站即时切换
  }
  const themeOpts: Array<{ id: ThemeChoice; label: string; icon: React.ReactNode }> = [
    { id: 'day', label: t(locale, 'themeDay'), icon: <IconSun size={16} /> },
    { id: 'auto', label: t(locale, 'themeAuto'), icon: <IconHalfMoon size={16} /> },
    { id: 'night', label: t(locale, 'themeNight'), icon: <IconMoon size={16} /> },
  ];

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '外观与语言', 'Appearance & language')}>
      <p className="nesio-settings-section-label">{t(locale, 'sectionAppearance')}<InfoTip text={t(locale, 'generalAutoHint')} /></p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {themeOpts.map((opt) => (
          <button key={opt.id} type="button"
            className={`nesio-settings-option${theme === opt.id ? ' nesio-settings-option--active' : ''}`}
            style={{ flex: 1, justifyContent: 'center', gap: '0.35rem' }}
            onClick={() => pickTheme(opt.id)}>
            {opt.icon}
            <span className="nesio-settings-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
      {themeSaveIssue && (
        <p style={{ marginTop: '0.4rem', fontSize: '0.76rem', color: 'var(--status-risk, #c0564f)' }}>{themeSaveIssue}</p>
      )}

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionLanguage')}<InfoTip text={t(locale, 'langSoonHint')} /></p>
      <select
        value={locale}
        onChange={(e) => pickLang(e.target.value as PortalLocale)}
        aria-label={t(locale, 'sectionLanguage')}
        style={{ width: '100%', minHeight: 'var(--tap-min)', borderRadius: '0.75rem', border: '1.5px solid var(--portal-line)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)', fontSize: '0.88rem', padding: '0.55rem 0.75rem', outline: 'none', fontFamily: 'inherit' }}
      >
        <optgroup label={t(locale, 'langGroupReady')}>
          {PORTAL_LOCALE_OPTIONS.filter(([code]) => READY_LOCALES.has(code)).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </optgroup>
        <optgroup label={t(locale, 'langGroupSoon')}>
          {PORTAL_LOCALE_OPTIONS.filter(([code]) => !READY_LOCALES.has(code)).map(([code, label]) => (
            <option key={code} value={code} disabled>{label}</option>
          ))}
        </optgroup>
      </select>
    </SheetWrap>
  );
}

// ── 数据(二级菜单:我的数据 / 数据接入)──────────────

export function DataSheet({ open, onClose, onOpenMine, onOpenConnect }: SheetProps & {
  onOpenMine: () => void;
  onOpenConnect: () => void;
}) {
  const locale = usePortalLocale();
  return (
    <SheetWrap open={open} onClose={onClose} title={t(locale, 'dataTitle')}>
      <p className="nesio-settings-sheet-desc">{t(locale, 'dataDesc')}</p>
      {([
        { icon: <IconShield />, label: t(locale, 'dataMine'), hint: t(locale, 'dataMineHint'), onClick: onOpenMine },
        { icon: <IconLink />, label: t(locale, 'dataConnect'), hint: t(locale, 'dataConnectHint'), onClick: onOpenConnect },
      ]).map((row) => (
        <button key={row.label} type="button" className="nesio-settings-option" onClick={row.onClick}>
          <span style={{ color: 'var(--portal-accent)', display: 'inline-flex' }}>{row.icon}</span>
          <div style={{ flex: 1 }}>
            <span className="nesio-settings-option-label">{row.label}</span>
            <span className="nesio-settings-option-hint">{row.hint}</span>
          </div>
          <span style={{ color: 'var(--portal-muted)', display: 'inline-flex' }}><IconChevronRight size={16} /></span>
        </button>
      ))}
    </SheetWrap>
  );
}

// ── 隐私与数据 ────────────────────────────────────────


export function PrivacySheet({ open, onClose, onOpenConnect }: SheetProps & { onOpenConnect: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [nodeCount, setNodeCount] = useState(0);
  const [deleted, setDeleted] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  // 云备份(付费,规划中):状态机 idle→pushing→done/error,失败必可见(设计红线)。
  const [cloudState, setCloudState] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle');
  const [cloudError, setCloudError] = useState<CloudBackupError | null>(null);
  const [cloudBackupAt, setCloudBackupAt] = useState<string | null>(null);
  const [cloudEntitled, setCloudEntitled] = useState(false);
  const [cloudRestoreState, setCloudRestoreState] = useState<'idle' | 'pulling' | 'error'>('idle');
  const [cloudRestoreError, setCloudRestoreError] = useState<CloudRestoreError | null>(null);
  // 免费最大化·Google 扩展授权:免费云备份到用户自己的 Google Drive(appDataFolder)
  const [driveState, setDriveState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [driveMsg, setDriveMsg] = useState('');
  // 备份目的地选择器:'drive'=Google Drive(免费)/ 'nesio'=Nesio 云(兜底)。默认免费的 Drive。
  const [backupDest, setBackupDest] = useState<'drive' | 'nesio'>('drive');
  // 批次 151(QA #8):云状态此前写死「0 · 未登录」,不读真实登录态。取真会话,如实显示。
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem('nesio-backup-dest'); if (v === 'nesio' || v === 'drive') setBackupDest(v); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!open) return;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { loggedIn?: boolean }) => setSignedIn(Boolean(d?.loggedIn)))
      .catch(() => {});
  }, [open]);
  // 批次202:跨端同步诊断 —— 每端一眼看出 版本/登录/身份戳,定位「为何不同步」。
  const buildSha = (process.env.NEXT_PUBLIC_BUILD_SHA || 'dev').slice(0, 7);
  const [diagLocalAt, setDiagLocalAt] = useState('');
  const [diagCloudAt, setDiagCloudAt] = useState('');
  const [diagSyncMsg, setDiagSyncMsg] = useState('');
  const [diagSweepMsg, setDiagSweepMsg] = useState('');
  const loadDiag = useCallback(() => {
    setDiagLocalAt(profileIdentityUpdatedAt());
    createAppApiClient().fetchCloudProfileSettings()
      .then((r) => setDiagCloudAt(r.ok && typeof r.settings?.identityUpdatedAt === 'string' ? r.settings.identityUpdatedAt : ''))
      .catch(() => {});
  }, []);
  useEffect(() => { if (open) loadDiag(); }, [open, loadDiag]);
  async function handleForceSync() {
    setDiagSyncMsg(L(dict, '同步中…', 'Syncing…'));
    try {
      await Promise.all([syncMemoryWithCloud({ force: true }), syncProfileWithCloud()]);
      setDiagSyncMsg(L(dict, '✓ 已同步 · 下拉刷新看结果', '✓ Synced · pull to refresh'));
      loadDiag();
    } catch { setDiagSyncMsg(L(dict, '同步失败', 'Sync failed')); }
  }
  // 批次208:手动「立即巡查」—— 绕过每天一次闸,当场跑 Layer ③ 巡查测信噪比(web 上即可测,不必进 Apple)。
  async function handleRunSweep() {
    setDiagSweepMsg(L(dict, '巡查中…', 'Sweeping…'));
    try {
      const r = await runSweepNow(getLifeGraph());
      if (!r.ok) {
        setDiagSweepMsg(L(dict, `巡查未成:${r.note || '失败'}`, `Sweep failed: ${r.note || ''}`));
      } else if (r.candidates === 0) {
        setDiagSweepMsg(L(dict, '没有可巡查的低置信线索(先记一条藏了到期日的东西再试)', 'No low-confidence candidates yet'));
      } else {
        setDiagSweepMsg(L(dict, `✓ 送 ${r.candidates} 条 → 抽出 ${r.findings} 条 · 回今日下拉刷新看卡`, `✓ ${r.candidates} sent → ${r.findings} found · pull to refresh Today`));
      }
    } catch { setDiagSweepMsg(L(dict, '巡查失败', 'Sweep failed')); }
  }
  const fmtAt = (iso: string) => (iso ? iso.slice(5, 16).replace('T', ' ') : '—');
  const pickBackupDest = (d: 'drive' | 'nesio') => {
    setBackupDest(d);
    try { localStorage.setItem('nesio-backup-dest', d); } catch { /* ignore */ }
  };

  async function handleDriveBackup() {
    setDriveState('busy'); setDriveMsg('');
    const { pushBackupToDrive } = await import('@/lib/portal/drive-backup');
    const r = await pushBackupToDrive();
    if (r.ok) { setDriveState('done'); setDriveMsg(L(dict, '✓ 已免费备份到你的 Google Drive', '✓ Backed up free to your Google Drive')); }
    else if (r.error === 'not_connected') {
      // 兜底:没连 Google → 自动落回 Nesio 云(用户要求「我们的云兜底」)
      setDriveState('idle'); setDriveMsg(L(dict, '未连接 Google,改用 Nesio 云…', 'Google not connected — using Nesio cloud…'));
      await handleCloudBackup();
    } else {
      setDriveState('error');
      setDriveMsg(L(dict, '备份到 Drive 没成功 —— 稍后再试或用「导出完整备份」', "Drive backup didn't go through — try again later or use Export full backup"));
    }
  }
  // 备份/恢复走用户选的目的地(Drive 失败自动兜底 Nesio 已在 handleDriveBackup 内)
  const handleBackupChosen = () => (backupDest === 'drive' ? handleDriveBackup() : handleCloudBackup());
  const handleRestoreChosen = () => (backupDest === 'drive' ? handleDriveRestore() : handleCloudRestore());
  async function handleDriveRestore() {
    if (!confirm(L(dict, '从 Google Drive 恢复:把云端备份合并回本机(仅补缺,不覆盖已有)。完成后自动刷新。继续?', 'Restore from Google Drive: merges the backup into this device (fills gaps, keeps existing). Refreshes when done. Continue?'))) return;
    setDriveState('busy'); setDriveMsg('');
    const { pullBackupFromDrive } = await import('@/lib/portal/drive-backup');
    const r = await pullBackupFromDrive('merge');
    if (r.ok) { setDriveMsg(L(dict, '✓ 已从 Drive 恢复,正在刷新…', '✓ Restored from Drive, refreshing…')); setTimeout(() => window.location.reload(), 900); }
    else {
      setDriveState('error');
      setDriveMsg(r.error === 'no_backup'
        ? L(dict, '你的 Drive 里还没有备份 —— 先点上面「免费备份到 Google Drive」', 'No backup in your Drive yet — tap "Back up free to Google Drive" above first')
        : r.error === 'not_connected'
          ? L(dict, '先连接 Google 再恢复', 'Connect Google first')
          : L(dict, '从 Drive 恢复没成功 —— 稍后再试', "Restore from Drive didn't go through — try again later"));
    }
  }

  function cloudErrorText(err: CloudBackupError): string {
    switch (err) {
      case 'entitlement_required': return L(dict, '云备份即将开放 —— 到下方「订阅」留个位,开放时第一时间通知你。', "Cloud backup is coming soon — join the waitlist under Subscription and we'll ping you first.");
      case 'not_signed_in': return L(dict, '先登录(上方入口),才能同步到你的云账户。', 'Sign in first (link above) to sync to your cloud account.');
      case 'cloud_not_configured': return L(dict, '云同步暂未开启,稍后再试。', "Cloud sync isn't enabled yet — try again later.");
      case 'too_large': return L(dict, '数据超过 8MB 单次上限,先导出到本地留一份。', 'Data is over the 8MB limit — export a local copy for now.');
      default: return L(dict, '这次没传上去。检查网络后可以再试一次。', "Didn't go through. Check your connection and try again.");
    }
  }

  async function handleCloudBackup() {
    setCloudState('pushing');
    setCloudError(null);
    const result = await pushBackupToCloud();
    if (result.ok) {
      setCloudState('done');
      setCloudBackupAt(result.at || new Date().toISOString());
    } else {
      setCloudState('error');
      setCloudError(result.error || 'network');
    }
  }

  function cloudRestoreErrorText(err: CloudRestoreError): string {
    if (err === 'no_backup') return L(dict, '还没有云备份可恢复,先点上面「备份到云」。', 'No cloud backup yet — tap "Back up to cloud" above first.');
    if (err === 'invalid_backup') return L(dict, '云端备份读出来不是有效文件,本机没有改动。', "The cloud backup didn't read as a valid file — nothing changed locally.");
    return cloudErrorText(err as CloudBackupError);
  }

  async function handleCloudRestore() {
    if (!confirm(L(dict, '从云恢复:把云端备份合并回本机(仅补缺,不覆盖已有数据)。完成后会自动刷新。确认继续？', 'Restore from cloud: merges your cloud backup into this device (fills gaps, keeps existing). It will refresh when done. Continue?'))) return;
    setCloudRestoreState('pulling');
    setCloudRestoreError(null);
    const result = await pullBackupFromCloud('merge');
    if (result.ok) {
      setCloudRestoreState('idle');
      setTimeout(() => window.location.reload(), 700); // reload 让各 store 重新水合
    } else {
      setCloudRestoreState('error');
      setCloudRestoreError(result.error || 'network');
    }
  }

  // 数据审计 #8:兑现「随时导出你的全部数据」—— 直接下载一份完整备份 JSON 到本机
  // (localStorage + IDB blob + 照片),与「导入备份」对称、无需上云。每个异步动作都有可见失败态。
  async function handleExportLocal() {
    if (exportBusy) return;
    setExportBusy(true);
    setRestoreMsg('');
    try {
      const backup = await buildCombinedBackup({ includeImages: true });
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nesio-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setRestoreMsg(L(dict, '✓ 已导出到本机', '✓ Exported to your device'));
    } catch {
      setRestoreMsg(L(dict, '导出失败,请重试', 'Export failed — please try again'));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); }
    catch { setRestoreMsg(L(dict, '文件不是有效的 JSON', 'File is not valid JSON')); return; }
    if (!isValidBackup(parsed)) { setRestoreMsg(L(dict, '不是有效的 Nesio 备份文件', 'Not a valid Nesio backup file')); return; }

    const replace = confirm(L(dict,
      `备份包含 ${Object.keys(parsed.entries).length} 项数据（${parsed.exportedAt.slice(0, 10)} 导出）。\n\n` +
      '「确定」= 覆盖恢复（备份内容覆盖本机）\n「取消」= 合并恢复（记忆按条合并，其余仅补缺）',
      `Backup holds ${Object.keys(parsed.entries).length} entries (exported ${parsed.exportedAt.slice(0, 10)}).\n\n` +
      'OK = replace (backup overwrites this device)\nCancel = merge (memories merge per item, the rest fills gaps only)',
    ));
    // restoreCombinedBackup 按 IDB 登记分流(健康/财务/地点落 IDB、其余落 localStorage);
    // 修了旧 restoreFullBackup 全写 localStorage 在 replace 模式对已迁 IDB 数据静默失效的坑。
    const result = await restoreCombinedBackup(parsed, replace ? 'replace' : 'merge');
    const total = result.restoredKeys + result.idbRestored;
    const corrupt = result.corruptKeys.length;
    const photos = result.imagesRestored || 0;
    // 记忆照片存独立 IDB(nesio-images),恢复要单独如实计数 —— 否则用户不知道图回来没
    const photoZh = photos > 0 ? `，含 ${photos} 张照片` : '';
    const photoEn = photos > 0 ? `, ${photos} photos` : '';
    if (corrupt > 0) {
      // 静默失败审计:备份里有损坏条目未能恢复 —— 不谎称完全成功,如实告知(本机原串已保留)
      setRestoreMsg(L(dict,
        `已恢复 ${total} 项${photoZh}，但有 ${corrupt} 项备份数据损坏未能恢复（本机原数据已保留，未被覆盖）· 正在刷新…`,
        `Restored ${total} entries${photoEn}, but ${corrupt} were corrupt in the backup and could not be restored (your local data was kept, not overwritten) · refreshing…`));
    } else {
      setRestoreMsg(L(dict,
        `✓ 已恢复 ${total} 项${photoZh}${result.mergedNodes != null ? `，记忆合并后共 ${result.mergedNodes} 条` : ''} · 正在刷新…`,
        `✓ Restored ${total} entries${photoEn}${result.mergedNodes != null ? `, ${result.mergedNodes} memories after merge` : ''} · refreshing…`));
    }
    // 恢复含 IDB blob —— reload 让各 blob store 重新水合(缓存是加载时读的)
    setTimeout(() => window.location.reload(), corrupt > 0 ? 2600 : 900);
  }

  useEffect(() => {
    if (!open) return;
    setDeleted(false);
    // 图谱已迁 IDB(异步水合):首次 getLifeGraph() 在水合完成前返回空 seed。只读一次会把
    // 「我的数据」定格成「0 条记忆」——用户来这核实隐私,却读到谎报的 0(洞察面板同源却因
    // 晚开、水合已完成而正确)。订阅 nesio-life-graph-updated,水合/增删后重读,口径一致。
    const readCount = () => setNodeCount(getLifeGraph().length);
    readCount();
    window.addEventListener('nesio-life-graph-updated', readCount);
    setCloudState('idle');
    setCloudError(null);
    setCloudEntitled(hasCloudEntitlement());
    setCloudBackupAt(lastCloudBackup()?.at ?? null);
    try {
      setLastBackupAt(localStorage.getItem('nesio-last-backup-at'));
    } catch { /* ignore */ }
    return () => window.removeEventListener('nesio-life-graph-updated', readCount);
  }, [open]);

  function clearAllMemory() {
    if (!confirm(L(dict, '删除后，Nesio 不再用这些记忆提醒你。确认继续？', 'After deleting, Nesio will no longer use these memories to remind you. Continue?'))) return;
    const nodes = getLifeGraph();
    nodes.forEach((n) => deleteLifeNode(n.id));
    setNodeCount(0);
    setDeleted(true);
  }

  // 删除收口:清本机「全部」数据(记忆 + 健康/财务/地点/心情/学习偏好…),经 storage-manifest 遍历,
  // 保留登录票据(不登出)。此前「清除 Memory」只删记忆节点,其余域数据全留在本机 = 隐私漏洞。
  function clearAllLocalData() {
    if (!confirm(L(dict, '这会删除本机全部数据(记忆、健康、财务、地点、心情、学习偏好…),仅保留登录状态,不可撤销。建议先导出备份。确认继续？', 'This deletes ALL local data (memories, health, finance, places, mood, learned preferences), keeping only your sign-in. It cannot be undone — export a backup first. Continue?'))) return;
    try {
      getLifeGraph().forEach((n) => deleteLifeNode(n.id)); // 记忆节点走正规删除(传导事实库/云)
      purgeLocalData(localStorage);                         // localStorage 全部本机 key 收口清除(保留 auth)
      void purgeIdbBlobs();                                 // IDB blob(健康/临床/地点)一并清 —— 别漏
      void purgeLocalImages();                              // 隐私审计:记忆照片在独立 IDB(nesio-images),必须一并清,否则「删除」留图在本机
    } catch { /* ignore */ }
    setNodeCount(0);
    setDeleted(true);
    window.location.reload();
  }

  // App Store 强制(Guideline 5.1.1):App 内可达的**账号删除**。之前 user-data/delete 路由
  // 已实现(删云端全部数据+存储),但没接任何 UI → 上架会被拒。这里接上:确认 → 云删 →
  // 清本机 → 登出 → 回首页。云删失败不谎称成功(如实提示)。
  async function deleteAccountAndData() {
    if (!confirm(L(dict,
      '删除账号:将删除云端全部数据(记忆/资料/资产/事件)+ 本机数据,并退出登录,不可撤销。建议先导出备份。确认？',
      'Delete account: removes ALL cloud data (memories/profile/assets/events) + local data, and signs you out. This cannot be undone — export a backup first. Continue?'))) return;
    setDeleteMsg(L(dict, '正在删除云端账号数据…', 'Deleting cloud account data…'));
    try {
      // 上报本设备遥测 id → 服务端设备级擦除匿名遥测(数据审计 #5/#6 被遗忘权)。
      const telemetryDeviceId = getTelemetryDeviceId();
      const res = await fetch('/api/user-data/delete?dryRun=0', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: 'DELETE_CLOUD_PRODUCT_DATA',
          deviceIds: telemetryDeviceId ? [telemetryDeviceId] : [],
        }),
      });
      if (res.status === 401) { setDeleteMsg(null); clearAllLocalData(); return; } // 未登录 → 无云账号可删,退化本机删除
      const data = await res.json().catch(() => null) as { ok?: boolean } | null;
      if (!res.ok || !data?.ok) { setDeleteMsg(L(dict, '云端删除失败,未改动任何数据。请稍后重试。', 'Cloud deletion failed — nothing was changed. Please try again later.')); return; }
    } catch { setDeleteMsg(L(dict, '网络错误,云端未删除。', 'Network error — cloud not deleted.')); return; }
    // 云删成功 → 清本机 + 登出
    try {
      getLifeGraph().forEach((n) => deleteLifeNode(n.id));
      purgeLocalData(localStorage); void purgeIdbBlobs(); void purgeLocalImages();
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch { /* ignore */ }
    setDeleteMsg(L(dict, '✓ 账号与全部数据已删除,正在登出…', '✓ Account and all data deleted, signing out…'));
    setTimeout(() => { try { window.location.href = '/'; } catch { /* ignore */ } }, 1200);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '数据与隐私', 'Data & privacy')}>

      {/* 数据主权面板 — local-first 从架构卖点变成可感知的安全感 */}
      <div style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.08))', borderRadius: 14, padding: '0.8rem 1rem', marginBottom: '0.9rem' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 600, margin: '0 0 0.4rem', color: 'var(--portal-blue-deep)', display: 'flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> {L(dict, '你的数据在哪里', 'Where your data lives')}<InfoTip text={L(dict, '记忆存在本设备 localStorage;未登录、未授权或未选择接入的日历、邮件、健康和文件内容永远不会被加载;登录后才开启跨设备云同步。', "Memories live in this device's localStorage. Calendar, mail, health and files are never loaded unless you sign in, authorize and connect them. Cross-device cloud sync starts only after sign-in.")} /></p>
        <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.7rem', lineHeight: 1.6 }}>
          <div><span style={{ fontSize: '1rem', fontWeight: 700 }}>{nodeCount}</span><br />{L(dict, '条记忆,全在本机', 'memories, all on this device')}</div>
          <div><span style={{ fontSize: '1rem', fontWeight: 700 }}>{signedIn ? '✓' : '0'}</span><br />{signedIn ? L(dict, '已登录 · 云同步已开', 'signed in · cloud sync on') : L(dict, '未登录 · 仅本机', 'signed out · on-device only')}</div>
          <div>
            <span style={{ fontSize: '1rem', fontWeight: 700 }}>{lastBackupAt ? new Date(lastBackupAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' }) : L(dict, '还没有', 'never')}</span><br />
            {lastBackupAt ? L(dict, '上次备份', 'last backup') : L(dict, '备份过', 'backed up')}
          </div>
        </div>
        {!lastBackupAt && (
          <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', margin: '0.4rem 0 0' }}>{L(dict, '你的数据你拥有 —— 一键导出,记忆、健康、学到的偏好全带走,换手机也不会丢。', 'Your data is yours — export once and take your memories, health and learned preferences anywhere.')}</p>
        )}
        {/* 批次202:跨端同步诊断 —— 每端一眼看出 版本/登录/身份戳,定位为何不同步 */}
        <div style={{ marginTop: '0.55rem', paddingTop: '0.45rem', borderTop: '1px solid var(--portal-line)', fontSize: '0.62rem', color: 'var(--portal-muted)', lineHeight: 1.7 }}>
          <div>{L(dict, '同步诊断', 'Sync diag')} · {L(dict, '构建', 'build')} <b>{buildSha}</b> · {signedIn ? L(dict, '已登录', 'signed in') : <b style={{ color: 'var(--status-risk)' }}>{L(dict, '⚠ 未登录', '⚠ signed out')}</b>}</div>
          <div>{L(dict, '身份戳', 'identity')} · {L(dict, '本机', 'local')} {fmtAt(diagLocalAt)} · {L(dict, '云端', 'cloud')} {fmtAt(diagCloudAt)}</div>
          <button type="button" onClick={handleForceSync} style={{ marginTop: 5, fontSize: '0.66rem', padding: '0.25rem 0.65rem', borderRadius: 8, border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-blue-deep)', cursor: 'pointer' }}>{L(dict, '立即同步(记忆+头像名字)', 'Sync now')}</button>
          {diagSyncMsg && <span style={{ marginLeft: 8 }}>{diagSyncMsg}</span>}
          {/* 批次208:手动跑 Layer ③ 巡查(测试低置信捕捉里的到期/续期信噪比,web 上即可,不必进 Apple) */}
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={handleRunSweep} style={{ fontSize: '0.66rem', padding: '0.25rem 0.65rem', borderRadius: 8, border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-blue-deep)', cursor: 'pointer' }}>{L(dict, '立即巡查(找漏掉的到期/续期)', 'Run sweep now')}</button>
            {diagSweepMsg && <span style={{ marginLeft: 8 }}>{diagSweepMsg}</span>}
          </div>
        </div>
      </div>

      {/* 图5:数据接入从「记录习惯」并入这里 —— 连接数据源(ConnectorsHub) */}
      <p className="nesio-settings-section-label">{L(dict, '数据接入', 'Connect data')}</p>
      <button type="button" className="nesio-settings-option" onClick={onOpenConnect}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '连接数据源', 'Connected sources')}</span>
          <span className="nesio-settings-option-hint">{L(dict, 'Gmail · 日历 · Notion · 健康 · 银行 …', 'Gmail · Calendar · Notion · Health · Bank …')}</span>
        </div>
        <span aria-hidden style={{ color: 'var(--portal-muted)' }}>›</span>
      </button>

      {/* 备份与恢复(图2:去掉「云同步与备份」标题与登录同步行,直接进备份目的地) */}
      <p style={{ fontSize: '0.78rem', color: 'var(--portal-muted)', margin: '1.2rem 0 0.3rem' }}>{L(dict, '备份到哪里', 'Back up to')}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        {([['drive', L(dict, '☁ Google Drive · 免费', '☁ Google Drive · Free')], ['nesio', L(dict, `☁ Nesio 云${cloudEntitled ? '' : ' · Pro 免费'}`, `☁ Nesio cloud${cloudEntitled ? '' : ' · free with Pro'}`)]] as const).map(([d, label]) => (
          <button key={d} type="button" onClick={() => pickBackupDest(d)}
            style={{ flex: 1, padding: '0.4rem 0.5rem', borderRadius: 10, fontSize: '0.8rem', cursor: 'pointer',
              border: `1px solid ${backupDest === d ? 'var(--portal-accent-border)' : 'var(--portal-line)'}`,
              background: backupDest === d ? 'var(--portal-accent-soft-md)' : 'transparent',
              color: backupDest === d ? 'var(--portal-ink)' : 'var(--portal-muted)' }}>
            {label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', margin: '0 0 0.4rem' }}>
        {backupDest === 'drive'
          ? L(dict, '存到你自己的 Google Drive(免费,私有文件夹);没连 Google 会自动改用 Nesio 云兜底。', 'Saved to your own Google Drive (free, private folder); falls back to Nesio cloud if Google isn\'t connected.')
          : L(dict, '存到 Nesio 云(Pro 权益,试用期内可用)。', 'Saved to Nesio cloud (a Pro benefit; available during trial).')}
      </p>

      <button type="button" className="nesio-settings-action-btn" onClick={handleBackupChosen} disabled={cloudState === 'pushing' || driveState === 'busy'}>
        {(cloudState === 'pushing' || driveState === 'busy') ? L(dict, '正在备份…', 'Backing up…') : L(dict, '备份', 'Back up')}
      </button>
      <button type="button" className="nesio-settings-action-btn" onClick={handleRestoreChosen} disabled={cloudRestoreState === 'pulling' || driveState === 'busy'}>
        {(cloudRestoreState === 'pulling') ? L(dict, '正在恢复…', 'Restoring…') : L(dict, '从云恢复', 'Restore from cloud')}
      </button>
      {/* 状态:仅当前所用目的地会填充 */}
      {cloudState === 'done' && (
        <p style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--status-go)' }}>
          {L(dict, '✓ 已备份到 Nesio 云', '✓ Backed up to Nesio cloud')}{cloudBackupAt ? ` · ${new Date(cloudBackupAt).toLocaleString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
      )}
      {cloudState === 'error' && cloudError && (
        <p style={{ fontSize: '0.75rem', marginTop: 4, color: cloudError === 'entitlement_required' ? 'var(--portal-muted)' : 'var(--status-risk)' }}>
          {cloudErrorText(cloudError)}
        </p>
      )}
      {cloudRestoreState === 'error' && cloudRestoreError && (
        <p style={{ fontSize: '0.75rem', marginTop: 4, color: cloudRestoreError === 'entitlement_required' || cloudRestoreError === 'no_backup' ? 'var(--portal-muted)' : 'var(--status-risk)' }}>
          {cloudRestoreErrorText(cloudRestoreError)}
        </p>
      )}
      {driveMsg && <p style={{ fontSize: '0.75rem', marginTop: 4, color: driveState === 'error' ? 'var(--status-risk)' : 'var(--status-go)' }}>{driveMsg}</p>}

      <button type="button" className="nesio-settings-action-btn" onClick={handleExportLocal} disabled={exportBusy}>
        {exportBusy ? L(dict, '正在导出…', 'Exporting…') : L(dict, '导出全部(记忆 + 学到的偏好,下载 JSON)', 'Export everything (memories + learned prefs, JSON)')}
      </button>
      <button type="button" className="nesio-settings-action-btn" onClick={() => importRef.current?.click()}>
        {L(dict, '导入备份', 'Import backup')}
      </button>
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={handleImportFile} />
      {restoreMsg && <p style={{ fontSize: '0.75rem', marginTop: 4, color: restoreMsg.startsWith('✓') ? 'var(--status-go)' : 'var(--status-risk)' }}>{restoreMsg}</p>}

      <button type="button" className="nesio-settings-danger-btn" onClick={clearAllMemory}>
        {deleted ? L(dict, '✓ 已清除', '✓ Cleared') : L(dict, '清除所有 Memory', 'Clear all memories')}
      </button>
      <button type="button" className="nesio-settings-danger-btn" style={{ marginTop: '0.4rem', opacity: 0.85 }} onClick={clearAllLocalData}>
        {L(dict, '彻底删除本机全部数据', 'Delete all local data')}
      </button>

      {/* App Store 5.1.1 强制:App 内账号删除(云端 + 本机 + 登出)。 */}
      <button type="button" className="nesio-settings-danger-btn" style={{ marginTop: '0.4rem' }} onClick={deleteAccountAndData}>
        {L(dict, '删除账号与云端数据', 'Delete account & cloud data')}
      </button>
      {deleteMsg && <p className="nesio-settings-option-hint" style={{ margin: '0.4rem 0 0', color: 'var(--status-risk)' }}>{deleteMsg}</p>}

      {/* 图3:原顶部说明整段挪到最下面收尾 */}
      <p className="nesio-settings-sheet-desc" style={{ marginTop: '1.5rem', marginBottom: 0 }}>{L(dict, '只整理你放进来的内容。你可以看见它记住了什么、存在哪、也可以随时删除。', 'Only what you put in gets organized. You can see what it remembers, where it lives, and delete it anytime.')}</p>
    </SheetWrap>
  );
}

// ── Lab（图1:实验功能 + 功能开关中心从「数据与隐私」独立成菜单入口;新手提醒/预览引导也收进来）──
export function LabSheet({ open, onClose, onOpenPreview }: SheetProps & { onOpenPreview: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [labOn, setLabOn] = useState(false);
  const [labMsg, setLabMsg] = useState<string | null>(null);
  const [palette, setPaletteState] = useState<PaletteId>('');
  const [proOn, setProOn] = useState(false); // Lab 内 Pro 测试解锁(正式版由 StoreKit 收据服务端校验写入)
  const [moduleOv, setModuleOv] = useState<Record<string, 'on' | 'off'>>({});

  useEffect(() => {
    if (!open) return;
    try {
      setLabOn(isLabModeOn()); // 个人版默认开;只有显式 '0' 才算关
      setPaletteState(getPalette());
      setProOn(hasProOverride()); // 批次 32:显示覆盖位本身;试用期 getTier 恒 pro 会让开关关不掉
    } catch { /* ignore */ }
  }, [open]);

  // 逐模块开关:打开时读当前覆盖 + 订阅(工具箱会随覆盖实时变,不需 reload)。
  useEffect(() => {
    if (!open) return;
    const sync = () => setModuleOv(loadModuleOverrides());
    sync();
    window.addEventListener(MODULE_OVERRIDES_EVENT, sync);
    return () => window.removeEventListener(MODULE_OVERRIDES_EVENT, sync);
  }, [open]);

  function toggleLab() {
    const turningOn = !labOn;
    try {
      if (labOn) {
        // 个人版默认开:关闭必须显式写 '0'(删 key 会退回默认开)
        localStorage.setItem('baohe_personal_lab', '0');
        localStorage.removeItem('baohe_lab_mode');
        sessionStorage.removeItem('baohe_personal_lab');
        sessionStorage.removeItem('baohe_lab_mode');
      } else {
        localStorage.setItem('baohe_personal_lab', '1');
      }
    } catch { /* ignore */ }
    // 反应式:通知外壳重读角色,工具箱即时更新 —— 不再 reload。旧实现 reload 会把整个
    // 设置面板连同页面一起刷掉(QA:点 Lab 闪退出设置),现在开关就地生效、面板不动。
    setLabOn(turningOn);
    setLabMsg(turningOn ? L(dict, 'Lab 模式已开启', 'Lab mode on') : L(dict, 'Lab 模式已关闭', 'Lab mode off'));
    try { window.dispatchEvent(new CustomEvent('nesio-lab-mode-updated')); } catch { /* ignore */ }
    setTimeout(() => setLabMsg(null), 1800);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="Lab">
      {/* 图1:新手提醒/预览引导收进 Lab */}
      <p className="nesio-settings-section-label">{L(dict, '新手提醒', 'Onboarding')}</p>
      <button type="button" className="nesio-settings-option" onClick={onOpenPreview}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '预览引导 · 模拟运行', 'Preview guides · Dry run')}</span>
          <span className="nesio-settings-option-hint">{L(dict, '重放欢迎/导览、灌样例、模拟回访 —— 真机自查冷启动', 'Replay welcome/tour, seed samples, simulate re-engagement')}</span>
        </div>
        <span aria-hidden style={{ color: 'var(--portal-muted)' }}>›</span>
      </button>

      {/* 提审构建:整个 Lab + 功能开关中心不可达(合规:隐藏可达功能 = 2.3.1 违规)。 */}
      {!isAppStoreBuild() && (<>
      <p className="nesio-settings-section-label" style={{ marginTop: '1.5rem' }}>{L(dict, '实验功能', 'Experimental')}</p>
      <button type="button"
        className={`nesio-settings-option${labOn ? ' nesio-settings-option--active' : ''}`}
        onClick={toggleLab}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, `Lab 模式 ${labOn ? '· 已开启' : ''}`, `Lab mode ${labOn ? '· on' : ''}`)}</span>
          <span className="nesio-settings-option-hint">
            {labMsg
              ? labMsg
              : labOn
                ? L(dict, '个人版默认全开:实验工具与全部连接器可见。关闭可预览公开版形态。', 'Personal build defaults to all-on: experimental tools and every connector visible. Turn off to preview the public build.')
                : L(dict, '你手动关过 Lab(公开版形态预览中)。点击恢复全开(个人版默认)。', 'You turned Lab off (previewing the public build). Tap to restore all-on — the personal-build default.')}
          </span>
        </div>
        <span className={`nesio-settings-space-check${labOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {labOn ? '✓' : '○'}
        </span>
      </button>

      <button type="button"
        className={`nesio-settings-option${proOn ? ' nesio-settings-option--active' : ''}`}
        onClick={() => { const next = !proOn; setProEntitlement(next); setProOn(next); }}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, `Pro 解锁(测试)${proOn ? '· 已开启' : ''}`, `Unlock Pro (testing) ${proOn ? '· on' : ''}`)}</span>
          <span className="nesio-settings-option-hint">
            {L(dict, '仅供测试:本机置为 Pro。影响的是付费能力:冷冻仓 / AI 简报(例程) / 邮件直接回 / 多面镜月度信 / 深度云 AI —— 与下面「哪些模块可见」无关(那是 Lab 和开关中心管的)。正式版由 App 内购买 + 服务端校验决定。', 'Testing only: marks this device Pro. Controls paid abilities — Freeze Vault / AI brief (routines) / direct email reply / mirror letters / deep cloud AI. Unrelated to which modules are visible (Lab + switches below control that). Real Pro comes from in-app purchase + server verification.')}
          </span>
        </div>
        <span className={`nesio-settings-space-check${proOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {proOn ? '✓' : '○'}
        </span>
      </button>

      {/* 批次176/186:每日简报走 Portal 全局挂载 nesio-open-brief(agent 本地 briefOpen 会双挂载 + 死路径 import)。
          批次192 合并(安全审计#5):简报=AI 例程(Pro),免费走升级引导不旁路 —— Pro 门 + 全局派发合一。 */}
      <button type="button" className="nesio-settings-option" onClick={() => {
        if (!canUse('ai_routine')) { window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'ai_routine' } })); return; }
        window.dispatchEvent(new CustomEvent('nesio-open-brief')); onClose();
      }}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '看每日简报 demo', 'Preview daily brief')}</span>
          <span className="nesio-settings-option-hint">
            {L(dict, '用「问一问」同一套检索,把今天的安排/提醒写成一段话 + 相关记忆链接 —— 就是上线后每天早晨推给你的那张。', "Runs the same retrieval as Ask to sum up today into one paragraph with memory links — the card you'll get each morning once live.")}
          </span>
        </div>
        <span className="nesio-settings-option-hint" aria-hidden style={{ fontSize: '1.1rem' }}>›</span>
      </button>

      <div className="nesio-settings-option" style={{ display: 'block' }}>
        <span className="nesio-settings-option-label">
          {L(dict, `低饱和配色(预览)${palette ? ' · 已开启' : ''}`, `Low-saturation palette (preview)${palette ? ' · on' : ''}`)}
        </span>
        <span className="nesio-settings-option-hint">
          {L(dict, '莫兰迪 4 套色卡,点一张即时全站换装,再点「默认蓝」还原。', 'Four Morandi palettes — tap a card to reskin instantly; tap Default blue to restore.')}
        </span>
        <div className="nesio-palette-grid">
          {/* 默认蓝 */}
          <button type="button"
            className={`nesio-palette-card${palette === '' ? ' nesio-palette-card--on' : ''}`}
            onClick={() => { setPalette(''); setPaletteState(''); }}>
            <span className="nesio-palette-sw" data-p="default" />
            <span className="nesio-palette-name">{L(dict, '默认蓝', 'Default blue')}</span>
          </button>
          {PALETTES.map((p) => (
            <button key={p.id} type="button"
              className={`nesio-palette-card${palette === p.id ? ' nesio-palette-card--on' : ''}`}
              onClick={() => { setPalette(p.id); setPaletteState(p.id); }}>
              <span className="nesio-palette-sw" data-p={p.id} />
              <span className="nesio-palette-name">{L(dict, p.zh, p.en)}</span>
              <span className="nesio-palette-hint">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.5rem' }}>{L(dict, '功能开关中心', 'Feature switches')}</p>
      <p className="nesio-settings-option-hint" style={{ margin: '0 0 0.6rem' }}>
        {L(dict, '逐个控制功能可见性。优先级:这里的显式 开/关 最大;「默认」= 标了「随 Lab」的内测域跟随上面的 Lab 总闸,其余跟随公开版。核心(拍/说/分享/问一问/洞察/今日)始终在,不在此列。改动即时生效。',
          'Controls feature visibility. Precedence: explicit On/Off here wins; "Default" follows the Lab switch above for rows tagged "Lab", otherwise the public build. Core (snap / voice / share / ask / insights / today) is always on and not listed. Applies instantly.')}
      </p>
      {(['module', 'feature'] as const).map((kind) => {
        const rows = FEATURE_CATALOG.filter((f) => f.kind === kind);
        if (!rows.length) return null;
        return (
          <div key={kind}>
            <p className="nesio-settings-option-hint" style={{ margin: '0.6rem 0 0.3rem', fontWeight: 600 }}>
              {kind === 'module' ? L(dict, '工具模块', 'Tool modules') : L(dict, '子功能', 'Sub-features')}
            </p>
            {rows.map((m) => {
              const cur = moduleOv[m.id] ?? null; // null = 跟随默认
              const seg = (val: 'on' | 'off' | null, label: string) => (
                <button
                  type="button"
                  onClick={() => setModuleOverride(m.id, val)}
                  style={{
                    flex: 1, padding: '0.3rem 0', fontSize: '0.72rem', borderRadius: 'var(--radius)',
                    border: '0.5px solid var(--portal-border)',
                    background: cur === val ? 'var(--portal-accent-soft, var(--portal-hover))' : 'transparent',
                    color: cur === val ? 'var(--portal-accent, var(--portal-fg))' : 'var(--portal-muted)',
                    fontWeight: cur === val ? 600 : 400,
                  }}
                >{label}</button>
              );
              const defOn = defaultResolvesTo(m.id, m.defaultOn); // labOn 变化触发重渲,这里即时反映
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.4rem' }}>
                  <span style={{ flex: 1, fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {dict === 'en' ? m.en : m.zh}
                    {followsLab(m.id) && (
                      <span style={{ fontSize: '0.6rem', color: 'var(--portal-muted)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-pill)', padding: '0 0.35rem' }}>
                        {L(dict, '随 Lab', 'Lab')}
                      </span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem', width: '11rem' }}>
                    {seg(null, L(dict, `默认·${defOn ? '开' : '关'}`, `Default·${defOn ? 'on' : 'off'}`))}
                    {seg('on', L(dict, '开', 'On'))}
                    {seg('off', L(dict, '关', 'Off'))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      </>)}
    </SheetWrap>
  );
}

// ── 早期体验(诚实版,2026-07-04)────────────────────
// 此前的 7 天体验倒计时与「升级」按钮是没有支付系统支撑的假流程
// (点了只弹 alert)。改为:如实说明当前全免费 + 未来计划只做预览
// + 唯一真实动作「开放时通知我」(遥测登记意向,顺带是定价验证信号)。

const PLAN_NOTIFY_KEY = 'nesio-plan-notify-optin-v1';

// 批次194 定价定稿(用户拍板):$2/周 · $5/月 · $50/年。真实收费仍随 App 内购页;家庭版已按上架决策删除。
const PLAN_PREVIEWS = [
  { id: 'weekly', name: 'Pro · 按周', nameEn: 'Pro · Weekly', price: '$2', cycle: '/ 周', cycleEn: '/ wk', desc: '想先试试的轻量选择', descEn: 'A light way to try it out' },
  { id: 'monthly', name: 'Pro · 按月', nameEn: 'Pro · Monthly', price: '$5', cycle: '/ 月', cycleEn: '/ mo', desc: '最灵活', descEn: 'Most flexible' },
  { id: 'yearly', name: 'Pro · 按年', nameEn: 'Pro · Yearly', price: '$50', cycle: '/ 年', cycleEn: '/ yr', desc: '相当于 $4.17/月,最划算', descEn: '≈ $4.17/mo — best value' },
];

export function SubscriptionSheet({ open, onClose }: SheetProps) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [notified, setNotified] = useState(false);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [billingHint, setBillingHint] = useState<'signin' | null>(null);
  const [billingError, setBillingError] = useState('');
  const [isPaidPro, setIsPaidPro] = useState(false); // 账号级付费 Pro(服务端真源)→ 显「已是会员」而非升级

  useEffect(() => {
    if (!open) return;
    try { setNotified(localStorage.getItem(PLAN_NOTIFY_KEY) === '1'); } catch { /* ignore */ }
    // 开订阅页即拉一次最新服务端权益 + 监听更新 —— 付完回来这页能立刻反映「已是 Pro」,
    // 不再因「无 TIER_UPDATED_EVENT 监听」而永远显「升级 Pro」(付费不生效的表象)。
    const sync = () => setIsPaidPro(hasPaidPro());
    sync();
    void refreshServerEntitlement().then(sync);
    window.addEventListener(TIER_UPDATED_EVENT, sync);
    return () => window.removeEventListener(TIER_UPDATED_EVENT, sync);
  }, [open]);

  // Web Stripe 订阅结账。配了 STRIPE_* + Stripe 接受 → 跳 Stripe 付款;真·未配(503)→ 优雅降级为
  // waitlist 登记;Stripe 拒结账(502,价格/模式/配置问题)→ 把真错因显出来,别静默当成 waitlist。
  async function handleUpgrade() {
    setBillingHint(null);
    setBillingError('');
    setUpgradeBusy(true);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      if (res.status === 401) { setBillingHint('signin'); return; }
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string; detail?: string; code?: string };
      if (res.ok && data.url) { window.location.href = data.url; return; } // 跳转 Stripe Checkout
      if (data.error === 'stripe_checkout_failed') {
        setBillingError(data.detail || data.code || 'Stripe checkout failed'); // 真错因显给用户(诊断)
        return;
      }
      optIn(); // 503 真·未配 → 登记 waitlist,开放时通知
    } catch {
      optIn();
    } finally {
      setUpgradeBusy(false);
    }
  }

  function optIn() {
    try { localStorage.setItem(PLAN_NOTIFY_KEY, '1'); } catch { /* ignore */ }
    setNotified(true);
    // 双写:遥测计数(/admin Top 事件可见)+ 云产品事件(product_events 持久,
    // 登录用户带 user 归属)。收费版开放时按这两处名单通知。
    void import('@/lib/portal/telemetry').then(({ track }) => track('plan_notify_optin'));
    void import('@/lib/portal/app-api-client').then(({ createAppApiClient }) =>
      createAppApiClient().recordCloudProductEvent({
        eventType: 'plan.notify_optin',
        source: 'settings',
        targetType: 'plan',
        targetId: 'paid_plans_waitlist',
      }),
    ).catch(() => {});
  }

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '会员与权益', 'Membership')}>
      {(() => {
        const days = trialDaysLeft();
        const pro = getTier() === 'pro' && days <= 0; // 真 Pro(非试用)
        return (
          <div className="nesio-sub-status-card">
            <div className="nesio-sub-status-badge nesio-sub-status-badge--free">
              {pro ? 'PRO' : days > 0 ? L(dict, `免费试用 · 剩 ${days} 天`, `Free trial · ${days}d left`) : t(locale, 'subBadgeFree')}
            </div>
            <p className="nesio-sub-status-title">
              {days > 0
                ? L(dict, '前 21 天全功能免费', 'First 21 days, everything unlocked')
                : t(locale, 'subFreeTitle')}
            </p>
            <p className="nesio-sub-status-desc">
              {days > 0
                ? L(dict, '3 周,刚好养成一个记录的好习惯。试用结束自动回到免费版,不扣费。', 'Three weeks — just long enough to build a note-taking habit. Afterwards you return to Free; nothing is charged.')
                : t(locale, 'subFreeDesc')}
            </p>
          </div>
        );
      })()}

      {/* Pro 权益清单(会员权益介绍) */}
      <p className="nesio-settings-section-label" style={{ marginTop: '1.1rem' }}>{L(dict, 'Pro 能做什么', 'What Pro unlocks')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', lineHeight: 1.6 }}>
        {[
          L(dict, 'AI 自动识别与整理(拍照 / 分享 / 文件)', 'AI recognition & organizing (photos / shares / files)'),
          L(dict, '问一问深度回答(对话式检索)', 'Deep conversational answers in Ask'),
          L(dict, 'AI 例程与日程建议', 'AI routines and schedule suggestions'),
          L(dict, '邮件直接回复(AI 起草,你点发送)', 'Direct email replies (AI drafts, you send)'),
          L(dict, '冷冻仓(冲动购买冷静期)', 'Freeze Vault (cooling-off for impulse buys)'),
        ].map((b) => (
          <div key={b} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--status-go)', flexShrink: 0 }}>✓</span><span>{b}</span>
          </div>
        ))}
        <p style={{ fontSize: '0.75rem', color: 'var(--portal-muted)', margin: '0.35rem 0 0' }}>
          {L(dict, '记录、搜索、手动标签永久免费。', 'Capturing, search, and manual tags stay free forever.')}
        </p>
      </div>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.1rem' }}>{t(locale, 'subFuturePlans')}</p>
      {PLAN_PREVIEWS.map((plan) => (
        <div key={plan.id} className="nesio-sub-upgrade-row">
          <div className="nesio-sub-upgrade-info">
            <p className="nesio-sub-upgrade-name">{L(dict, plan.name, plan.nameEn)}</p>
            <p className="nesio-sub-upgrade-desc">{L(dict, plan.desc, plan.descEn)}</p>
          </div>
          <div className="nesio-sub-upgrade-right">
            <p className="nesio-sub-upgrade-price">{plan.price}<span>{L(dict, plan.cycle, plan.cycleEn)}</span></p>
            <span style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-pill)', padding: '0.15rem 0.55rem', whiteSpace: 'nowrap' }}>
              {t(locale, 'subPlanned')}
            </span>
          </div>
        </div>
      ))}

      {isPaidPro ? (
        <div style={{ marginTop: '1.2rem', padding: '0.9rem 1rem', borderRadius: 12, textAlign: 'center', background: 'var(--portal-card, #fff)', border: '1px solid var(--status-gentle, #6cbf84)' }}>
          <p style={{ fontWeight: 600, margin: 0, color: 'var(--status-gentle, #4a9d63)' }}>{L(dict, '✓ 你已是 Pro 会员', "✓ You're a Pro member")}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--portal-muted)', margin: '0.35rem 0 0' }}>{L(dict, '订阅生效中,感谢支持。可在支付渠道管理或取消。', 'Subscription active — thank you. Manage or cancel via your payment provider.')}</p>
        </div>
      ) : (
      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1.2rem' }} onClick={handleUpgrade} disabled={upgradeBusy || notified}>
        {notified ? `✓ ${t(locale, 'subNotifyDone')}` : upgradeBusy ? L(dict, '正在跳转…', 'Redirecting…') : L(dict, '升级 Pro', 'Upgrade to Pro')}
      </button>
      )}
      {billingHint === 'signin' && (
        <p style={{ fontSize: '0.75rem', color: 'var(--portal-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
          {L(dict, '登录后即可升级。', 'Sign in first to upgrade.')}
        </p>
      )}
      {billingError && (
        <p style={{ fontSize: '0.72rem', color: 'var(--status-risk, #d9534f)', textAlign: 'center', marginTop: '0.5rem', wordBreak: 'break-word' }}>
          {L(dict, '支付未能发起:', 'Checkout failed: ')}{billingError}
        </p>
      )}
      <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', textAlign: 'center', marginTop: '0.8rem' }}>
        {L(dict, '付费随 App 版内购开放,价格以内购页为准。', 'Purchases open with the App Store version; in-app prices apply.')}
        <br />
        <a href="/terms" style={{ color: 'inherit' }}>{L(dict, '服务条款(含自动续费说明)', 'Terms (incl. auto-renewal)')}</a>
        {' · '}
        <a href="/privacy" style={{ color: 'inherit' }}>{L(dict, '隐私政策', 'Privacy Policy')}</a>
      </p>
    </SheetWrap>
  );
}

/**
 * AccountSheet — 账户管理页(QA:此前账号信息散落)。邮箱 / 套餐 / 修改密码 /
 * 恢复购买(随 App 版开放)/ 删除账号(转隐私面板)/ 退出登录。
 */
export function AccountSheet({ open, onClose, onOpenMembership, onPickAvatar }: SheetProps & { onOpenMembership: () => void; onPickAvatar: () => void }) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [email, setEmail] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState('');
  const [savedTip, setSavedTip] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const p = loadProfileSettings();
    setName(p.displayName && p.displayName !== '我' ? p.displayName : '');
    setSavedTip(false);
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { loggedIn?: boolean; user?: { email?: string } }) => {
        setLoggedIn(Boolean(d?.loggedIn));
        setEmail(d?.user?.email || '');
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  function saveName() {
    saveProfileSettings({ displayName: name.trim() || '我' }); // PROFILE_UPDATED_EVENT → 全站头像/称呼即时更新
    void pushProfileToCloud(); // 批次200:改名即推云,让别端登录/回前台拉到(此前 displayName 从不上云 = 名字各端不同的真因)
    setSavedTip(true);
    // 2.5s 后按钮恢复可点态,让下一次改名也有明确的「已保存」反馈(否则一直显示已保存,像卡住)
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedTip(false), 2500);
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/';
  }

  const days = trialDaysLeft();
  const tierLabel = getTier() === 'pro'
    ? (days > 0 ? L(dict, `试用中 · 剩 ${days} 天`, `Trial · ${days}d left`) : 'Pro')
    : L(dict, '免费版', 'Free');
  const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0', borderBottom: '1px solid var(--portal-line)', fontSize: '0.9rem' };

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '账户', 'Account')}>
      {/* 图3:昵称 + 头像从「档案」并入账户(档案页已删) */}
      <p className="nesio-settings-section-label">{L(dict, '资料', 'Profile')}</p>
      <input
        type="text"
        className="nesio-ob-input"
        placeholder={L(dict, '念念这样称呼你', 'What Nessa calls you')}
        value={name}
        maxLength={24}
        aria-label={L(dict, '昵称', 'Nickname')}
        onChange={(e) => { setName(e.target.value); setSavedTip(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveName(); (e.target as HTMLInputElement).blur(); } }}
        onBlur={saveName}
      />
      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '0.5rem' }} onClick={saveName}>
        {savedTip ? L(dict, '✓ 已保存', '✓ Saved') : L(dict, '保存昵称', 'Save nickname')}
      </button>
      {savedTip && (
        <p className="nesio-settings-option-hint" aria-live="polite" style={{ margin: '0.35rem 0 0', color: 'var(--status-go)' }}>
          {L(dict, `念念以后叫你「${name.trim() || '我'}」`, `Nessa will call you "${name.trim() || 'you'}" from now on`)}
        </p>
      )}
      <button type="button" className="nesio-settings-option" style={{ marginTop: '0.6rem' }} onClick={onPickAvatar}>
        <span className="nesio-settings-option-label">{L(dict, '更换头像', 'Change avatar')}</span>
        <span aria-hidden style={{ color: 'var(--portal-muted)' }}>›</span>
      </button>

      {!loggedIn ? (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '账户', 'Account')}</p>
          <p style={{ fontSize: '0.88rem', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
            {L(dict, '还没登录。登录后可跨设备同步、连接邮箱/日历。', 'Not signed in. Sign in to sync across devices and connect email/calendar.')}
          </p>
          <a href="/login" className="nesio-ob-primary-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '0.8rem' }}>
            {L(dict, '去登录', 'Sign in')}
          </a>
        </>
      ) : (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '账户', 'Account')}</p>
          <div style={rowStyle}><span style={{ color: 'var(--portal-muted)' }}>{L(dict, '邮箱', 'E-mail')}</span><span>{email || '—'}</span></div>
          <button type="button" onClick={onOpenMembership} style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--portal-line)', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ color: 'var(--portal-muted)' }}>{L(dict, '套餐', 'Plan')}</span>
            <span>{tierLabel} ›</span>
          </button>

          <p className="nesio-settings-section-label" style={{ marginTop: '1.2rem' }}>{L(dict, '购买', 'Purchases')}</p>
          {/* 随 App 版 StoreKit 开放;disabled={true} 满足 no-inert-buttons 契约的显式禁用标注 */}
          <button type="button" disabled={true} style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', color: 'var(--portal-muted)', cursor: 'default', textAlign: 'left' }}>
            <span>{L(dict, '恢复购买', 'Restore purchase')}</span>
            <span style={{ fontSize: '0.72rem' }}>{L(dict, '随 App 版开放', 'Coming with the App Store version')}</span>
          </button>

          {/* 图1b:改密码移到登录/忘记密码流程,账户页不再放。删除账号入口在「数据与隐私」。 */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1.2rem' }}>{L(dict, '会话', 'Session')}</p>
          <button type="button" onClick={signOut} style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', borderBottom: 'none', color: 'var(--status-risk)', cursor: 'pointer', textAlign: 'left' }}>
            <span>{L(dict, '退出登录', 'Sign out')}</span>
          </button>
        </>
      )}
    </SheetWrap>
  );
}
