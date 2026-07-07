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
import { collectIdbBlobs, purgeIdbBlobs } from '@/lib/portal/idb-blob-store';
import { buildFullBackup, isValidBackup, restoreFullBackup } from '@/lib/portal/full-backup';

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
  const [tone, setTone] = useState<ToneStyle>('warm');
  const [interrupt, setInterrupt] = useState<InterruptLevel>('proactive');
  const [hapticsOn, setHapticsOn] = useState(true);
  const [theme, setTheme] = useState<ThemeChoice>('auto');

  useEffect(() => {
    if (!open) return;
    const p = loadProfileSettings();
    setTone((p.coachStyle as ToneStyle) || 'warm');
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
  const importRef = useRef<HTMLInputElement>(null);

  async function exportFullBackup() {
    const backup = buildFullBackup(localStorage);
    // 收口:健康/临床/地点已迁 IDB —— 备份要合并 IDB blob,否则设备迁移丢这些数据。
    backup.entries = { ...backup.entries, ...(await collectIdbBlobs()) };
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
    const result = restoreFullBackup(localStorage, parsed, replace ? 'replace' : 'merge');
    setNodeCount(getLifeGraph().length);
    setRestoreMsg(L(dict,
      `✓ 已恢复 ${result.restoredKeys} 项${result.mergedNodes != null ? `，记忆合并后共 ${result.mergedNodes} 条` : ''}`,
      `✓ Restored ${result.restoredKeys} entries${result.mergedNodes != null ? `, ${result.mergedNodes} memories after merge` : ''}`));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }

  useEffect(() => {
    if (!open) return;
    setDeleted(false);
    setNodeCount(getLifeGraph().length);
    try {
      setLastBackupAt(localStorage.getItem('nesio-last-backup-at'));
      setLabOn(localStorage.getItem('baohe_personal_lab') === '1' || localStorage.getItem('baohe_lab_mode') === '1');
    } catch { /* ignore */ }
  }, [open]);

  function toggleLab() {
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
    window.location.reload(); // launch-surface resolver 在加载时读取
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
            {labOn
              ? L(dict, '实验工具和预览功能已解锁。关闭后回到公开版。', 'Experimental tools and previews unlocked. Turn off to return to the public build.')
              : L(dict, '解锁实验工具和预览功能。之前需要 ?baohePersonal=1 参数,现在点这里就行。', 'Unlock experimental tools and previews. Used to need ?baohePersonal=1 — now just tap here.')}
          </span>
        </div>
        <span className={`nesio-settings-space-check${labOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {labOn ? '✓' : '○'}
        </span>
      </button>
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
