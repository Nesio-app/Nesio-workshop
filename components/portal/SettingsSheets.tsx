'use client';

/**
 * Settings sub-sheets: 语气与边界 / 隐私与数据 / 生活空间 / 订阅
 * Each is a slide-up bottom sheet opened from NesioProfileCard.
 */

import { useEffect, useState } from 'react';
import { loadProfileSettings, saveProfileSettings } from '@/lib/portal/profile';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { deleteLifeNode, getLifeGraph } from '@/lib/portal/life-graph';

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
const HAPTIC_FEEDBACK_KEY = 'nesio-haptic-feedback-enabled-v1';

export function ToneSheet({ open, onClose }: SheetProps) {
  const [tone, setTone] = useState<ToneStyle>('warm');
  const [interrupt, setInterrupt] = useState<InterruptLevel>('proactive');
  const [hapticsOn, setHapticsOn] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const p = loadProfileSettings();
      setTone((p.coachStyle as ToneStyle) || 'warm');
      const m = getMirrorProfile();
      setInterrupt(m.interruptionStyle);
      try {
        setHapticsOn(localStorage.getItem(HAPTIC_FEEDBACK_KEY) !== '0');
      } catch { /* ignore */ }
      setSaved(false);
    }
  }, [open]);

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

  useEffect(() => {
    if (!open) return;
    setDeleted(false);
    setNodeCount(getLifeGraph().length);
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

      <button type="button" className="nesio-settings-danger-btn" onClick={clearAllMemory}>
        {deleted ? '✓ 已清除' : '清除所有 Memory'}
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

// ── 早期体验 ──────────────────────────────────────────

export function SubscriptionSheet({ open, onClose }: SheetProps) {
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState('');

  function handleNotify() {
    if (!email.trim()) return;
    // Store locally; future: send to backend waitlist API
    try { localStorage.setItem('nesio-notify-email', email.trim()); } catch { /* ignore */ }
    setSubmitted(true);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="早期体验">
      <div className="nesio-sub-early-card">
        <div className="nesio-sub-early-badge">早期体验者</div>
        <p className="nesio-sub-early-title">全功能 · 免费使用中</p>
        <p className="nesio-sub-early-desc">
          你是最早一批使用 Nesio 的人。现阶段所有功能对你完全开放，不需要付费。
        </p>
      </div>

      <div className="nesio-sub-notify-section">
        <p className="nesio-settings-section-label">收费版开放时通知我</p>
        <p className="nesio-settings-option-hint" style={{ marginBottom: '0.75rem' }}>
          未来高级功能（跨设备同步、家庭共享等）开放时，我们会第一时间告诉你。
        </p>
        {submitted ? (
          <p style={{ color: 'var(--portal-accent)', fontWeight: 600, textAlign: 'center', padding: '0.75rem 0' }}>
            ✓ 已记录，我们会通知你
          </p>
        ) : (
          <div className="nesio-sub-notify-row">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="nesio-sub-notify-input"
            />
            <button type="button" className="nesio-sub-notify-btn" onClick={handleNotify}>
              通知我
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', textAlign: 'center', marginTop: '1.5rem' }}>
        v0.1 早期内测 · 你的反馈是最好的礼物
      </p>
    </SheetWrap>
  );
}
