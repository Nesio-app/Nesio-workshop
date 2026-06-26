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

export function ToneSheet({ open, onClose }: SheetProps) {
  const [tone, setTone] = useState<ToneStyle>('warm');
  const [interrupt, setInterrupt] = useState<InterruptLevel>('proactive');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const p = loadProfileSettings();
      setTone((p.coachStyle as ToneStyle) || 'warm');
      const m = getMirrorProfile();
      setInterrupt(m.interruptionStyle);
      setSaved(false);
    }
  }, [open]);

  function save() {
    saveProfileSettings({ coachStyle: tone as 'warm' | 'minimal' | 'professional' });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1000);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="语气与边界">
      <p className="nesio-settings-sheet-desc">设置 Nesio 跟你说话的方式，以及什么时候不打扰你。</p>

      <p className="nesio-settings-section-label">Nesio 的语气</p>
      {([
        { id: 'warm', label: '温暖', hint: '像朋友一样，多用「你」，语气轻柔' },
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

      <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>主动推送程度</p>
      {([
        { id: 'proactive', label: '主动', hint: '在合适时机主动推送 Moment' },
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
    if (!confirm('确认删除所有 Memory 记录？此操作不可撤销。')) return;
    const nodes = getLifeGraph();
    nodes.forEach((n) => deleteLifeNode(n.id));
    setNodeCount(0);
    setDeleted(true);
  }

  return (
    <SheetWrap open={open} onClose={onClose} title="隐私与数据">
      <p className="nesio-settings-sheet-desc">Nesio 记住了什么、存在哪、你随时可以删除。</p>

      {/* Location */}
      <div className="nesio-settings-info-row">
        <div>
          <p className="nesio-settings-option-label">地理位置</p>
          <p className="nesio-settings-option-hint">用于天气信号和本地 Moment 推荐</p>
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
          <p className="nesio-settings-option-hint">登录后自动加密同步到 Supabase</p>
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
  { id: 'home', icon: '🏠', label: '家', hint: '物品、储物间、家务' },
  { id: 'work', icon: '💼', label: '工作', hint: '会议、项目、待办' },
  { id: 'health', icon: '🩷', label: '健康', hint: '用药、运动、感冒恢复' },
  { id: 'family', icon: '👨‍👩‍👧', label: '家庭', hint: '礼物、生日、承诺' },
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
      <p className="nesio-settings-sheet-desc">选择你希望 Nesio 关注的生活场景，Today Feed 的卡片会按此过滤。</p>
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

// ── 订阅 ──────────────────────────────────────────────

export function SubscriptionSheet({ open, onClose }: SheetProps) {
  return (
    <SheetWrap open={open} onClose={onClose} title="订阅">
      <p className="nesio-settings-sheet-desc">Nesio 按能力层计费，不按功能模块。</p>

      {[
        { tier: 'Remember', price: '免费', color: '#6366f1', desc: '手动记忆、Today Feed、基础推荐', active: true },
        { tier: 'Understand', price: '¥18 / 月', color: '#3b82f6', desc: '跨场景推理、Calendar + 天气信号、Mirror Profile', active: false },
        { tier: 'Steer', price: '¥38 / 月', color: '#0ea5e9', desc: 'Future Steering、Gmail 接入、音频简报生成', active: false },
        { tier: 'Operate', price: '¥68 / 月', color: '#14b8a6', desc: '全自动 Life Graph、家庭共享、API 接入', active: false },
      ].map((plan) => (
        <div key={plan.tier} className={`nesio-sub-plan${plan.active ? ' nesio-sub-plan--active' : ''}`}>
          <div className="nesio-sub-plan-badge" style={{ background: plan.color }}>{plan.tier}</div>
          <div className="nesio-sub-plan-body">
            <p className="nesio-sub-plan-price">{plan.price}</p>
            <p className="nesio-sub-plan-desc">{plan.desc}</p>
          </div>
          {plan.active
            ? <span className="nesio-sub-plan-current">当前</span>
            : <button type="button" className="nesio-sub-plan-btn" onClick={() => alert('订阅功能即将开放，敬请期待。')}>升级</button>}
        </div>
      ))}

      <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', textAlign: 'center', marginTop: '1rem' }}>
        计费即将上线 · 目前全功能免费体验
      </p>
    </SheetWrap>
  );
}
