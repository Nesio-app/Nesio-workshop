'use client';

/**
 * Settings sub-sheets: 语气与边界 / 隐私与数据 / 生活空间 / 订阅
 * Each is a slide-up bottom sheet opened from NesioProfileCard.
 */

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings, saveProfileSettings } from '@/lib/portal/profile';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
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

export function ToneSheet({ open, onClose }: SheetProps) {
  const [tone, setTone] = useState<ToneStyle>('warm');
  const [interrupt, setInterrupt] = useState<InterruptLevel>('proactive');
  const [hapticsOn, setHapticsOn] = useState(true);
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const p = loadProfileSettings();
      setTone((p.coachStyle as ToneStyle) || 'warm');
      setLang(p.locale === 'en' ? 'en' : 'zh');
      const m = getMirrorProfile();
      setInterrupt(m.interruptionStyle);
      try {
        setHapticsOn(localStorage.getItem(HAPTIC_FEEDBACK_KEY) !== '0');
        const t = localStorage.getItem(THEME_KEY);
        setTheme(t === 'day' || t === 'night' ? t : 'auto');
      } catch { /* ignore */ }
      setSaved(false);
    }
  }, [open]);

  function pickTheme(next: ThemeChoice) {
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next); // instant preview, no save needed
  }

  function pickLang(next: 'zh' | 'en') {
    setLang(next);
    saveProfileSettings({ locale: next }); // dispatches PROFILE_UPDATED_EVENT — Portal re-renders
  }

  function save() {
    saveProfileSettings({ coachStyle: tone as 'warm' | 'minimal' | 'professional' });
    try {
      localStorage.setItem(HAPTIC_FEEDBACK_KEY, hapticsOn ? '1' : '0');
    } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1000);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="语气与边界">
      <p className="nesio-settings-sheet-desc">决定 Nesio 如何提醒你、什么时候保持安静。</p>

      <p className="nesio-settings-section-label">Nesio 的语气</p>
      {([
        { id: 'warm', label: '温暖', hint: '温和、自然，多用「你」' },
        { id: 'direct', label: '直接', hint: '简短、清楚，不解释太多' },
        { id: 'minimal', label: '极简', hint: '只说关键，越少越好' },
      ] as Array<{ id: ToneStyle; label: string; hint: string }>).map((opt) => (
        <button key={opt.id} type="button"
          className={`nesio-settings-option${tone === opt.id ? ' nesio-settings-option--active' : ''}`}
          onClick={() => setTone(opt.id)}>
          <div>
            <span className="nesio-settings-option-label">{opt.label}</span>
            <span className="nesio-settings-option-hint">{opt.hint}</span>
          </div>
          {tone === opt.id && <span className="nesio-settings-option-check">✓</span>}
        </button>
      ))}

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>主动提醒程度</p>
      {([
        { id: 'proactive', label: '主动提醒', hint: '在合适时机提醒你看一眼' },
        { id: 'minimal', label: '轻量', hint: '只推送高优先级建议' },
        { id: 'silent', label: '安静', hint: '只在你打开 App 时展示内容' },
      ] as Array<{ id: InterruptLevel; label: string; hint: string }>).map((opt) => (
        <button key={opt.id} type="button"
          className={`nesio-settings-option${interrupt === opt.id ? ' nesio-settings-option--active' : ''}`}
          onClick={() => setInterrupt(opt.id)}>
          <div>
            <span className="nesio-settings-option-label">{opt.label}</span>
            <span className="nesio-settings-option-hint">{opt.hint}</span>
          </div>
          {interrupt === opt.id && <span className="nesio-settings-option-check">✓</span>}
        </button>
      ))}

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>轻反馈</p>
      <button type="button"
        className={`nesio-settings-option${hapticsOn ? ' nesio-settings-option--active' : ''}`}
        onClick={() => setHapticsOn((v) => !v)}>
        <div>
          <span className="nesio-settings-option-label">触感反馈</span>
          <span className="nesio-settings-option-hint">记录成功、找到结果、长按录音时轻轻震一下</span>
        </div>
        <span className={`nesio-settings-space-check${hapticsOn ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
          {hapticsOn ? '✓' : '○'}
        </span>
      </button>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>外观</p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {([
          { id: 'day', label: '☀️ 日间' },
          { id: 'auto', label: '🌗 自动' },
          { id: 'night', label: '🌙 夜间' },
        ] as Array<{ id: ThemeChoice; label: string }>).map((opt) => (
          <button key={opt.id} type="button"
            className={`nesio-settings-option${theme === opt.id ? ' nesio-settings-option--active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => pickTheme(opt.id)}>
            <span className="nesio-settings-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
      <p className="nesio-settings-option-hint" style={{ marginTop: 4 }}>自动 = 跟随系统与时间（晚上 7 点后切夜间）</p>

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>语言 / Language</p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {([
          { id: 'zh', label: '简体中文' },
          { id: 'en', label: 'English' },
        ] as Array<{ id: 'zh' | 'en'; label: string }>).map((opt) => (
          <button key={opt.id} type="button"
            className={`nesio-settings-option${lang === opt.id ? ' nesio-settings-option--active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => pickLang(opt.id)}>
            <span className="nesio-settings-option-label">{opt.label}</span>
          </button>
        ))}
      </div>

      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1.5rem' }} onClick={save}>
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
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
    catch { setRestoreMsg('⚠️ 文件不是有效的 JSON'); return; }
    if (!isValidBackup(parsed)) { setRestoreMsg('⚠️ 不是有效的 Nesio 备份文件'); return; }

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
        <p style={{ fontSize: '0.72rem', fontWeight: 600, margin: '0 0 0.4rem', color: 'var(--portal-blue-deep)' }}>🔐 你的数据在哪里</p>
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
        ↓ 导出 Memory 数据（JSON）
      </button>

      <button type="button" className="nesio-settings-action-btn" onClick={exportFullBackup}>
        ⬇ 导出完整备份（含项目/情绪/设置等全部本地数据）
      </button>

      <button type="button" className="nesio-settings-action-btn" onClick={() => importRef.current?.click()}>
        ⬆ 导入备份
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

// ── 生活空间 ──────────────────────────────────────────

type SpaceId = 'home' | 'work' | 'health' | 'family';
const SPACES: Array<{ id: SpaceId; icon: string; label: string; hint: string }> = [
  { id: 'home', icon: '🏠', label: '住处与物品', hint: '物品、储物间、家务' },
  { id: 'work', icon: '💼', label: '工作与会议', hint: '会议、项目、待办' },
  { id: 'health', icon: '🩷', label: '身体与用药', hint: '用药、运动、感冒恢复' },
  { id: 'family', icon: '👨‍👩‍👧', label: '亲友与承诺', hint: '礼物、生日、承诺' },
];
const SPACES_KEY = 'nesio-active-spaces-v1';

export function SpacesSheet({ open, onClose }: SheetProps) {
  const [active, setActive] = useState<Set<SpaceId>>(new Set<SpaceId>(['home', 'work', 'health', 'family']));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(SPACES_KEY);
      if (raw) setActive(new Set<SpaceId>(JSON.parse(raw) as SpaceId[]));
    } catch { /* ignore */ }
    setSaved(false);
  }, [open]);

  function toggle(id: SpaceId) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  }

  function save() {
    try { localStorage.setItem(SPACES_KEY, JSON.stringify(Array.from(active))); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="生活空间">
      <p className="nesio-settings-sheet-desc">选中的生活空间，会优先出现在 Today。</p>
      {SPACES.map((sp) => (
        <button key={sp.id} type="button"
          className={`nesio-settings-option${active.has(sp.id) ? ' nesio-settings-option--active' : ''}`}
          onClick={() => toggle(sp.id)}>
          <span style={{ fontSize: '1.3rem' }}>{sp.icon}</span>
          <div style={{ flex: 1 }}>
            <span className="nesio-settings-option-label">{sp.label}</span>
            <span className="nesio-settings-option-hint">{sp.hint}</span>
          </div>
          <span className={`nesio-settings-space-check${active.has(sp.id) ? ' nesio-settings-space-check--on' : ''}`} aria-hidden>
            {active.has(sp.id) ? '✓' : '○'}
          </span>
        </button>
      ))}
      <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1.5rem' }} onClick={save}>
        {saved ? '✓ 已保存' : '保存'}
      </button>
    </SheetWrap>
  );
}

// ── 订阅 / 免费体验 ───────────────────────────────────

const TRIAL_KEY = 'nesio-trial-start-v1';
const TRIAL_DAYS = 7;

function getTrialState(): { started: boolean; daysLeft: number; expired: boolean } {
  if (typeof window === 'undefined') return { started: false, daysLeft: TRIAL_DAYS, expired: false };
  try {
    const raw = localStorage.getItem(TRIAL_KEY);
    if (!raw) return { started: false, daysLeft: TRIAL_DAYS, expired: false };
    const start = Number(raw);
    const elapsed = Math.floor((Date.now() - start) / 86400000);
    const daysLeft = Math.max(0, TRIAL_DAYS - elapsed);
    return { started: true, daysLeft, expired: daysLeft === 0 };
  } catch {
    return { started: false, daysLeft: TRIAL_DAYS, expired: false };
  }
}

function startTrial() {
  try { localStorage.setItem(TRIAL_KEY, String(Date.now())); } catch { /* ignore */ }
}

const PLANS = [
  {
    id: 'pro',
    name: 'Nesio Pro',
    price: '¥18',
    cycle: '/ 月',
    desc: '跨设备同步 · 主动提醒 · AI 洞察报告',
    highlight: false,
  },
  {
    id: 'family',
    name: '家庭版',
    price: '¥38',
    cycle: '/ 月',
    desc: '最多 5 人共享 · 家人动态 · 自动化动作',
    highlight: false,
  },
];

export function SubscriptionSheet({ open, onClose }: SheetProps) {
  const [trial, setTrial] = useState(() => getTrialState());
  const [upgradeTarget, setUpgradeTarget] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTrial(getTrialState());
  }, [open]);

  function handleStartTrial() {
    startTrial();
    setTrial(getTrialState());
  }

  function handleUpgrade(planId: string) {
    // TODO: replace with real Stripe checkout session URL or Apple IAP trigger
    // For web (PWA): POST /api/portal/stripe/create-session → redirect to checkout
    // For native iOS App Store: call StoreKit purchase(product) here
    setUpgradeTarget(planId);
    alert(`即将跳转付款 (${planId === 'pro' ? 'Nesio Pro ¥18/月' : '家庭版 ¥38/月'}).\n\n正式上线后通过 App Store 内购或网页支付完成。`);
    setUpgradeTarget(null);
  }

  const { started, daysLeft, expired } = trial;

  return (
    <SheetWrap open={open} onClose={onClose} title="我的计划">
      {/* Current plan status */}
      <div className="nesio-sub-status-card">
        {!started && (
          <>
            <div className="nesio-sub-status-badge nesio-sub-status-badge--free">免费版</div>
            <p className="nesio-sub-status-title">开始 7 天全功能体验</p>
            <p className="nesio-sub-status-desc">无需付款，到期后回到免费功能，不会自动扣费。</p>
            <button type="button" className="nesio-sub-start-btn" onClick={handleStartTrial}>
              开始免费体验 →
            </button>
          </>
        )}
        {started && !expired && (
          <>
            <div className="nesio-sub-status-badge nesio-sub-status-badge--trial">体验中</div>
            <p className="nesio-sub-status-title">还剩 {daysLeft} 天全功能体验</p>
            <div className="nesio-sub-trial-bar-track">
              <div className="nesio-sub-trial-bar-fill" style={{ width: `${((TRIAL_DAYS - daysLeft) / TRIAL_DAYS) * 100}%` }} />
            </div>
            <p className="nesio-sub-status-desc">体验结束前升级，所有记忆和设置完整保留。</p>
          </>
        )}
        {expired && (
          <>
            <div className="nesio-sub-status-badge nesio-sub-status-badge--expired">体验已结束</div>
            <p className="nesio-sub-status-title">升级继续使用完整功能</p>
            <p className="nesio-sub-status-desc">记忆和数据不会丢失，随时可以升级恢复。</p>
          </>
        )}
      </div>

      {/* Upgrade plans */}
      <p className="nesio-settings-section-label" style={{ marginTop: '1.1rem' }}>升级计划</p>
      {PLANS.map((plan) => (
        <div key={plan.id} className="nesio-sub-upgrade-row">
          <div className="nesio-sub-upgrade-info">
            <p className="nesio-sub-upgrade-name">{plan.name}</p>
            <p className="nesio-sub-upgrade-desc">{plan.desc}</p>
          </div>
          <div className="nesio-sub-upgrade-right">
            <p className="nesio-sub-upgrade-price">{plan.price}<span>{plan.cycle}</span></p>
            <button
              type="button"
              className="nesio-sub-upgrade-btn"
              onClick={() => handleUpgrade(plan.id)}
              disabled={upgradeTarget === plan.id}
            >
              升级
            </button>
          </div>
        </div>
      ))}

      <p style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
        通过 App Store 内购完成支付 · 可随时取消 · 不自动续费
      </p>
    </SheetWrap>
  );
}
