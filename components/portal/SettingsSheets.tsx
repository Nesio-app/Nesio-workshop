'use client';

/**
 * Settings sub-sheets: 语气与边界 / 隐私与数据 / 生活空间 / 订阅
 * Each is a slide-up bottom sheet opened from NesioProfileCard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { pushSupported, isPushEnabled, enablePush, disablePush } from '@/lib/portal/push-notify';
import { isNativePlatform } from '@/lib/portal/platform-capabilities';
import {
  isLocalNotifyEnabled, setLocalNotifyEnabled, hasLocalNotifyChoice, loadNotifyPrefs, saveNotifyPrefs, type NotifyPrefs,
} from '@/lib/portal/notify-prefs';
import { PORTAL_LOCALE_OPTIONS, loadProfileSettings, portalLocaleToDictionaryLocale, saveProfileSettings, touchProfileIdentity, type PortalLocale } from '@/lib/portal/profile';
import { describeUnifiedSync, runUnifiedSync } from '@/lib/portal/unified-sync';
import { pushProfileToCloud, syncProfileWithCloud } from '@/lib/portal/cloud-profile-sync';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { L, t } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { IconChevronRight, IconHalfMoon, IconLink, IconLock, IconMoon, IconShield, IconSun } from './icons';
import { InfoTip } from './InfoTip';
import { useSessionState } from './use-session-state';
import NesioSheet from './ui/NesioSheet';
import { captureLocationEnabled, setCaptureLocationEnabled } from '@/lib/portal/capture-location';
import { getFontScale, applyFontScale, type FontScale } from '@/lib/portal/font-scale';
import { PROACTIVE_LEVEL_KEY } from './today/proactive-types';
import { deleteLifeNode, getLifeGraph } from '@/lib/portal/life-graph';
import { visibleMemoryNodes } from '@/lib/portal/memory-visibility';
import { auditGraphConsistency, consistencyVerdict, repairMissingInCloud, type GraphConsistencyReport } from '@/lib/portal/graph-consistency';
import { purgeLocalData } from '@/lib/portal/storage-manifest';
import { purgeIdbBlobs } from '@/lib/portal/idb-blob-store';
import { purgeLocalImages } from '@/lib/portal/local-image-store';
import { purgeLocalFiles } from '@/lib/portal/local-file-store';
import { purgeLocalTracks } from '@/lib/platform/music/local-tracks';
import { stop as stopMusic } from '@/lib/platform/music/player-engine';
import { getTelemetryDeviceId } from '@/lib/portal/telemetry';
import { FEATURE_CATALOG, loadModuleOverrides, setModuleOverride, MODULE_OVERRIDES_EVENT, defaultResolvesTo, followsLab, isLabModeOn, getPalette, setPalette, PALETTES, type PaletteId } from '@/lib/portal/module-overrides';
import { isAppStoreBuild } from '@/lib/portal/app-build.mjs';
import { canUse, getTier, hasProOverride, hasPaidPro, refreshServerEntitlement, setProEntitlement, trialDaysLeft, TIER_UPDATED_EVENT } from '@/lib/portal/entitlement';
import { isValidBackup } from '@/lib/portal/full-backup';
import { pushBackupToCloud, pullBackupFromCloud, restoreCombinedBackup, buildCombinedBackup, hasCloudEntitlement, lastCloudBackup, type CloudBackupError, type CloudRestoreError } from '@/lib/portal/cloud-backup';
import { inventoryBackup, inventorySummary, inventoryWarning } from '@/lib/portal/backup-inventory';
import { localDayKey } from '@/lib/portal/local-day';
import Button from './ui/Button';

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

// ── 档案(批次 138·设计「档案与账户分开」):昵称 + 头像,从账户拆出 ──
// 图3:ProfileSheet(档案页)已删除 —— 昵称与更换头像并入 AccountSheet(账户)。

// ── 外观与语言(批次 138:从通用拆出;明暗 + 字号 + 语言。2026-07-29:配色色卡从 Lab 搬进来)──
export function AppearanceSheet({ open, onClose }: SheetProps) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const [themeSaveIssue, setThemeSaveIssue] = useState('');
  const [fontScale, setFontScale] = useState<FontScale>('md');
  const [palette, setPaletteState] = useState<PaletteId>('');

  useEffect(() => {
    if (!open) return;
    try {
      const th = localStorage.getItem(THEME_KEY);
      setTheme(th === 'day' || th === 'night' ? th : 'auto');
      setFontScale(getFontScale());
      setPaletteState(getPalette());
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
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {themeOpts.map((opt) => (
          <button key={opt.id} type="button"
            className={`nesio-settings-option${theme === opt.id ? ' nesio-settings-option--active' : ''}`}
            style={{ flex: 1, justifyContent: 'center', gap: 'var(--space-1)' }}
            onClick={() => pickTheme(opt.id)}>
            {opt.icon}
            <span className="nesio-settings-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
      {themeSaveIssue && (
        <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--status-risk, #c0564f)' }}>{themeSaveIssue}</p>
      )}

      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>
        {L(dict, '配色', 'Palette')}
        <InfoTip text={L(dict, '点一张即时全站换装,再点「默认蓝」还原。', 'Tap a card to reskin instantly; tap Default blue to restore.')} />
      </p>
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

      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '字体大小', 'Text size')}<InfoTip text={L(dict, '整体放大界面文字与间距;标准 = 跟随系统设置。', 'Scales the whole UI text & spacing; Standard = follow system.')} /></p>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {([['sm', L(dict, '小', 'S'), '0.8rem'], ['md', L(dict, '标准', 'M'), '0.95rem'], ['lg', L(dict, '大', 'L'), '1.1rem'], ['xl', L(dict, '特大', 'XL'), '1.28rem']] as Array<[FontScale, string, string]>).map(([id, label, demo]) => (
          <button key={id} type="button"
            className={`nesio-settings-option${fontScale === id ? ' nesio-settings-option--active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => { setFontScale(id); applyFontScale(id); }}>
            <span className="nesio-settings-option-label" style={{ fontSize: demo, lineHeight: 1 }}>{label}</span>
          </button>
        ))}
      </div>

      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>{t(locale, 'sectionLanguage')}<InfoTip text={t(locale, 'langSoonHint')} /></p>
      <select
        value={locale}
        onChange={(e) => pickLang(e.target.value as PortalLocale)}
        aria-label={t(locale, 'sectionLanguage')}
        style={{ width: '100%', minHeight: 'var(--tap-min)', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--portal-line)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)', outline: 'none', fontFamily: 'inherit' }}
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
  const [exportWarn, setExportWarn] = useState<string | null>(null); // 导出装箱单里主数据为空时的提醒
  const [exportBusy, setExportBusy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  // 云备份(付费,规划中):状态机 idle→pushing→done/error,失败必可见(设计红线)。
  const [cloudState, setCloudState] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle');
  // 同步体检(地基 F2):回答「我的记忆全在吗」。只读 + 显式触发 —— 拉全量云快照,
  // 不该在启动路径上跑。修复(补传)是另一颗按钮,永远由用户点。
  const [auditState, setAuditState] = useState<'idle' | 'running' | 'done' | 'repairing' | 'failed'>('idle');
  const [auditReport, setAuditReport] = useState<GraphConsistencyReport | null>(null);
  const [auditFail, setAuditFail] = useState<string>('');
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
  // #21:这里原来自己 fetch 一遍 /api/auth/session,初值写死 false —— 一路请求慢一点,
  // 屏幕上就同时出现「已登录」和「未登录」。登录态只有一个答案,走 useSessionState。
  // (顺带:signedIn 此前算出来根本没人用,是「写了没接上」。)
  const session = useSessionState(open);
  const signedIn = session.state === 'signed-in';
  useEffect(() => {
    try { const v = localStorage.getItem('nesio-backup-dest'); if (v === 'nesio' || v === 'drive') setBackupDest(v); } catch { /* ignore */ }
  }, []);
  const [diagSyncMsg, setDiagSyncMsg] = useState('');
  /**
   * #23(2026-07-30):用户报「换肤只在设置页生效,首页还是粉的」。查下来四套色卡对
   * `--portal-*` / `--status-*` 那整组 token **一个不漏都覆盖了**,找不到能解释那一屏的机制;
   * 最可能的解释是那台设备还在跑**旧构建**(iOS PWA 后台驻留的页面从不重新加载)。
   *
   * 可这件事**用户没法自己确认** —— 界面上没有任何地方写着「你现在跑的是哪一版」。
   * 版本比对逻辑早就有(Portal 里回前台自动刷),但它是静默的:
   * 一个静默的自愈机制在「它到底有没有生效」这种问题上等于不存在。
   * 所以这里补一行看得见的:这台设备的构建 vs 线上部署,不一样就给一颗强制刷新。
   */
  const localBuild = (process.env.NEXT_PUBLIC_BUILD_SHA || 'dev').slice(0, 7);
  const [liveBuild, setLiveBuild] = useState('');
  useEffect(() => {
    if (!open) return;
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { v?: string }) => setLiveBuild(String(d?.v || '').slice(0, 7)))
      .catch(() => setLiveBuild(''));
  }, [open]);
  const buildStale = Boolean(liveBuild && liveBuild !== 'dev' && localBuild !== 'dev' && liveBuild !== localBuild);
  /**
   * 2026-07-29 QA #11:用户点了一次同步,总数从 2541 变成 2544,报的是「✓ 已同步」——
   * 于是那 3 条看着像**凭空多出来**的。其实它们是别的设备存下、这台机器还没有的记忆,
   * 同步把它们取回来了,完全正确;错的是**没说**。同一个数字,说清来路就是功能,
   * 不说就是 bug。importedNodeCount 本来就一直算着,只是从来没露过面。
   */
  async function handleForceSync() {
    setDiagSyncMsg(L(dict, '同步中…', 'Syncing…'));
    try {
      // 与记忆页下拉同一条:记忆 + 资料 + 模块 durable + 外部连接器。不清空本机。
      const r = await runUnifiedSync({ force: true });
      setDiagSyncMsg(describeUnifiedSync(r, dict !== 'en'));
    } catch { setDiagSyncMsg(L(dict, '同步没能完成,过一会儿再试', 'Sync didn’t go through — try again in a bit')); }
  }
  const pickBackupDest = (d: 'drive' | 'nesio') => {
    setBackupDest(d);
    try { localStorage.setItem('nesio-backup-dest', d); } catch { /* ignore */ }
    if (d === 'drive') {
      setDriveMsg(L(dict,
        '已选 Google 云。点「备份」即可;若尚未连接 Google,会引导你去「连接数据源」开通 Drive。',
        'Google cloud selected. Tap Back up; if Google isn’t connected yet, you’ll be guided to enable Drive under Connected sources.'));
      setDriveState('idle');
    }
  };

  /**
   * 这四个开关(日报/触感/推送/自动定位)本来在 GeneralSheet(即 ToneSheet)里,
   * 批次138 把「通用」拆成「外观与语言」时,主题/字号/语言迁去了 AppearanceSheet,
   * 但这四个开关没跟着迁走——GeneralSheet 从此没有任何入口能打开(NesioProfileCard
   * 只挂了 AccountSheet/AppearanceSheet/PrivacySheet/SubscriptionSheet/LabSheet),
   * 这四个开关等于人间蒸发:用户没法关也没法开(真机反馈:「日报没有开关」,查下来
   * 就是这个——不是 UI 忘了画,是压根没地方点)。搬进这里(数据与隐私,离「连接
   * 数据源」「记忆自动定位」本来就近),GeneralSheet 整个删掉(见下方注释)。
   */
  const [dailyReportOn, setDailyReportOn] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [captureLocOn, setCaptureLocOn] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>({
    reminders: true, timeline: true, focusDue: true, dailyReport: true, retrospect: true,
    teslaLowBatt: true, familyChores: true,
  });
  const nativeNotify = isNativePlatform();
  const iosWeb = !nativeNotify && typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  useEffect(() => {
    if (!open) return;
    setDailyReportOn(loadProfileSettings().dailyReportEnabled);
    try {
      setHapticsOn(localStorage.getItem(HAPTIC_FEEDBACK_KEY) !== '0');
      setCaptureLocOn(captureLocationEnabled());
    } catch { /* ignore */ }
    setPushOn(nativeNotify ? isLocalNotifyEnabled() : isPushEnabled());
    setNotifyPrefs(loadNotifyPrefs());
    if (!nativeNotify) return;
    let stop = false;
    void import('@/lib/portal/native-local-notifications').then(async (m) => {
      const d = await m.checkLocalNotifyDisplay();
      if (stop) return;
      if (d === 'granted' && !hasLocalNotifyChoice()) {
        setLocalNotifyEnabled(true);
        setPushOn(true);
        setPushMsg(L(dict, '系统已允许通知 — 提醒/日程/焦点/日报/回顾/家务/车会到点响', 'Notifications already allowed — reminders, schedule, focus, report, retrospect, chores, and the car will ring when due'));
      } else if (d === 'missing') {
        setPushMsg(L(dict, '这版壳没带上通知插件 — 请用 Sideloadly 重装新 IPA', 'This app shell is missing the notification plugin — reinstall a new IPA with Sideloadly'));
      }
    }).catch(() => {});
    return () => { stop = true; };
  }, [open, nativeNotify, dict]);
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
  async function togglePush() {
    if (pushOn) {
      if (nativeNotify) setLocalNotifyEnabled(false);
      else await disablePush();
      setPushOn(false); setPushMsg('');
      return;
    }
    setPushMsg(L(dict, '正在开启…', 'Enabling…'));
    if (nativeNotify) {
      const { applyAllLocalNotifications } = await import('@/lib/portal/notify-apply');
      const r = await applyAllLocalNotifications({ askPermission: true, zh: dict !== 'en' });
      if (!r.ok && r.reason === 'denied') {
        setPushMsg(L(dict, '系统没给通知权限 — 可在设置 → 宝盒里打开通知后再试', 'Notifications not allowed — enable them in Settings → 宝盒 and retry'));
        return;
      }
      if (!r.ok && r.reason === 'plugin_missing') {
        setPushMsg(L(dict, '这版壳没带上通知插件 — 请用 Sideloadly 重装新 IPA', 'This app shell is missing the notification plugin — reinstall a new IPA with Sideloadly'));
        return;
      }
      setPushOn(true);
      setPushMsg(L(dict, `系统通知已开 · 已排 ${r.scheduled} 条。两秒后会试响一条。`, `Local alerts on · ${r.scheduled} scheduled. A test alert will ring in two seconds.`));
      void import('@/lib/portal/native-local-notifications').then((m) => m.scheduleLocalAlert({
        title: L(dict, '通知已接通', 'Notifications on'),
        body: L(dict, '到点的家务、提醒和车低电量会在这里响。', 'Due chores, reminders, and low Tesla battery will ring here.'),
        afterSec: 2,
        id: 710_002,
      }));
      return;
    }
    const r = await enablePush();
    if (r.ok) { setPushOn(true); setPushMsg(''); }
    else {
      setPushMsg(r.reason === 'denied'
        ? L(dict, '浏览器没给通知权限,可在系统设置里打开后重试', 'Notification permission denied — enable it in system settings and retry')
        : L(dict, '没开成,稍后再试', 'Could not enable — try again later'));
    }
  }

  function driveErrorText(err: string | undefined): string {
    switch (err) {
      case 'not_connected':
        return L(dict,
          '还没开通 Google Drive 备份 —— 先点「连接数据源」连上 Google(含 Drive),再回来备份。',
          'Google Drive backup isn’t enabled yet — connect Google under Connected sources (includes Drive), then back up again.');
      case 'insufficient_scope':
        return L(dict,
          '当前 Google 授权还缺 Drive 权限 —— 请重新连接 Google(会多要一次 Drive),再点备份。',
          'This Google sign-in is missing Drive access — reconnect Google (it will ask for Drive), then back up again.');
      case 'too_large':
        return L(dict,
          '这份数据太大,过不了上传上限。请先用下面「导出」留本机份;Drive 备份不含照片。',
          'This package is too large to upload. Export a local copy below; Drive backup skips photos.');
      case 'timeout':
        return L(dict, '这次备份超时了 —— 网络慢时常见,稍后再试一次。', 'Backup timed out — common on a slow network. Try again shortly.');
      case 'build_failed':
        return L(dict, '这次没能把数据打包好 —— 不是网络问题。先用「导出」留一份。', "Couldn't package your data — not a network issue. Export a local copy first.");
      case 'no_backup':
        return L(dict, '你的 Drive 里还没有备份 —— 先点上面「免费备份到 Google Drive」', 'No backup in your Drive yet — tap "Back up free to Google Drive" above first');
      default:
        return L(dict, '备份到 Drive 没成功 —— 稍后再试或用「导出」', "Drive backup didn't go through — try again later or use Export");
    }
  }

  async function handleDriveBackup() {
    setDriveState('busy'); setDriveMsg(L(dict, '正在打包并上传到 Drive…', 'Packaging and uploading to Drive…'));
    try {
      await runDriveBackup();
    } catch {
      // 动态 import / 打包过程抛错时也要有结局,不让按钮停在「正在备份…」
      setDriveState('error');
      setDriveMsg(L(dict, '这次没备份成功,稍后再试一次。', "Backup didn't complete — try again shortly."));
    }
  }

  async function runDriveBackup() {
    const { pushBackupToDrive } = await import('@/lib/portal/drive-backup');
    const r = await pushBackupToDrive();
    if (r.ok) {
      setDriveState('done');
      setDriveMsg(L(dict, '✓ 已免费备份到你的 Google Drive(不含照片;照片请用导出)', '✓ Backed up free to your Google Drive (no photos — use Export for those)'));
      return;
    }
    setDriveState('error');
    setDriveMsg(driveErrorText(r.error));
    // 没连 / 缺 scope → 打开数据源引导重连(不要静默改用 Nesio 云)
    if (r.error === 'not_connected' || r.error === 'insufficient_scope') {
      try { onOpenConnect?.(); } catch { /* ignore */ }
    }
  }
  // 备份/恢复走用户选的目的地(Drive 未连接引导开通,不静默兜底 Nesio)
  const handleBackupChosen = () => (backupDest === 'drive' ? handleDriveBackup() : handleCloudBackup());
  const handleRestoreChosen = () => (backupDest === 'drive' ? handleDriveRestore() : handleCloudRestore());

  async function runSyncAudit() {
    setAuditState('running'); setAuditFail(''); setAuditReport(null);
    const res = await auditGraphConsistency();
    if (!res.ok) {
      // 红线:异步动作必须有可见失败态。三种原因分开说 —— 「没登录」不是「坏了」。
      setAuditFail(res.reason === 'not_signed_in'
        ? L(dict, '还没登录,云端这一侧还没有东西可比。', 'Not signed in yet — there is no cloud side to compare.')
        : L(dict, '这次没连上云,待会儿再试一次。', "Couldn't reach the cloud — try again in a bit."));
      setAuditState('failed');
      return;
    }
    setAuditReport(res.report); setAuditState('done');
  }

  async function repairSyncGap() {
    if (!auditReport?.missingInCloud.length) return;
    setAuditState('repairing');
    try {
      await repairMissingInCloud(auditReport.missingInCloud);
      await runSyncAudit(); // 补完立刻重测,数字要自己说话,不靠「应该好了」
    } catch {
      setAuditFail(L(dict, '补传没成功,待会儿再试一次。', "Couldn't finish uploading — try again in a bit."));
      setAuditState('failed');
    }
  }
  async function handleDriveRestore() {
    if (!confirm(L(dict, '从 Google Drive 恢复:把云端备份合并回本机(仅补缺,不覆盖已有)。完成后自动刷新。继续?', 'Restore from Google Drive: merges the backup into this device (fills gaps, keeps existing). Refreshes when done. Continue?'))) return;
    setDriveState('busy'); setDriveMsg(L(dict, '正在从 Drive 拉取…', 'Pulling from Drive…'));
    try {
      const { pullBackupFromDrive } = await import('@/lib/portal/drive-backup');
      const r = await pullBackupFromDrive('merge');
      if (r.ok) {
        setDriveState('done');
        setDriveMsg(L(dict, '✓ 已从 Drive 恢复,正在刷新…', '✓ Restored from Drive, refreshing…'));
        setTimeout(() => window.location.reload(), 900);
        return;
      }
      setDriveState('error');
      setDriveMsg(r.error === 'not_connected' || r.error === 'insufficient_scope'
        ? driveErrorText(r.error)
        : r.error === 'no_backup'
          ? driveErrorText('no_backup')
          : L(dict, '从 Drive 恢复没成功 —— 稍后再试', "Restore from Drive didn't go through — try again later"));
      if (r.error === 'not_connected' || r.error === 'insufficient_scope') {
        try { onOpenConnect?.(); } catch { /* ignore */ }
      }
    } catch {
      setDriveState('error');
      setDriveMsg(L(dict, '从 Drive 恢复没成功 —— 稍后再试', "Restore from Drive didn't go through — try again later"));
    }
  }

  /** 只清空 Nesio 云(表+对象存储),保留登录与本机;配合「只用 Google Drive」。 */
  async function clearNesioCloudKeepAccount() {
    if (!confirm(L(dict,
      '清空 Nesio 云:删除云端记忆/资料/备份文件,本机与 Google Drive 不动,也不登出。清空后请用 Google 云备份。继续?',
      'Clear Nesio cloud: deletes cloud memories/profile/backups. Local data and Google Drive stay; you stay signed in. Then use Google cloud for backup. Continue?'))) return;
    setDeleteMsg(L(dict, '正在清空 Nesio 云…', 'Clearing Nesio cloud…'));
    try {
      const res = await fetch('/api/user-data/delete?dryRun=0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'CLEAR_NESIO_CLOUD_KEEP_ACCOUNT' }),
      });
      if (res.status === 401) {
        setDeleteMsg(L(dict, '还没登录,没有 Nesio 云可清。', 'Not signed in — nothing on Nesio cloud to clear.'));
        return;
      }
      const data = await res.json().catch(() => null) as { ok?: boolean } | null;
      if (!res.ok || !data?.ok) {
        setDeleteMsg(L(dict, 'Nesio 云没清空成功,本机未改动。稍后再试。', "Couldn't clear Nesio cloud — nothing changed locally. Try again later."));
        return;
      }
      pickBackupDest('drive');
      setDeleteMsg(L(dict,
        '✓ Nesio 云已清空,已切到 Google 云备份。注意:点「同步」仍会把本机记忆写回 Nesio(那是实时同步,不是整包备份)。',
        '✓ Nesio cloud cleared; backup dest set to Google. Note: Sync can still write memories back to Nesio (live sync, not the package backup).'));
    } catch {
      setDeleteMsg(L(dict, '网络错误,Nesio 云未清空。', 'Network error — Nesio cloud not cleared.'));
    }
  }

  function cloudErrorText(err: CloudBackupError): string {
    switch (err) {
      case 'entitlement_required': return L(dict, '云备份即将开放 —— 到下方「订阅」留个位,开放时第一时间通知你。', "Cloud backup is coming soon — join the waitlist under Subscription and we'll ping you first.");
      case 'not_signed_in': return L(dict, '先登录(上方入口),才能同步到你的云账户。', 'Sign in first (link above) to sync to your cloud account.');
      case 'cloud_not_configured': return L(dict, '云同步暂未开启,稍后再试。', "Cloud sync isn't enabled yet — try again later.");
      case 'too_large': return L(dict, '数据超过 8MB 单次上限,先导出到本地留一份。', 'Data is over the 8MB limit — export a local copy for now.');
      // 构建失败是本机的事,别让用户去查 WiFi(此前一律报「检查网络」,方向就指错了)
      case 'build_failed': return L(dict, '这次没能把数据打包好 —— 不是网络问题。先用下面的「导出全部」留一份到本机,再把这条告诉我们。', "Couldn't package your data — this isn't a network issue. Use “Export everything” below to keep a local copy, then let us know.");
      case 'upload_failed': return L(dict, '服务器没收下这份备份,过一会儿再试一次。', 'The server rejected this backup — please try again shortly.');
      default: return L(dict, '这次没传上去(可能是网络慢或超时)。稍后再试一次。', "Didn't go through (slow network or timeout). Try again in a bit.");
    }
  }

  async function handleCloudBackup() {
    setCloudState('pushing');
    setCloudError(null);
    // 兜底 try/catch:此前没有 —— pushBackupToCloud 内部若**抛错**(而不是返回错误结果,
    // 例如 gzip / Blob 在超大 payload 上抛),这里的 await 直接 reject,
    // 状态就永远停在 pushing,按钮卡死在「正在备份…」(手机实测)。
    // 红线:每个异步动作都必须有可见结局,挂着不算结局。
    try {
      const result = await pushBackupToCloud();
      if (result.ok) {
        setCloudState('done');
        setCloudBackupAt(result.at || new Date().toISOString());
      } else {
        setCloudState('error');
        setCloudError(result.error || 'network');
      }
    } catch {
      setCloudState('error');
      setCloudError('build_failed');
    }
  }

  function cloudRestoreErrorText(err: CloudRestoreError): string {
    if (err === 'no_backup') return L(dict, '还没有云备份可恢复,先点上面「备份到云」。', 'No cloud backup yet — tap "Back up to cloud" above first.');
    if (err === 'invalid_backup') return L(dict, '云端备份读出来不是有效文件,本机没有改动。', "The cloud backup didn't read as a valid file — nothing changed locally.");
    return cloudErrorText(err as CloudBackupError);
  }

  async function handleCloudRestore() {
    if (!confirm(L(dict, '用备份补缺:把云端整包备份合并进本机(只补缺,不清空、不覆盖已有)。完成后自动刷新。继续?', 'Fill gaps from backup: merges the cloud package into this device (fills gaps only — does not wipe or overwrite). Refreshes when done. Continue?'))) return;
    setCloudRestoreState('pulling');
    setCloudRestoreError(null);
    // 同「备份」:内部抛错时也要有结局,否则按钮永远停在「正在恢复…」
    try {
      const result = await pullBackupFromCloud('merge');
      if (result.ok) {
        setCloudRestoreState('idle');
        setTimeout(() => window.location.reload(), 700); // reload 让各 store 重新水合
      } else {
        setCloudRestoreState('error');
        setCloudRestoreError(result.error || 'network');
      }
    } catch {
      setCloudRestoreState('error');
      setCloudRestoreError('network');
    }
  }

  // 数据审计 #8:兑现「随时导出你的全部数据」—— 直接下载一份完整备份 JSON 到本机
  // (localStorage + IDB blob + 照片),与「导入备份」对称、无需上云。每个异步动作都有可见失败态。
  async function handleExportLocal() {
    if (exportBusy) return;
    setExportBusy(true);
    setRestoreMsg('');
    setExportWarn(null);
    try {
      const backup = await buildCombinedBackup({ includeImages: true });
      const payload = JSON.stringify(backup);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nesio-backup-${localDayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      // 装箱单回执:「随时导出你的全部数据」是承诺,**无法验证的承诺等于没有承诺**。
      // 导完就地报清各主数据条数;主数据空了显式提醒(多半是这台设备没同步完)。
      const inv = inventoryBackup(backup.entries, blob.size);
      setRestoreMsg(inventorySummary(inv, dict));
      setExportWarn(inventoryWarning(inv, dict));
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
    // 口径必须和记忆库首页一致。原来这里读的是 getLifeGraph().length(原始全量),
    // 而记忆页报的是 visibleMemoryNodes(滤掉天气快照那类环境信号)——
    // 同一时刻两处一个 2541 一个 2534,用户当场就发现了(QA #10)。
    const readCount = () => setNodeCount(visibleMemoryNodes(getLifeGraph(), true).length);
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
      void purgeLocalFiles();                               // 同上:附件在 nesio-files,漏了就把 pdf 留在设备上
      stopMusic();                                          // 先停播:歌还在响、文件已删掉是最刺眼的一种「没删干净」
      void purgeLocalTracks();                              // 本地曲库在 nesio-music,同一条:漏了歌还留在设备上
      void import('@/lib/portal/local-email-body').then(({ purgeEmailBodies }) => purgeEmailBodies()); // 邮件全文独立 IDB(nesio-email-bodies)一并清
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
      purgeLocalData(localStorage); void purgeIdbBlobs(); void purgeLocalImages(); void purgeLocalFiles(); stopMusic(); void purgeLocalTracks();
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch { /* ignore */ }
    setDeleteMsg(L(dict, '✓ 账号与全部数据已删除,正在登出…', '✓ Account and all data deleted, signing out…'));
    setTimeout(() => { try { window.location.href = '/'; } catch { /* ignore */ } }, 1200);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '数据与隐私', 'Data & privacy')}>

      {/* 从 GeneralSheet 搬来的四个开关(见上方 pickBackupDest 后的长注释)。 */}
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
      {!nativeNotify && (
        <div className="nesio-settings-option" style={{ cursor: 'default' }}>
          <div>
            <span className="nesio-settings-option-label">{L(dict, '系统通知', 'System notifications')}</span>
            <span className="nesio-settings-option-hint">
              {L(dict, '系统通知只在「宝盒」App 里响。现在是浏览器 —— iPhone 设置里打开的是 Safari/Chrome 的通知,不是宝盒。请用 Sideloadly 安装带通知插件的 IPA,打开宝盒后再点「试一条」。', 'System alerts only ring in the 宝盒 app. This is the browser — iOS Settings for Safari/Chrome is not 宝盒. Install the Sideloadly IPA that includes the notification plugin, then tap “Send a test alert” inside the app.')}
            </span>
          </div>
        </div>
      )}
      {(nativeNotify || (pushSupported() && !iosWeb)) && (
        <>
        <button type="button"
          className={`nesio-settings-option${pushOn ? ' nesio-settings-option--active' : ''}`}
          onClick={() => { void togglePush(); }}>
          <div>
            <span className="nesio-settings-option-label">{L(dict, nativeNotify ? '系统通知' : '重要提醒推送', nativeNotify ? 'System notifications' : 'Critical reminders push')}</span>
            <span className="nesio-settings-option-hint">
              {pushMsg || (nativeNotify
                ? L(dict, '家务、账单、车低电量到点会响 —— 先开这一项,再勾下面要提醒的', 'Chores, bills, and low Tesla battery can ring — turn this on, then pick what to notify')
                : L(dict, '只推真正要紧的(登机/就诊/还款截止),一天最多几条', 'Only truly urgent ones (boarding, appointments, due bills)'))}
            </span>
          </div>
          <span className={`nesio-settings-space-check${pushOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
            {pushOn ? '✓' : '○'}
          </span>
        </button>
        {nativeNotify && pushOn && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
            {([
              ['reminders', L(dict, '我设的提醒(家务/账单/约会)', 'My reminders (chores / bills / events)')],
              ['timeline', L(dict, '时间线日程与会议', 'Timeline events & meetings')],
              ['focusDue', L(dict, '今天焦点 / 到期 / 弹出卡', 'Today focus / due / reminder cards')],
              ['dailyReport', L(dict, '日报就绪', 'Daily report ready')],
              ['retrospect', L(dict, '周 / 月回顾', 'Weekly / monthly retrospect')],
              ['familyChores', L(dict, '家庭家务今天待办', "Family chores due today")],
              ['teslaLowBatt', L(dict, 'Tesla 电量低于 40%', 'Tesla battery under 40%')],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`nesio-settings-option${notifyPrefs[key] ? ' nesio-settings-option--active' : ''}`}
                onClick={() => {
                  const next = saveNotifyPrefs({ [key]: !notifyPrefs[key] });
                  setNotifyPrefs(next);
                  void import('@/lib/portal/notify-apply').then((m) => m.applyAllLocalNotifications({ zh: dict !== 'en' }));
                }}
              >
                <span className="nesio-settings-option-label">{label}</span>
                <span className={`nesio-settings-space-check${notifyPrefs[key] ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
                  {notifyPrefs[key] ? '✓' : '○'}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="nesio-settings-option"
              onClick={() => {
                // 结果写在按钮下面,不改上面「系统通知」的 hint ——
                // 改 hint 会撑高整块,sheet 重排,iOS 上看着像闪屏。
                setTestMsg(L(dict, '正在试一条…', 'Sending a test…'));
                void import('@/lib/portal/native-local-notifications').then(async (m) => {
                  const r = await m.scheduleLocalAlert({
                    title: L(dict, '试一下通知', 'Test notification'),
                    body: L(dict, '能看到这一条,系统通知就接通了。', 'If you see this, system notifications are working.'),
                    afterSec: 5,
                    id: 710_003,
                    assumeGranted: true,
                  });
                  setTestMsg(r.ok
                    ? L(dict, '已排程。请立刻按 Home 切到桌面等几秒 —— 停在 App 里旧壳会吞掉横幅。若桌面也不响,需重装带前台通知修复的 IPA。', 'Scheduled. Press Home now and wait a few seconds — older shells swallow banners while the app is open. If nothing appears on the Home Screen, reinstall an IPA with the foreground-notification fix.')
                    : r.reason === 'denied'
                      ? L(dict, '系统没给通知权限 — 到设置 → 宝盒里打开通知。', 'Notifications not allowed — enable them in Settings → 宝盒.')
                      : L(dict, '这版壳排不上通知 — 请用 Sideloadly 重装新 IPA。', 'This shell cannot schedule alerts — reinstall a new IPA with Sideloadly.'));
                });
              }}
            >
              <span className="nesio-settings-option-label">{L(dict, '试一条通知', 'Send a test alert')}</span>
            </button>
            {testMsg ? <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{testMsg}</p> : null}
          </div>
        )}
        </>
      )}
      <button type="button"
        className={`nesio-settings-option${captureLocOn ? ' nesio-settings-option--active' : ''}`}
        onClick={() => {
          const next = !captureLocOn;
          setCaptureLocOn(next);
          setCaptureLocationEnabled(next);
        }}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '记忆自动定位', 'Auto-locate memories')}</span>
          <span className="nesio-settings-option-hint">{L(dict, '亲手记的带上位置 · 随记忆上云', 'Your own notes get a location · syncs with memories')}</span>
        </div>
        <span className={`nesio-settings-space-check${captureLocOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {captureLocOn ? '✓' : '○'}
        </span>
      </button>

      {/* bug2:「你的数据在哪里」整块删除(数据主权面板 + 同步诊断) */}

      {/* 图5:数据接入从「记录习惯」并入这里 —— 连接数据源(ConnectorsHub);bug2:说明文字删除。
          bug3 p44:「数据接入」这个小标题也删了 —— 下面那行按钮自己就叫「连接数据源」。 */}
      <button type="button" className="nesio-settings-option" onClick={onOpenConnect}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '连接数据源', 'Connected sources')}</span>
        </div>
        <span aria-hidden style={{ color: 'var(--portal-muted)' }}>›</span>
      </button>

      {/* 备份与恢复(bug2:「备份到哪里」标题删除;第一个按钮改名「Google 云」;说明文字删除) */}
      <div style={{ display: 'flex', gap: 8, margin: '1.2rem 0 6px' }}>
        {([['drive', L(dict, 'Google 云', 'Google cloud')], ['nesio', L(dict, `Nesio 云${cloudEntitled ? '' : ' · Pro 免费'}`, `Nesio cloud${cloudEntitled ? '' : ' · free with Pro'}`)]] as const).map(([d, label]) => (
          <button key={d} type="button" onClick={() => pickBackupDest(d)}
            style={{ flex: 1, padding: 'var(--space-2) var(--space-2)', borderRadius: 10, fontSize: 'var(--text-sm)', cursor: 'pointer',
              border: `1px solid ${backupDest === d ? 'var(--portal-accent-border)' : 'var(--portal-line)'}`,
              background: backupDest === d ? 'var(--portal-accent-soft-md)' : 'transparent',
              color: backupDest === d ? 'var(--portal-ink)' : 'var(--portal-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* bug3 p44:「备份 / 从云恢复」放一排,「导出 / 导入」放一排(见下)。
          2026-07-29 曾按「主动作整行 + 反向动作文字链」拆成两行 —— 标注要的是成对并排,
          一眼看出这是一对互逆操作;两个都是整行按钮就没有这个信息了,所以改成 2 列。 */}
      <div className="nesio-settings-btn-row">
        <Button variant="soft" size="md" full className="nesio-settings-action-btn" onClick={handleBackupChosen} disabled={cloudState === 'pushing' || driveState === 'busy'}>
          {(cloudState === 'pushing' || driveState === 'busy') ? L(dict, '正在备份…', 'Backing up…') : L(dict, '备份', 'Back up')}
        </Button>
        <Button variant="soft" size="md" full className="nesio-settings-action-btn" onClick={handleRestoreChosen} disabled={cloudRestoreState === 'pulling' || driveState === 'busy'}>
          {(cloudRestoreState === 'pulling') ? L(dict, '正在补缺…', 'Filling gaps…') : L(dict, '用备份补缺', 'Fill from backup')}
        </Button>
      </div>
      {/* 状态:仅当前所用目的地会填充 */}
      {cloudState === 'done' && (
        <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: 'var(--status-go)' }}>
          {L(dict, '✓ 已备份到 Nesio 云', '✓ Backed up to Nesio cloud')}{cloudBackupAt ? ` · ${new Date(cloudBackupAt).toLocaleString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
      )}
      {cloudState === 'error' && cloudError && (
        <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: cloudError === 'entitlement_required' ? 'var(--portal-muted)' : 'var(--status-risk)' }}>
          {cloudErrorText(cloudError)}
        </p>
      )}
      {cloudRestoreState === 'error' && cloudRestoreError && (
        <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: cloudRestoreError === 'entitlement_required' || cloudRestoreError === 'no_backup' ? 'var(--portal-muted)' : 'var(--status-risk)' }}>
          {cloudRestoreErrorText(cloudRestoreError)}
        </p>
      )}
      {driveMsg && <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: driveState === 'error' ? 'var(--status-risk)' : 'var(--status-go)' }}>{driveMsg}</p>}

      {/* 同步体检(地基 F2)。此前这里只报「N 条记忆,全在本机」—— 那是**本地**条数,
          回答不了「云端也有吗」。同步机制齐备但没人能验:backfill 默认只补最新 200 条,
          老节点若当初没上去就永远不会被发现。这块把它变成可回答的。 */}
      {/* 用独立的 audit-row,不复用 nesio-settings-btn-row —— 那个类钉的是 bug3 p44 的
          「两排**成对**按钮」(备份/恢复、导出/导入),契约按出现次数校验。而这一行常态
          只有一颗按钮(补传仅在真有缺口时才出现),本来就不是一对。 */}
      <div className="nesio-settings-audit-row">
        <Button variant="soft" size="md" full className="nesio-settings-action-btn"
          onClick={runSyncAudit} disabled={auditState === 'running' || auditState === 'repairing'}
          title={L(dict, '比对本机与云端的记忆条目,列出差在哪', 'Compare local vs cloud memories and list the gaps')}>
          {auditState === 'running' ? L(dict, '正在核对…', 'Checking…') : L(dict, '同步体检', 'Sync check')}
        </Button>
        {auditReport && auditReport.missingInCloud.length > 0 && (
          <Button variant="soft" size="md" full className="nesio-settings-action-btn"
            onClick={repairSyncGap} disabled={auditState === 'repairing'}>
            {auditState === 'repairing'
              ? L(dict, '正在补传…', 'Uploading…')
              : L(dict, `补传 ${auditReport.missingInCloud.length} 条`, `Upload ${auditReport.missingInCloud.length}`)}
          </Button>
        )}
      </div>
      {auditState === 'failed' && auditFail && (
        <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: 'var(--portal-muted)' }}>{auditFail}</p>
      )}

      {/* 统一同步:记忆图 + 资料 + 模块(衣橱/足迹/健身/行程…) + 日历邮件等外部源。
          与记忆页下拉同一实现;「用备份补缺」是另一条整包管道,不清空本机。 */}
      <div className="nesio-settings-audit-row">
        <Button variant="soft" size="md" full className="nesio-settings-action-btn"
          onClick={handleForceSync} disabled={diagSyncMsg === L(dict, '同步中…', 'Syncing…')}>
          {L(dict, '同步', 'Sync')}
        </Button>
      </div>
      <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: 'var(--portal-muted)', lineHeight: 1.6 }}>
        {L(dict, '对齐记忆、设置、衣橱/足迹/行程等模块,并拉日历·邮件·银行。不会清空本机。', 'Aligns memories, settings, wardrobe/places/trips, and pulls calendar·mail·bank. Never wipes this device.')}
      </p>
      {diagSyncMsg && (
        <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, lineHeight: 1.7, color: 'var(--portal-muted)' }}>{diagSyncMsg}</p>
      )}
      {auditReport && (auditState === 'done' || auditState === 'repairing') && (() => {
        const verdict = consistencyVerdict(auditReport);
        const pending = new Set(auditReport.pendingDeletes);
        const cloudOnly = auditReport.missingLocally.filter((id) => !pending.has(id));
        return (
          <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, lineHeight: 1.7,
            color: verdict === 'clean' ? 'var(--status-go)' : verdict === 'repairable' ? 'var(--status-gentle)' : 'var(--status-risk)' }}>
            {/* #14:这里原来写「本机 2541 条」,而记忆库首页写「2534 条」,用户当场就发现了。
                两个数各有各的对 —— 体检必须比对**全部节点**(天气快照那类环境信号也要上云),
                记忆库报的是**用户会当成记忆的那些**。错的是共用一个「条」字。
                所以先报记忆数(和记忆库对得上),再把「另有 N 条环境信号也在同步」说出来。 */}
            {verdict === 'clean'
              ? L(dict, `✓ 记忆 ${auditReport.localMemoryCount} 条,云端 ${auditReport.cloudCount} 条,一一对得上。`,
                  `✓ ${auditReport.localMemoryCount} memories, ${auditReport.cloudCount} in cloud — all matched.`)
              : L(dict, `记忆 ${auditReport.localMemoryCount} 条 · 云端 ${auditReport.cloudCount} 条`,
                  `${auditReport.localMemoryCount} memories · ${auditReport.cloudCount} in cloud`)}
            {auditReport.localCount > auditReport.localMemoryCount && (
              <><br />{L(dict, `· 另有 ${auditReport.localCount - auditReport.localMemoryCount} 条环境信号(天气快照那类)也在同步,不计入记忆。`,
                `· ${auditReport.localCount - auditReport.localMemoryCount} environment signals (weather snapshots etc.) also sync; not counted as memories.`)}</>
            )}
            {auditReport.missingInCloud.length > 0 && (
              <><br />{L(dict, `· ${auditReport.missingInCloud.length} 条还没上云 —— 点右边补传就好。`,
                `· ${auditReport.missingInCloud.length} not yet in the cloud — tap Upload to fix.`)}</>
            )}
            {/* 挂起的删除单独说清楚:它让云端看起来「多」,但那是正常的中间态,不是丢数据 */}
            {auditReport.pendingDeletes.length > 0 && (
              <><br />{L(dict, `· ${auditReport.pendingDeletes.length} 条删除还在等联网,云端暂时还留着。`,
                `· ${auditReport.pendingDeletes.length} deletions waiting to reach the cloud.`)}</>
            )}
            {cloudOnly.length > 0 && (
              <><br />{L(dict, `· 云端有 ${cloudOnly.length} 条本机没有 —— 多半是别的设备记的,下次打开会自己拉回来。`,
                `· ${cloudOnly.length} in the cloud but not here — likely from another device; they'll arrive on next open.`)}</>
            )}
            {auditReport.stuckCount > 0 && (
              <><br />{L(dict, `· ${auditReport.stuckCount} 条同步一直没成功,重试也不会自己好 —— 备份一份留底更稳妥。`,
                `· ${auditReport.stuckCount} keep failing to sync — a manual backup is the safer move.`)}</>
            )}
          </p>
        );
      })()}

      {/* 并排后放不下长标题,按钮上只留动词;导出的到底是什么放进 title(长按/悬停可见)。 */}
      <div className="nesio-settings-btn-row">
        <Button variant="soft" size="md" full className="nesio-settings-action-btn" onClick={handleExportLocal} disabled={exportBusy}
          title={L(dict, '导出全部:记忆 + 学到的偏好,下载 JSON', 'Export everything: memories + learned prefs, JSON')}>
          {exportBusy ? L(dict, '正在导出…', 'Exporting…') : L(dict, '导出', 'Export')}
        </Button>
        <Button variant="soft" size="md" full className="nesio-settings-action-btn" onClick={() => importRef.current?.click()}
          title={L(dict, '从备份 JSON 导入', 'Import from a backup JSON')}>
          {L(dict, '导入', 'Import')}
        </Button>
      </div>
      <input ref={importRef} type="file" accept="application/json,.json" className="nesio-visually-hidden" onChange={handleImportFile} />
      {restoreMsg && <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: restoreMsg.startsWith('✓') ? 'var(--status-go)' : 'var(--status-risk)' }}>{restoreMsg}</p>}
      {exportWarn && <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, lineHeight: 1.6, color: 'var(--status-gentle)' }}>{exportWarn}</p>}

      {/* 2026-07-29:三个红按钮原来是平铺的,一屏三条红 —— CLAUDE.md 红线明写「不用红色制造焦虑」,
          而且这三件事一年也未必做一次,却天天占着视线。收进一个入口,点开才展开。
          注意用 <details> 而不是 state:折叠这件事不需要 React 参与,原生元素自带无障碍语义。 */}
      <details className="nesio-settings-danger-zone">
        {/* bug3 p45:只留「删除数据」四个字 —— 副标题那行把三个选项提前念了一遍,
            而点开就能看见它们本身。 */}
        <summary className="nesio-settings-danger-summary">
          {L(dict, '删除数据', 'Delete data')}
        </summary>

        <Button variant="soft" size="md" tone="risk" full className="nesio-settings-danger-btn" onClick={clearAllMemory}>
          {deleted ? L(dict, '✓ 已清除', '✓ Cleared') : L(dict, '清除所有 Memory', 'Clear all memories')}
        </Button>
        {/* 2026-07-31:去掉原来的 style={{ opacity: 0.85 }} —— 三颗都是 risk,凭什么中间这颗淡 15%?
            说不出理由的差异就是「同一屏的按钮长得不像一家」的来源。要分轻重就用 variant。 */}
        <Button variant="soft" size="md" tone="risk" full className="nesio-settings-danger-btn" onClick={clearAllLocalData}>
          {L(dict, '彻底删除本机全部数据', 'Delete all local data')}
        </Button>
        {/* 只用 Google Drive:清 Nesio 云但保留登录与本机。 */}
        <Button variant="soft" size="md" tone="risk" full className="nesio-settings-danger-btn" onClick={clearNesioCloudKeepAccount}>
          {L(dict, '清空 Nesio 云(保留本机与登录)', 'Clear Nesio cloud (keep local & sign-in)')}
        </Button>
        {/* App Store 5.1.1 强制:App 内账号删除(云端 + 本机 + 登出)。 */}
        <Button variant="soft" size="md" tone="risk" full className="nesio-settings-danger-btn" onClick={deleteAccountAndData}>
          {L(dict, '删除账号与云端数据', 'Delete account & cloud data')}
        </Button>
        {deleteMsg && <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0 0', color: 'var(--status-risk)' }}>{deleteMsg}</p>}
      </details>

      {/* #23:这台设备到底在跑哪一版 —— 「界面没跟着变」十有八九是这里对不上。
          原来这个比对是静默自愈的,而静默的自愈机制在「它有没有生效」这种问题上等于不存在。 */}
      <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-5)', lineHeight: 1.7 }}>
        {L(dict, `这台设备的版本 ${localBuild}`, `This device is on build ${localBuild}`)}
        {liveBuild ? L(dict, ` · 线上 ${liveBuild}`, ` · live ${liveBuild}`) : ''}
        {buildStale && (
          <>
            <br />
            {L(dict, '和线上不一样 —— 界面没跟着更新多半是这个原因。', 'Different from live — that is usually why the UI looks out of date.')}
            <button type="button" onClick={() => window.location.reload()}
              style={{ marginLeft: 'var(--space-2)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--portal-accent)', fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-sans)', fontSize: 'inherit' }}>
              {L(dict, '取新版', 'Get the new build')}
            </button>
          </>
        )}
      </p>
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
      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-6)' }}>{L(dict, '实验功能', 'Experimental')}</p>
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

      {/* QA ⑤:测试开关不进对外正式部署 —— 显式构建旗标才渲染(静态可分析,产线 bundle 直接摇树掉);
          dev 默认放行,个人自部署想用就在环境里设 NEXT_PUBLIC_ENABLE_PRO_OVERRIDE=1。 */}
      {(process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENABLE_PRO_OVERRIDE === '1') && (
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
      )}

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
        <span className="nesio-settings-option-hint" aria-hidden style={{ fontSize: 'var(--text-h3)' }}>›</span>
      </button>

      {/* 2026-07-29:配色色卡搬到「外观与语言」。
          它是**日常设置**(和明暗、字号、语言并列),不是实验功能 ——
          藏在 Lab 里既难找,又让「点一张即时全站换装」这句承诺看着像内测玩具。 */}

      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-6)' }}>{L(dict, '功能开关中心', 'Feature switches')}</p>
      <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-2)' }}>
        {L(dict, '逐个控制功能可见性。优先级:这里的显式 开/关 最大;「默认」= 标了「随 Lab」的内测域跟随上面的 Lab 总闸,其余跟随公开版。核心(拍/说/分享/问一问/洞察/今日)始终在,不在此列。改动即时生效。',
          'Controls feature visibility. Precedence: explicit On/Off here wins; "Default" follows the Lab switch above for rows tagged "Lab", otherwise the public build. Core (snap / voice / share / ask / insights / today) is always on and not listed. Applies instantly.')}
      </p>
      {(['module', 'feature'] as const).map((kind) => {
        const rows = FEATURE_CATALOG.filter((f) => f.kind === kind);
        if (!rows.length) return null;
        return (
          <div key={kind}>
            <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0 var(--space-1)', fontWeight: 600 }}>
              {kind === 'module' ? L(dict, '工具模块', 'Tool modules') : L(dict, '子功能', 'Sub-features')}
            </p>
            {rows.map((m) => {
              const cur = moduleOv[m.id] ?? null; // null = 跟随默认
              const seg = (val: 'on' | 'off' | null, label: string) => (
                <button
                  type="button"
                  onClick={() => setModuleOverride(m.id, val)}
                  style={{
                    flex: 1, padding: 'var(--space-1) 0', fontSize: 'var(--text-xs)', borderRadius: 'var(--radius-sm)',
                    border: '0.5px solid var(--portal-border)',
                    background: cur === val ? 'var(--portal-accent-soft)' : 'transparent',
                    color: cur === val ? 'var(--portal-accent, var(--portal-fg))' : 'var(--portal-muted)',
                    fontWeight: cur === val ? 600 : 400,
                  }}
                >{label}</button>
              );
              const defOn = defaultResolvesTo(m.id, m.defaultOn); // labOn 变化触发重渲,这里即时反映
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: '0 0 var(--space-2)' }}>
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {dict === 'en' ? m.en : m.zh}
                    {followsLab(m.id) && (
                      <span style={{ fontSize: '0.6rem', color: 'var(--portal-muted)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-pill)', padding: '0 var(--space-1)' }}>
                        {L(dict, '随 Lab', 'Lab')}
                      </span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', width: '11rem' }}>
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

  // #22(2026-07-30 真机复发):同一屏「试用中 / 规划中 / 你已是 Pro 会员」三句话打架。
  // 上一轮把状态卡接上了 pro,但**页面另外两处还在看 isPaidPro** ——
  // 两个判据管三块内容,只要它们分歧(本机 tier=pro 而服务端没确认付费),
  // 矛盾就会原样回来。会员状态在这一屏只能有一个判据,算一次,处处用它。
  const trialDays = trialDaysLeft();
  const pro = isPaidPro || (getTier() === 'pro' && trialDays <= 0);

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '会员与权益', 'Membership')}>
      {(() => {
        const days = trialDays;
        return (
          <div className="nesio-sub-status-card">
            <div className="nesio-sub-status-badge nesio-sub-status-badge--free">
              {pro ? 'PRO' : days > 0 ? L(dict, `免费试用 · 剩 ${days} 天`, `Free trial · ${days}d left`) : t(locale, 'subBadgeFree')}
            </div>
            <p className="nesio-sub-status-title">
              {pro
                ? L(dict, '你已是 Pro 会员', "You're on Pro")
                : days > 0
                  ? L(dict, '前 21 天全功能免费', 'First 21 days, everything unlocked')
                  : t(locale, 'subFreeTitle')}
            </p>
            <p className="nesio-sub-status-desc">
              {pro
                ? L(dict, '订阅生效中,全部功能已解锁。可在支付渠道随时管理或取消。', 'Subscription active — everything is unlocked. Manage or cancel anytime via your payment provider.')
                : days > 0
                  ? L(dict, '3 周,刚好养成一个记录的好习惯。试用结束自动回到免费版,不扣费。', 'Three weeks — just long enough to build a note-taking habit. Afterwards you return to Free; nothing is charged.')
                  : t(locale, 'subFreeDesc')}
            </p>
          </div>
        );
      })()}

      {/* Pro 权益清单(会员权益介绍) */}
      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{L(dict, 'Pro 能做什么', 'What Pro unlocks')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        {[
          L(dict, 'AI 自动识别与整理(拍照 / 分享 / 文件)', 'AI recognition & organizing (photos / shares / files)'),
          L(dict, '问一问深度回答(对话式检索)', 'Deep conversational answers in Ask'),
          L(dict, 'AI 例程与日程建议', 'AI routines and schedule suggestions'),
          L(dict, '邮件直接回复(AI 起草,你点发送)', 'Direct email replies (AI drafts, you send)'),
          L(dict, '冷冻仓(冲动购买冷静期)', 'Freeze Vault (cooling-off for impulse buys)'),
        ].map((b) => (
          <div key={b} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--status-go)', flexShrink: 0 }}>✓</span><span>{b}</span>
          </div>
        ))}
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: 'var(--space-1) 0 0' }}>
          {L(dict, '记录、搜索、手动标签永久免费。', 'Capturing, search, and manual tags stay free forever.')}
        </p>
      </div>

      {/* 已经是付费会员就别再摆一排「规划中」的价格 —— 那看着像「还没开卖」,
          和上面刚说的「订阅生效中」正好对撞(用户报的第三重矛盾)。 */}
      {!pro && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{t(locale, 'subFuturePlans')}</p>
          {PLAN_PREVIEWS.map((plan) => (
            <div key={plan.id} className="nesio-sub-upgrade-row">
              <div className="nesio-sub-upgrade-info">
                <p className="nesio-sub-upgrade-name">{L(dict, plan.name, plan.nameEn)}</p>
                <p className="nesio-sub-upgrade-desc">{L(dict, plan.desc, plan.descEn)}</p>
              </div>
              <div className="nesio-sub-upgrade-right">
                <p className="nesio-sub-upgrade-price">{plan.price}<span>{L(dict, plan.cycle, plan.cycleEn)}</span></p>
                {/* 这不是按钮,是状态标。原来是实线描边 pill,和站内可点的 chip 长得一模一样,
                    用户挨个点过去发现「点不动」。虚线 + 更淡 = 一眼看出是标记不是入口。 */}
                <span className="nesio-sub-plan-flag">{t(locale, 'subPlanned')}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {pro ? (
        <div style={{ marginTop: 'var(--space-5)', padding: 'var(--space-4) var(--space-4)', borderRadius: 'var(--radius-sm)', textAlign: 'center', background: 'var(--portal-card, #fff)', border: '1px solid var(--status-gentle, #6cbf84)' }}>
          <p style={{ fontWeight: 600, margin: 0, color: 'var(--status-gentle, #4a9d63)' }}>{L(dict, '✓ 你已是 Pro 会员', "✓ You're a Pro member")}</p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: 'var(--space-1) 0 0' }}>{L(dict, '订阅生效中,感谢支持。可在支付渠道管理或取消。', 'Subscription active — thank you. Manage or cancel via your payment provider.')}</p>
        </div>
      ) : (
      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: 'var(--space-5)' }} onClick={handleUpgrade} disabled={upgradeBusy || notified}>
        {notified ? `✓ ${t(locale, 'subNotifyDone')}` : upgradeBusy ? L(dict, '正在跳转…', 'Redirecting…') : L(dict, '升级 Pro', 'Upgrade to Pro')}
      </button>
      )}
      {billingHint === 'signin' && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', textAlign: 'center', marginTop: 'var(--space-2)' }}>
          {L(dict, '登录后即可升级。', 'Sign in first to upgrade.')}
        </p>
      )}
      {billingError && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--status-risk, #d9534f)', textAlign: 'center', marginTop: 'var(--space-2)', wordBreak: 'break-word' }}>
          {L(dict, '支付未能发起:', 'Checkout failed: ')}{billingError}
        </p>
      )}
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
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
  // #21:登录态只有一个答案(见 lib/portal/session-state)。
  // 「问不出来」保持 unknown,不倒退成「未登录」—— 那正是「已登录」和「未登录」同屏的由来。
  const session = useSessionState(open);
  const loggedIn = session.state === 'signed-in';
  const email = session.email;
  const [name, setName] = useState('');
  const [savedTip, setSavedTip] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const p = loadProfileSettings();
    setName(p.displayName && p.displayName !== '我' ? p.displayName : '');
    setSavedTip(false);
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
    // 服务端清票据(cookie)。
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    // 数据泄露收口:退出登录 = 把本机全部用户数据从这台设备抹掉(头像/昵称/记忆/今天/健康/财务/
    // 地点/邮件全文…),否则下一个人或 guest 会看到上一个账号的数据。**只清本机、不碰云**
    // (数据已跨端同步,重新登录自动从云拉回)—— 走 purgeLocalUserDataForLogout,绝不走会传导云删除的
    // deleteLifeNode。best-effort:即便清理抛错也照常登出、进登录页。
    try {
      const { purgeLocalUserDataForLogout } = await import('@/lib/portal/local-owner');
      await purgeLocalUserDataForLogout();
    } catch { /* 仍要登出跳转 */ }
    // 退出后进登录页(不是首页),兑现「退出登录 → 登录页 + 全空白」。
    window.location.href = '/login';
  }

  const days = trialDaysLeft();
  const tierLabel = getTier() === 'pro'
    ? (days > 0 ? L(dict, `试用中 · 剩 ${days} 天`, `Trial · ${days}d left`) : 'Pro')
    : L(dict, '免费版', 'Free');
  const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--portal-line)', fontSize: 'var(--text-body)' };

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
      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: 'var(--space-2)' }} onClick={saveName}>
        {savedTip ? L(dict, '✓ 已保存', '✓ Saved') : L(dict, '保存昵称', 'Save nickname')}
      </button>
      {savedTip && (
        <p className="nesio-settings-option-hint" aria-live="polite" style={{ margin: 'var(--space-1) 0 0', color: 'var(--status-go)' }}>
          {L(dict, `念念以后叫你「${name.trim() || '我'}」`, `Nessa will call you "${name.trim() || 'you'}" from now on`)}
        </p>
      )}
      <button type="button" className="nesio-settings-option" style={{ marginTop: 'var(--space-2)' }} onClick={onPickAvatar}>
        <span className="nesio-settings-option-label">{L(dict, '更换头像', 'Change avatar')}</span>
        <span aria-hidden style={{ color: 'var(--portal-muted)' }}>›</span>
      </button>

      {!loggedIn ? (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '账户', 'Account')}</p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
            {L(dict, '还没登录。登录后可跨设备同步、连接邮箱/日历。', 'Not signed in. Sign in to sync across devices and connect email/calendar.')}
          </p>
          <a href="/login" className="nesio-ob-primary-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'var(--space-3)' }}>
            {L(dict, '去登录', 'Sign in')}
          </a>
        </>
      ) : (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '账户', 'Account')}</p>
          <div style={rowStyle}><span style={{ color: 'var(--portal-muted)' }}>{L(dict, '邮箱', 'E-mail')}</span><span>{email || '—'}</span></div>
          <button type="button" onClick={onOpenMembership} style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--portal-line)', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ color: 'var(--portal-muted)' }}>{L(dict, '套餐', 'Plan')}</span>
            <span>{tierLabel} ›</span>
          </button>

          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '购买', 'Purchases')}</p>
          {/* 随 App 版 StoreKit 开放;disabled={true} 满足 no-inert-buttons 契约的显式禁用标注 */}
          <button type="button" disabled={true} style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', color: 'var(--portal-muted)', cursor: 'default', textAlign: 'left' }}>
            <span>{L(dict, '恢复购买', 'Restore purchase')}</span>
            <span style={{ fontSize: 'var(--text-xs)' }}>{L(dict, '随 App 版开放', 'Coming with the App Store version')}</span>
          </button>

          {/* 图1b:改密码移到登录/忘记密码流程,账户页不再放。删除账号入口在「数据与隐私」。 */}
          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '会话', 'Session')}</p>
          <button type="button" onClick={signOut} style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', borderBottom: 'none', color: 'var(--status-risk)', cursor: 'pointer', textAlign: 'left' }}>
            <span>{L(dict, '退出登录', 'Sign out')}</span>
          </button>
        </>
      )}
    </SheetWrap>
  );
}
