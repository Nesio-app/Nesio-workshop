'use client';

/**
 * Settings sub-sheets: 语气与边界 / 隐私与数据 / 生活空间 / 订阅
 * Each is a slide-up bottom sheet opened from NesioProfileCard.
 */

import { useEffect, useRef, useState } from 'react';
import { PORTAL_LOCALE_OPTIONS, loadProfileSettings, saveProfileSettings, type PortalLocale } from '@/lib/portal/profile';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { t } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { IconChevronRight, IconHalfMoon, IconLink, IconLock, IconMoon, IconShield, IconSun } from './icons';
import { PROACTIVE_LEVEL_KEY } from './today/proactive-types';
import { deleteLifeNode, getLifeGraph } from '@/lib/portal/life-graph';
import { buildFullBackup, isValidBackup, restoreFullBackup } from '@/lib/portal/full-backup';

interface SheetProps { open: boolean; onClose: () => void; }

function SheetWrap({ open, onClose, title, children }: SheetProps & { title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{title}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
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
    <SheetWrap open={open} onClose={onClose} title={t(locale, 'generalTitle')}>
      <p className="nesio-settings-sheet-desc">{t(locale, 'generalDesc')}</p>

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

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionAppearance')}</p>
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
      <p className="nesio-settings-option-hint" style={{ marginTop: 4 }}>{t(locale, 'generalAutoHint')}</p>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{t(locale, 'sectionLanguage')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.45rem' }}>
        {PORTAL_LOCALE_OPTIONS.map(([code, label]) => (
          <button key={code} type="button"
            className={`nesio-settings-option${locale === code ? ' nesio-settings-option--active' : ''}`}
            style={{ justifyContent: 'center', padding: '0.55rem 0.3rem' }}
            onClick={() => pickLang(code)}>
            <span className="nesio-settings-option-label" style={{ fontSize: '0.78rem' }}>{label}</span>
          </button>
        ))}
      </div>
      <p className="nesio-settings-option-hint" style={{ marginTop: 4 }}>{t(locale, 'languageFallbackNote')}</p>

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
  const [nodeCount, setNodeCount] = useState(0);
  const [deleted, setDeleted] = useState(false);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [requestingLoc, setRequestingLoc] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [labOn, setLabOn] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  function exportFullBackup() {
    const backup = buildFullBackup(localStorage);
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
    catch { setRestoreMsg('文件不是有效的 JSON'); return; }
    if (!isValidBackup(parsed)) { setRestoreMsg('不是有效的 Nesio 备份文件'); return; }

    const replace = confirm(
      `备份包含 ${Object.keys(parsed.entries).length} 项数据（${parsed.exportedAt.slice(0, 10)} 导出）。\n\n` +
      '「确定」= 覆盖恢复（备份内容覆盖本机）\n「取消」= 合并恢复（记忆按条合并，其余仅补缺）',
    );
    const result = restoreFullBackup(localStorage, parsed, replace ? 'replace' : 'merge');
    setNodeCount(getLifeGraph().length);
    setRestoreMsg(`✓ 已恢复 ${result.restoredKeys} 项${result.mergedNodes != null ? `，记忆合并后共 ${result.mergedNodes} 条` : ''}`);
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
    navigator.permissions?.query({ name: 'geolocation' }).then((r) => {
      setLocationGranted(r.state === 'granted');
    }).catch(() => setLocationGranted(null));
  }, [open]);

  function requestLocation() {
    setRequestingLoc(true);
    navigator.geolocation.getCurrentPosition(
      () => { setLocationGranted(true); setRequestingLoc(false); },
      () => { setLocationGranted(false); setRequestingLoc(false); },
    );
  }

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
    if (!confirm('删除后，Nesio 不再用这些记忆提醒你。确认继续？')) return;
    const nodes = getLifeGraph();
    nodes.forEach((n) => deleteLifeNode(n.id));
    setNodeCount(0);
    setDeleted(true);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="隐私与数据">
      <p className="nesio-settings-sheet-desc">只整理你放进来的内容。你可以看见它记住了什么、存在哪、也可以随时删除。</p>

      {/* 数据主权面板 — local-first 从架构卖点变成可感知的安全感 */}
      <div style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.08))', borderRadius: 14, padding: '0.8rem 1rem', marginBottom: '0.9rem' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 600, margin: '0 0 0.4rem', color: 'var(--portal-blue-deep)', display: 'flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> 你的数据在哪里</p>
        <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.7rem', lineHeight: 1.6 }}>
          <div><span style={{ fontSize: '1rem', fontWeight: 700 }}>{nodeCount}</span><br />条记忆,全在本机</div>
          <div><span style={{ fontSize: '1rem', fontWeight: 700 }}>0</span><br />条在云端(未登录)</div>
          <div>
            <span style={{ fontSize: '1rem', fontWeight: 700 }}>{lastBackupAt ? new Date(lastBackupAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '还没有'}</span><br />
            {lastBackupAt ? '上次备份' : '备份过'}
          </div>
        </div>
        {!lastBackupAt && (
          <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', margin: '0.4rem 0 0' }}>数据只在这台设备上。导出一份完整备份,换手机也不会丢。</p>
        )}
      </div>

      <div className="nesio-settings-info-row">
        <div>
          <p className="nesio-settings-option-label">哪些内容不会被使用</p>
          <p className="nesio-settings-option-hint">未登录、未授权或未选择接入的日历、邮件、健康和文件内容不会被加载。</p>
        </div>
      </div>

      {/* Location */}
      <div className="nesio-settings-info-row">
        <div>
          <p className="nesio-settings-option-label">地理位置</p>
          <p className="nesio-settings-option-hint">只用于天气和外出提醒</p>
        </div>
        <button type="button"
          className={`nesio-settings-toggle-btn${locationGranted ? ' nesio-settings-toggle-btn--on' : ''}`}
          onClick={requestLocation} disabled={requestingLoc}>
          {requestingLoc ? '请求中…' : locationGranted ? '已授权 ✓' : '授权位置'}
        </button>
      </div>

      {/* Memory stats */}
      <div className="nesio-settings-info-row">
        <div>
          <p className="nesio-settings-option-label">Memory 记录</p>
          <p className="nesio-settings-option-hint">存储在本设备 localStorage</p>
        </div>
        <span className="nesio-settings-badge">{nodeCount} 条</span>
      </div>

      {/* Cloud sync */}
      <div className="nesio-settings-info-row">
        <div>
          <p className="nesio-settings-option-label">云端同步</p>
          <p className="nesio-settings-option-hint">登录后才会开启跨设备同步</p>
        </div>
        <a href="/login" className="nesio-settings-toggle-btn">登录启用</a>
      </div>

      {/* Export */}
      <button type="button" className="nesio-settings-action-btn" onClick={() => {
        const data = JSON.stringify(getLifeGraph(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'nesio-memory.json'; a.click();
      }}>
        导出 Memory 数据（JSON）
      </button>

      <button type="button" className="nesio-settings-action-btn" onClick={exportFullBackup}>
        导出完整备份（含项目/情绪/设置等全部本地数据）
      </button>

      <button type="button" className="nesio-settings-action-btn" onClick={() => importRef.current?.click()}>
        导入备份
      </button>
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={handleImportFile} />
      {restoreMsg && <p style={{ fontSize: '0.75rem', marginTop: 4, color: restoreMsg.startsWith('✓') ? 'var(--status-go)' : 'var(--status-risk)' }}>{restoreMsg}</p>}

      <button type="button" className="nesio-settings-danger-btn" onClick={clearAllMemory}>
        {deleted ? '✓ 已清除' : '清除所有 Memory'}
      </button>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.5rem' }}>实验功能</p>
      <button type="button"
        className={`nesio-settings-option${labOn ? ' nesio-settings-option--active' : ''}`}
        onClick={toggleLab}>
        <div>
          <span className="nesio-settings-option-label">Lab 模式 {labOn ? '· 已开启' : ''}</span>
          <span className="nesio-settings-option-hint">
            {labOn
              ? '实验工具和预览功能已解锁。关闭后回到公开版。'
              : '解锁实验工具和预览功能。之前需要 ?baohePersonal=1 参数,现在点这里就行。'}
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
  { id: 'pro', name: 'Nesio Pro', price: '¥18', cycle: '/ 月', desc: '跨设备同步 · 主动提醒 · AI 洞察报告' },
  { id: 'family', name: '家庭版', price: '¥38', cycle: '/ 月', desc: '最多 5 人共享 · 家人动态 · 自动化动作' },
];

export function SubscriptionSheet({ open, onClose }: SheetProps) {
  const locale = usePortalLocale();
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
            <p className="nesio-sub-upgrade-name">{plan.name}</p>
            <p className="nesio-sub-upgrade-desc">{plan.desc}</p>
          </div>
          <div className="nesio-sub-upgrade-right">
            <p className="nesio-sub-upgrade-price">{plan.price}<span>{plan.cycle}</span></p>
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
