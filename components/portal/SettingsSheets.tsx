'use client';

/**
 * Settings sub-sheets: 语气与边界 / 隐私与数据 / 生活空间 / 订阅
 * Each is a slide-up bottom sheet opened from NesioProfileCard.
 */

import { useEffect, useRef, useState } from 'react';
import { PORTAL_LOCALE_OPTIONS, loadProfileSettings, portalLocaleToDictionaryLocale, saveProfileSettings, type PortalLocale } from '@/lib/portal/profile';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { L, t } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { IconChevronRight, IconHalfMoon, IconLink, IconLock, IconMoon, IconShield, IconSun } from './icons';
import { InfoTip } from './InfoTip';
import { PROACTIVE_LEVEL_KEY } from './today/proactive-types';
import { deleteLifeNode, getLifeGraph } from '@/lib/portal/life-graph';
import { purgeLocalData } from '@/lib/portal/storage-manifest';
import { purgeIdbBlobs } from '@/lib/portal/idb-blob-store';
import { purgeLocalImages } from '@/lib/portal/local-image-store';
import { TOGGLEABLE_MODULES, loadModuleOverrides, setModuleOverride, MODULE_OVERRIDES_EVENT } from '@/lib/portal/module-overrides';
import { isValidBackup } from '@/lib/portal/full-backup';
import { buildCombinedBackup, pushBackupToCloud, pullBackupFromCloud, restoreCombinedBackup, hasCloudEntitlement, lastCloudBackup, type CloudBackupError, type CloudRestoreError } from '@/lib/portal/cloud-backup';

interface SheetProps { open: boolean; onClose: () => void; }

function SheetWrap({ open, onClose, title, tip, children }: SheetProps & { title: string; tip?: string; children: React.ReactNode }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  if (!open) return null;
  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{title}{tip && <InfoTip text={tip} />}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body">{children}</div>
      </div>
    </div>
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
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next);
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

      {/* 偏好组(批次 10:语气/示例/提醒程度/触感全部折叠进偏好,头部显示当前值) */}
      <button type="button" className="nesio-settings-option" onClick={() => setPrefsOpen((v) => !v)} aria-expanded={prefsOpen}>
        <div>
          <span className="nesio-settings-option-label">{t(locale, 'sectionPreferences')}</span>
          <span className="nesio-settings-option-hint">
            {toneOpts.find((o) => o.id === tone)?.label} · {levelOpts.find((o) => o.id === interrupt)?.label}
          </span>
        </div>
        <span aria-hidden style={{ display: 'inline-flex', color: 'var(--portal-muted)', transform: prefsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><IconChevronRight size={16} /></span>
      </button>
      {prefsOpen && (<>
      <p className="nesio-settings-option-hint" style={{ margin: '0.35rem 0 0.6rem' }}>{t(locale, 'sectionPreferencesHint')}</p>

      <p className="nesio-settings-section-label">{t(locale, 'sectionTone')}</p>
      {toneOpts.map((opt) => (
        <button key={opt.id} type="button"
          className={`nesio-settings-option${tone === opt.id ? ' nesio-settings-option--active' : ''}`}
          onClick={() => pickTone(opt.id)}>
          <div>
            <span className="nesio-settings-option-label">{opt.label}</span>
            <span className="nesio-settings-option-hint">{opt.hint}</span>
          </div>
          {tone === opt.id && <span className="nesio-settings-option-check">✓</span>}
        </button>
      ))}
      {/* 实时示例:让人一眼看出三种语气的差别 */}
      <div style={{ background: 'rgba(88,140,227,0.06)', border: '1px solid var(--portal-line)', borderRadius: '0.75rem', padding: '0.55rem 0.75rem', marginTop: '0.35rem' }}>
        <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', margin: '0 0 0.2rem' }}>{t(locale, 'toneExampleLabel')}</p>
        <p style={{ fontSize: '0.78rem', color: 'var(--portal-ink)', margin: 0, lineHeight: 1.55 }}>
          {tone === 'warm' ? t(locale, 'toneExampleWarm') : tone === 'direct' ? t(locale, 'toneExampleDirect') : t(locale, 'toneExampleMinimal')}
        </p>
      </div>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionReminders')}</p>
      {levelOpts.map((opt) => (
        <button key={opt.id} type="button"
          className={`nesio-settings-option${interrupt === opt.id ? ' nesio-settings-option--active' : ''}`}
          onClick={() => pickInterrupt(opt.id)}>
          <div>
            <span className="nesio-settings-option-label">{opt.label}</span>
            <span className="nesio-settings-option-hint">{opt.hint}</span>
          </div>
          {interrupt === opt.id && <span className="nesio-settings-option-check">✓</span>}
        </button>
      ))}

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionHaptics')}</p>
      <button type="button"
        className={`nesio-settings-option${hapticsOn ? ' nesio-settings-option--active' : ''}`}
        onClick={toggleHaptics}>
        <div>
          <span className="nesio-settings-option-label">{t(locale, 'hapticsLabel')}</span>
          <span className="nesio-settings-option-hint">{t(locale, 'hapticsHint')}</span>
        </div>
        <span className={`nesio-settings-space-check${hapticsOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {hapticsOn ? '✓' : '○'}
        </span>
      </button>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '每日日报', 'Daily report')}</p>
      <button type="button"
        className={`nesio-settings-option${dailyReportOn ? ' nesio-settings-option--active' : ''}`}
        onClick={toggleDailyReport}>
        <div>
          <span className="nesio-settings-option-label">{L(dict, '每日 AI 图文日报', 'Daily AI report')}</span>
          <span className="nesio-settings-option-hint">{L(dict, '每天自动生成一份「今天的日程/提醒/天气」图文小结,存进记忆,并在今日的「未来预测」里给你。', 'Auto-builds a visual recap of your day — schedule, reminders, weather — saved to memory and surfaced under Today.')}</span>
        </div>
        <span className={`nesio-settings-space-check${dailyReportOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {dailyReportOn ? '✓' : '○'}
        </span>
      </button>
      </>)}

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


export function PrivacySheet({ open, onClose }: SheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [nodeCount, setNodeCount] = useState(0);
  const [deleted, setDeleted] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [labOn, setLabOn] = useState(false);
  const [labMsg, setLabMsg] = useState<string | null>(null);
  const [moduleOv, setModuleOv] = useState<Record<string, 'on' | 'off'>>({});
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
  useEffect(() => {
    try { const v = localStorage.getItem('nesio-backup-dest'); if (v === 'nesio' || v === 'drive') setBackupDest(v); } catch { /* ignore */ }
  }, []);
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
      setDriveMsg(L(dict, '备份到 Drive 没成功 —— 稍后再试或用「导出完整备份」', "Drive backup didn't go through — try later or use Export full backup"));
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
          : L(dict, '从 Drive 恢复没成功 —— 稍后再试', "Restore from Drive didn't go through — try later"));
    }
  }

  async function exportFullBackup() {
    // 与云备份用同一份枚举(localStorage durable + IDB blob),避免两处漂移。
    // 本机导出带上照片(includeImages):这是「拿走你的全部数据」的完整出口。
    const backup = await buildCombinedBackup({ includeImages: true });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nesio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    try { localStorage.setItem('nesio-last-backup-at', new Date().toISOString()); } catch { /* ignore */ }
    setLastBackupAt(new Date().toISOString());
  }

  function cloudErrorText(err: CloudBackupError): string {
    switch (err) {
      case 'entitlement_required': return L(dict, '云备份即将开放 —— 到下方「订阅」留个位,开放时第一时间通知你。', "Cloud backup is coming soon — join the waitlist under Subscription and we'll ping you first.");
      case 'not_signed_in': return L(dict, '先登录(上方入口),才能同步到你的云账户。', 'Sign in first (link above) to sync to your cloud account.');
      case 'cloud_not_configured': return L(dict, '云同步暂未开启,稍后再试。', "Cloud sync isn't enabled yet — try later.");
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
      setLabOn(localStorage.getItem('baohe_personal_lab') === '1' || localStorage.getItem('baohe_lab_mode') === '1');
    } catch { /* ignore */ }
    return () => window.removeEventListener('nesio-life-graph-updated', readCount);
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
        localStorage.removeItem('baohe_personal_lab');
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
    setLabMsg(turningOn
      ? L(dict, 'Lab 模式已开启', 'Lab mode on')
      : L(dict, 'Lab 模式已关闭', 'Lab mode off'));
    try { window.dispatchEvent(new CustomEvent('nesio-lab-mode-updated')); } catch { /* ignore */ }
    setTimeout(() => setLabMsg(null), 1800);
  }

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

  return (
    <SheetWrap open={open} onClose={onClose} title={L(dict, '隐私与数据', 'Privacy & data')}>
      <p className="nesio-settings-sheet-desc">{L(dict, '只整理你放进来的内容。你可以看见它记住了什么、存在哪、也可以随时删除。', 'Only what you put in gets organized. You can see what it remembers, where it lives, and delete it anytime.')}</p>

      {/* 数据主权面板 — local-first 从架构卖点变成可感知的安全感 */}
      <div style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.08))', borderRadius: 14, padding: '0.8rem 1rem', marginBottom: '0.9rem' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 600, margin: '0 0 0.4rem', color: 'var(--portal-blue-deep)', display: 'flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> {L(dict, '你的数据在哪里', 'Where your data lives')}<InfoTip text={L(dict, '记忆存在本设备 localStorage;未登录、未授权或未选择接入的日历、邮件、健康和文件内容永远不会被加载;登录后才开启跨设备云同步。', "Memories live in this device's localStorage. Calendar, mail, health and files are never loaded unless you sign in, authorize and connect them. Cross-device cloud sync starts only after sign-in.")} /></p>
        <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.7rem', lineHeight: 1.6 }}>
          <div><span style={{ fontSize: '1rem', fontWeight: 700 }}>{nodeCount}</span><br />{L(dict, '条记忆,全在本机', 'memories, all on this device')}</div>
          <div><span style={{ fontSize: '1rem', fontWeight: 700 }}>0</span><br />{L(dict, '条在云端(未登录)', 'in the cloud (signed out)')}</div>
          <div>
            <span style={{ fontSize: '1rem', fontWeight: 700 }}>{lastBackupAt ? new Date(lastBackupAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' }) : L(dict, '还没有', 'never')}</span><br />
            {lastBackupAt ? L(dict, '上次备份', 'last backup') : L(dict, '备份过', 'backed up')}
          </div>
        </div>
        {!lastBackupAt && (
          <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', margin: '0.4rem 0 0' }}>{L(dict, '数据只在这台设备上。导出一份完整备份,换手机也不会丢。', 'Data lives only on this device. Export a full backup so a new phone loses nothing.')}</p>
        )}
      </div>

      {/* 批次 18:「哪些内容不会被使用 / Memory 记录 / 云端同步」三行与顶部
          数据主权卡重复(条数/云端/备份都在卡上),删除;说明收进卡标题 ?,
          登录入口保留一行 */}
      <a href="/login" className="nesio-settings-action-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
        {L(dict, '登录,开启跨设备云同步', 'Sign in to sync across devices')}
      </a>

      {/* Export */}
      <button type="button" className="nesio-settings-action-btn" onClick={() => {
        const data = JSON.stringify(getLifeGraph(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'nesio-memory.json'; a.click();
      }}>
        {L(dict, '导出 Memory 数据（JSON）', 'Export Memory data (JSON)')}
      </button>

      <button type="button" className="nesio-settings-action-btn" onClick={exportFullBackup}>
        {L(dict, '导出完整备份（含项目/情绪/设置等全部本地数据）', 'Export full backup (projects, moods, settings — all local data)')}
      </button>

      {/* 云备份:目的地选择器(Google Drive 免费 / Nesio 云兜底)。一键把本机全部 durable
          数据推到所选云,换机不丢。每个异步动作都渲染明确失败态(设计红线)。 */}
      <p style={{ fontSize: '0.78rem', color: 'var(--portal-muted)', margin: '0.6rem 0 0.3rem' }}>{L(dict, '备份到哪里', 'Back up to')}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        {([['drive', L(dict, '☁ Google Drive · 免费', '☁ Google Drive · Free')], ['nesio', L(dict, `☁ Nesio 云${cloudEntitled ? '' : L(dict, ' · 付费', ' · Paid')}`, `☁ Nesio cloud${cloudEntitled ? '' : ' · Paid'}`)]] as const).map(([d, label]) => (
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
          : L(dict, '存到 Nesio 云(付费/规划中)。', 'Saved to Nesio cloud (paid/coming soon).')}
      </p>

      <button type="button" className="nesio-settings-action-btn" onClick={handleBackupChosen} disabled={cloudState === 'pushing' || driveState === 'busy'}>
        {(cloudState === 'pushing' || driveState === 'busy') ? L(dict, '正在备份…', 'Backing up…') : L(dict, '备份 · 换机不丢', 'Back up · survive a new phone')}
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

      <button type="button" className="nesio-settings-action-btn" onClick={() => importRef.current?.click()}>
        {L(dict, '导入备份', 'Import backup')}
      </button>
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={handleImportFile} />
      {restoreMsg && <p style={{ fontSize: '0.75rem', marginTop: 4, color: restoreMsg.startsWith('✓') ? 'var(--status-go)' : 'var(--status-risk)' }}>{restoreMsg}</p>}

      <button type="button" className="nesio-settings-danger-btn" onClick={clearAllMemory}>
        {deleted ? L(dict, '✓ 已清除', '✓ Cleared') : L(dict, '清除所有 Memory', 'Clear all Memory')}
      </button>
      <button type="button" className="nesio-settings-danger-btn" style={{ marginTop: '0.4rem', opacity: 0.85 }} onClick={clearAllLocalData}>
        {L(dict, '彻底删除本机全部数据', 'Delete all local data')}
      </button>

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
                ? L(dict, '实验工具和预览功能已解锁。关闭后回到公开版。', 'Experimental tools and previews unlocked. Turn off to return to the public build.')
                : L(dict, '解锁实验工具和预览功能。之前需要 ?baohePersonal=1 参数,现在点这里就行。', 'Unlock experimental tools and previews. Used to need ?baohePersonal=1 — now just tap here.')}
          </span>
        </div>
        <span className={`nesio-settings-space-check${labOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {labOn ? '✓' : '○'}
        </span>
      </button>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.5rem' }}>{L(dict, '功能模块', 'Feature modules')}</p>
      <p className="nesio-settings-option-hint" style={{ margin: '0 0 0.6rem' }}>
        {L(dict, '逐个控制工具模块。「默认」跟随公开版(拍一拍/说一句/分享/问一问/洞察/未来预测/今日聚焦 始终在)。改动即时生效,无需刷新。',
          'Toggle tools one by one. "Default" follows the public build (snap / voice / share / ask / insights / forecast / today focus are always on). Changes apply instantly, no refresh.')}
      </p>
      {TOGGLEABLE_MODULES.map((m) => {
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
        return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.4rem' }}>
            <span style={{ flex: 1, fontSize: '0.82rem' }}>{dict === 'en' ? m.en : m.zh}</span>
            <div style={{ display: 'flex', gap: '0.25rem', width: '9.5rem' }}>
              {seg(null, L(dict, '默认', 'Default'))}
              {seg('on', L(dict, '开', 'On'))}
              {seg('off', L(dict, '关', 'Off'))}
            </div>
          </div>
        );
      })}
    </SheetWrap>
  );
}

// ── 早期体验(诚实版,2026-07-04)────────────────────
// 此前的 7 天体验倒计时与「升级」按钮是没有支付系统支撑的假流程
// (点了只弹 alert)。改为:如实说明当前全免费 + 未来计划只做预览
// + 唯一真实动作「开放时通知我」(遥测登记意向,顺带是定价验证信号)。

const PLAN_NOTIFY_KEY = 'nesio-plan-notify-optin-v1';

const PLAN_PREVIEWS = [
  { id: 'pro', name: 'Nesio Pro', nameEn: 'Nesio Pro', price: '¥18', cycle: '/ 月', cycleEn: '/ mo', desc: '跨设备同步 · 主动提醒 · AI 洞察报告', descEn: 'Cross-device sync · proactive reminders · AI insight reports' },
  { id: 'family', name: '家庭版', nameEn: 'Family', price: '¥38', cycle: '/ 月', cycleEn: '/ mo', desc: '最多 5 人共享 · 家人动态 · 自动化动作', descEn: 'Up to 5 people · family updates · automated actions' },
];

export function SubscriptionSheet({ open, onClose }: SheetProps) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!open) return;
    try { setNotified(localStorage.getItem(PLAN_NOTIFY_KEY) === '1'); } catch { /* ignore */ }
  }, [open]);

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
    <SheetWrap open={open} onClose={onClose} title={t(locale, 'subTitle')}>
      <div className="nesio-sub-status-card">
        <div className="nesio-sub-status-badge nesio-sub-status-badge--free">{t(locale, 'subBadgeFree')}</div>
        <p className="nesio-sub-status-title">{t(locale, 'subFreeTitle')}</p>
        <p className="nesio-sub-status-desc">{t(locale, 'subFreeDesc')}</p>
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

      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1.2rem' }} onClick={optIn} disabled={notified}>
        {notified ? `✓ ${t(locale, 'subNotifyDone')}` : t(locale, 'subNotify')}
      </button>
    </SheetWrap>
  );
}
