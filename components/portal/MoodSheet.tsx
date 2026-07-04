'use client';

/**
 * MoodSheet — Moment Capture（留住这一刻）
 *
 * 设计原则（来自 lib/portal/moment-capture.md）：
 * - 不是情绪记录，而是 Moment Capture — 情绪只是此刻的一个维度
 * - 5 秒完成 Level 1 记录，所有层级可选
 * - 12 情绪基于 Russell 环状模型（效价 × 唤醒 4象限，每象限 3 个）
 * - Energy 维度：水平拖动把手，位置→颜色（蓝→紫→金），内感受唤醒度
 * - 滑动选择（touchmove），不需要点击保存按钮
 * - 长按转盘中心 500ms → 直接进入 Journal
 * - Level 3 可展开为 Journal
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

// ── 12-Emotion taxonomy (Russell Circumplex 4 quadrants × 3) ─────────────────
const EMOTIONS = [
  { id: 'joy',        label: '开心', emoji: '😄', color: 'var(--emotion-joy)', quadrant: 'hv-ha' },
  { id: 'excited',    label: '兴奋', emoji: '🤩', color: 'var(--emotion-excited)', quadrant: 'hv-ha' },
  { id: 'moved',      label: '感动', emoji: '🥰', color: 'var(--emotion-moved)', quadrant: 'hv-ha' },
  { id: 'calm',       label: '平静', emoji: '😌', color: 'var(--emotion-calm)', quadrant: 'hv-la' },
  { id: 'content',    label: '满足', emoji: '😊', color: 'var(--emotion-content)', quadrant: 'hv-la' },
  { id: 'grateful',   label: '感激', emoji: '🤗', color: 'var(--emotion-grateful)', quadrant: 'hv-la' },
  { id: 'tired',      label: '疲惫', emoji: '😪', color: 'var(--emotion-tired)', quadrant: 'lv-la' },
  { id: 'empty',      label: '空洞', emoji: '😶', color: 'var(--emotion-empty)', quadrant: 'lv-la' },
  { id: 'sad',        label: '难过', emoji: '😢', color: 'var(--emotion-sad)', quadrant: 'lv-la' },
  { id: 'anxious',    label: '焦虑', emoji: '😰', color: 'var(--emotion-anxious)', quadrant: 'lv-ha' },
  { id: 'frustrated', label: '烦躁', emoji: '😤', color: 'var(--emotion-frustrated)', quadrant: 'lv-ha' },
  { id: 'angry',      label: '生气', emoji: '😠', color: 'var(--emotion-angry)', quadrant: 'lv-ha' },
] as const;

type EmotionId = typeof EMOTIONS[number]['id'];
type EnergyLevel = 'high' | 'mid' | 'low';

// ── SVG geometry ──────────────────────────────────────────────────────────────
const N = EMOTIONS.length;
const CX = 150, CY = 150;
const R_IN = 52, R_OUT = 120;
const R_LABEL = 82, R_EMOJI = 132;
const GAP = 1.5;

function rad(d: number) { return (d * Math.PI) / 180; }

function sliceAngles(i: number): [number, number] {
  const step = 360 / N;
  return [rad(i * step + GAP - 90), rad((i + 1) * step - GAP - 90)];
}

function sectorPath(i: number): string {
  const [s, e] = sliceAngles(i);
  const x1 = CX + R_OUT * Math.cos(s), y1 = CY + R_OUT * Math.sin(s);
  const x2 = CX + R_OUT * Math.cos(e), y2 = CY + R_OUT * Math.sin(e);
  const x3 = CX + R_IN  * Math.cos(e), y3 = CY + R_IN  * Math.sin(e);
  const x4 = CX + R_IN  * Math.cos(s), y4 = CY + R_IN  * Math.sin(s);
  return `M${x1} ${y1} A${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${R_IN} ${R_IN} 0 0 0 ${x4} ${y4}Z`;
}

function midAngle(i: number): number { return ((i + 0.5) * 360) / N - 90; }

function labelPos(i: number): [number, number] {
  const a = rad(midAngle(i));
  return [CX + R_LABEL * Math.cos(a), CY + R_LABEL * Math.sin(a)];
}

function emojiPos(i: number): [number, number] {
  const a = rad(midAngle(i));
  return [CX + R_EMOJI * Math.cos(a), CY + R_EMOJI * Math.sin(a)];
}

function sectorAtPoint(svgX: number, svgY: number): number | null {
  const dx = svgX - CX, dy = svgY - CY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < R_IN - 4 || dist > R_OUT + 8) return null;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (angle < 0) angle += 360;
  return Math.floor(angle / (360 / N)) % N;
}

function isCenterHit(svgX: number, svgY: number): boolean {
  const dx = svgX - CX, dy = svgY - CY;
  return Math.sqrt(dx * dx + dy * dy) < R_IN - 4;
}

// ── Energy: value 0–100, derive level and color ───────────────────────────────
function energyLevel(v: number): EnergyLevel {
  if (v >= 67) return 'high';
  if (v >= 34) return 'mid';
  return 'low';
}

function energyColor(v: number): string {
  const blue = [144, 202, 249], purp = [139, 92, 246], gold = [255, 209, 102];
  const lerp = (a: number[], b: number[], t: number) =>
    a.map((c, i) => Math.round(c + (b[i] - c) * t));
  const [r, g, b] = v <= 50 ? lerp(blue, purp, v / 50) : lerp(purp, gold, (v - 50) / 50);
  return `rgb(${r},${g},${b})`;
}

function energyLabel(v: number): string {
  if (v >= 67) return '⚡ 充沛';
  if (v >= 34) return '~ 一般';
  return '😴 没电';
}

// ── Rotating prompts ──────────────────────────────────────────────────────────
const THOUGHT_PROMPTS = [
  '今天最开心的一件事？', '今天最感谢什么？', '今天什么最消耗你？',
  '此刻你想对自己说什么？', '今天发现了什么？', '一句话描述此刻。', '今天最让你意外的是？',
];

const JOURNAL_PROMPTS = [
  '今天你注意到什么？', '此刻身体感觉如何？', '最近什么让你感到充实？',
  '现在你最需要的是什么？', '今天什么值得记住？', '如果此刻可以对未来的自己说一句话…',
];

function todayPrompt(list: string[]): string {
  return list[new Date().getDate() % list.length];
}

// ── Context auto-fill ─────────────────────────────────────────────────────────
function autoContext(): Record<string, string | boolean | number> {
  const now = new Date();
  const hour = now.getHours();
  return {
    recordedAt: now.toISOString(),
    hourOfDay: hour,
    isWorkHours: hour >= 9 && hour < 18 && now.getDay() >= 1 && now.getDay() <= 5,
    isEvening: hour >= 21,
    isMorning: hour >= 6 && hour < 10,
    dayOfWeek: now.getDay(),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MoodSheetProps { open: boolean; onClose: () => void; }

type Phase = 'wheel' | 'energy' | 'thought' | 'journal' | 'saved';

export default function MoodSheet({ open, onClose }: MoodSheetProps) {
  const [phase, setPhase] = useState<Phase>('wheel');
  const [selected, setSelected] = useState<EmotionId | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [energyVal, setEnergyVal] = useState(50);
  const [thought, setThought] = useState('');
  const [journal, setJournal] = useState('');
  const [longPressing, setLongPressing] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const thoughtRef = useRef<HTMLInputElement>(null);
  const journalRef = useRef<HTMLTextAreaElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingSlider = useRef(false);
  const thoughtPromptRef = useRef(todayPrompt(THOUGHT_PROMPTS));
  const journalPromptRef = useRef(todayPrompt(JOURNAL_PROMPTS));

  useEffect(() => {
    if (open) {
      setPhase('wheel'); setSelected(null); setHovered(null);
      setEnergyVal(50); setThought(''); setJournal(''); setLongPressing(false);
      thoughtPromptRef.current = todayPrompt(THOUGHT_PROMPTS);
      journalPromptRef.current = todayPrompt(JOURNAL_PROMPTS);
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      if (longPressRef.current) clearTimeout(longPressRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (phase === 'thought') {
      thoughtRef.current?.focus();
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      autoCloseRef.current = setTimeout(() => handleSave(), 4000);
    }
    if (phase === 'journal') {
      setTimeout(() => journalRef.current?.focus(), 80);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancelAutoClose() {
    if (autoCloseRef.current) { clearTimeout(autoCloseRef.current); autoCloseRef.current = null; }
  }

  const handleSave = useCallback((opts?: { isJournal?: boolean }) => {
    cancelAutoClose();
    const em = selected ? EMOTIONS.find((e) => e.id === selected) : null;
    const lvl = energyLevel(energyVal);
    const isJournalEntry = opts?.isJournal ?? (phase === 'journal');

    if (isJournalEntry) {
      const dateStr = new Date().toISOString().slice(0, 10);
      addLifeNode({
        name: `Journal · ${dateStr}${em ? ` · ${em.emoji}${em.label}` : ''}`,
        type: 'health_state',
        tags: ['moment', 'journal', ...(em ? ['feeling', em.id, em.quadrant] : []), `energy-${lvl}`],
        attributes: {
          isJournal: true, journalText: journal.trim(),
          ...(em ? { emotion: em.id, emotionLabel: em.label, emotionEmoji: em.emoji, emotionQuadrant: em.quadrant } : {}),
          energyValue: energyVal, energyLevel: lvl, ...autoContext(),
        },
        rawInput: `Journal ${em ? em.emoji + em.label : ''} ${journal.slice(0, 40)}`,
        confidence: 1, source: 'manual', relations: [],
      });
    } else if (em) {
      addLifeNode({
        name: `此刻 · ${em.emoji} ${em.label}`,
        type: 'health_state',
        tags: ['moment', 'feeling', em.id, em.quadrant, `energy-${lvl}`],
        attributes: {
          emotion: em.id, emotionLabel: em.label, emotionEmoji: em.emoji,
          emotionQuadrant: em.quadrant, energyValue: energyVal, energyLevel: lvl,
          ...(thought.trim() ? { thought: thought.trim() } : {}), ...autoContext(),
        },
        rawInput: `此刻 ${em.emoji}${em.label} ⚡${lvl}${thought.trim() ? ` · ${thought.trim()}` : ''}`,
        confidence: 1, source: 'manual', relations: [],
      });
    } else { onClose(); return; }

    setPhase('saved');
    setTimeout(() => onClose(), 1600);
  }, [selected, energyVal, thought, journal, phase, onClose]);

  function pickEmotion(idx: number) { setSelected(EMOTIONS[idx].id); setPhase('energy'); }

  function svgCoords(e: React.MouseEvent | React.TouchEvent): [number, number] | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0) : e.clientX;
    const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0) : e.clientY;
    return [(clientX - rect.left) * (300 / rect.width), (clientY - rect.top) * (300 / rect.height)];
  }

  function onSvgMove(e: React.MouseEvent | React.TouchEvent) {
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    setHovered(sectorAtPoint(coords[0], coords[1]));
  }

  function onSvgEnd(e: React.MouseEvent | React.TouchEvent) {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    setLongPressing(false);
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    if (isCenterHit(coords[0], coords[1])) return;
    const idx = sectorAtPoint(coords[0], coords[1]);
    if (idx !== null) pickEmotion(idx);
    setHovered(null);
  }

  function onSvgStart(e: React.MouseEvent | React.TouchEvent) {
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    if (isCenterHit(coords[0], coords[1])) {
      longPressRef.current = setTimeout(() => {
        setLongPressing(false);
        setPhase('journal');
        try { navigator.vibrate?.(60); } catch { /* ignore */ }
      }, 500);
      setLongPressing(true);
    }
  }

  function onSvgLeave() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    setLongPressing(false);
    setHovered(null);
  }

  function sliderPct(clientX: number): number {
    const el = sliderRef.current;
    if (!el) return 50;
    const r = el.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100);
  }

  function onSliderStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isDraggingSlider.current = true;
    setEnergyVal(sliderPct('touches' in e ? e.touches[0].clientX : e.clientX));
  }

  useEffect(() => {
    if (phase !== 'energy') return;
    function onMove(e: MouseEvent | TouchEvent) {
      if (!isDraggingSlider.current) return;
      setEnergyVal(sliderPct('touches' in e ? e.touches[0].clientX : e.clientX));
    }
    function onUp() { isDraggingSlider.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  if (phase === 'saved') {
    const em = selected ? EMOTIONS.find((e) => e.id === selected) : null;
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal>
        <div className="nesio-mood-backdrop" onClick={onClose} />
        <div className="nesio-mood-card nesio-mood-card--saved">
          <div className="nesio-mood-saved-emoji">{em?.emoji ?? '✍️'}</div>
          <p className="nesio-mood-saved-text">留住了这一刻</p>
          <p className="nesio-mood-saved-hint">会和你其他的记忆慢慢连起来</p>
        </div>
      </div>
    );
  }

  const hoveredEm = hovered !== null ? EMOTIONS[hovered] : null;
  const selectedEm = selected ? EMOTIONS.find((e) => e.id === selected) : null;
  const eColor = energyColor(energyVal);

  if (phase === 'journal') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="Journal">
        <div className="nesio-mood-backdrop" onClick={() => handleSave({ isJournal: true })} />
        <div className="nesio-mood-card nesio-mood-card--journal">
          <div className="nesio-mood-handle" aria-hidden />
          <div className="nesio-mood-journal-header">
            <span className="nesio-mood-journal-meta">
              {selectedEm ? `${selectedEm.emoji} ${selectedEm.label}` : '✍️ Journal'}
            </span>
            <span className="nesio-mood-journal-date">
              {new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
          <p className="nesio-mood-journal-prompt">{journalPromptRef.current}</p>
          <textarea ref={journalRef} className="nesio-mood-journal-textarea"
            placeholder="写下此刻…" value={journal}
            onChange={(e) => setJournal(e.target.value)} rows={7} />
          <button type="button" className="nesio-mood-save-btn nesio-mood-save-btn--ready"
            onClick={() => handleSave({ isJournal: true })}>💾 保存这一刻</button>
        </div>
      </div>
    );
  }

  if (phase === 'energy') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="记录精力">
        <div className="nesio-mood-backdrop" onClick={() => handleSave()} />
        <div className="nesio-mood-card">
          <div className="nesio-mood-handle" aria-hidden />
          <p className="nesio-mood-title">{selectedEm?.emoji} {selectedEm?.label} · 现在精力怎么样？</p>
          <div className="nesio-mood-slider-wrap">
            <div className="nesio-mood-slider-labels">
              <span>😴 没电</span><span>⚡ 充沛</span>
            </div>
            <div ref={sliderRef} className="nesio-mood-slider-track"
              onMouseDown={onSliderStart} onTouchStart={onSliderStart}>
              <div className="nesio-mood-slider-fill"
                style={{ width: `${energyVal}%`, backgroundColor: eColor }} />
              <div className="nesio-mood-slider-thumb"
                style={{ left: `${energyVal}%`, backgroundColor: eColor, boxShadow: `0 0 0 4px ${eColor}33` }}
                role="slider" aria-valuenow={energyVal} aria-valuemin={0} aria-valuemax={100} />
            </div>
            <p className="nesio-mood-slider-label" style={{ color: eColor }}>{energyLabel(energyVal)}</p>
          </div>
          <div className="nesio-mood-energy-actions">
            <button type="button" className="nesio-mood-save-btn nesio-mood-save-btn--ready"
              onClick={() => setPhase('thought')}>再说一句 →</button>
            <button type="button" className="nesio-mood-skip-btn"
              onClick={() => handleSave()}>留住这一刻</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'thought') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="记录此刻想法">
        <div className="nesio-mood-backdrop" onClick={() => handleSave()} />
        <div className="nesio-mood-card">
          <div className="nesio-mood-handle" aria-hidden />
          <p className="nesio-mood-title">{selectedEm?.emoji} {thoughtPromptRef.current}</p>
          <input ref={thoughtRef} type="text" className="nesio-mood-note nesio-mood-note--large"
            placeholder="一句话也好…" value={thought}
            onChange={(e) => { setThought(e.target.value); cancelAutoClose(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }} maxLength={80} />
          <p className="nesio-mood-auto-hint">4 秒无输入自动保存</p>
          <div className="nesio-mood-thought-actions">
            <button type="button" className="nesio-mood-save-btn nesio-mood-save-btn--ready"
              onClick={() => handleSave()}>留住这一刻</button>
            <button type="button" className="nesio-mood-journal-btn"
              onClick={() => { cancelAutoClose(); setPhase('journal'); }}>✍️ 展开为 Journal</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="记录此刻感受">
      <div className="nesio-mood-backdrop" onClick={onClose} />
      <div className="nesio-mood-card">
        <div className="nesio-mood-handle" aria-hidden />
        <p className="nesio-mood-title">
          {hoveredEm ? `${hoveredEm.emoji} ${hoveredEm.label}` : '此刻，是什么感觉？'}
        </p>
        <div className="nesio-mood-wheel-wrap">
          <svg ref={svgRef} viewBox="0 0 300 300" className="nesio-mood-wheel-svg"
            role="group" aria-label="情绪转盘"
            onMouseDown={onSvgStart} onMouseMove={onSvgMove} onMouseUp={onSvgEnd} onMouseLeave={onSvgLeave}
            onTouchStart={(e) => { onSvgStart(e); }}
            onTouchMove={(e) => { e.preventDefault(); onSvgMove(e); }}
            onTouchEnd={(e) => { e.preventDefault(); onSvgEnd(e); }}
            style={{ touchAction: 'none' }}>
            {EMOTIONS.map((em, i) => {
              const isHov = hovered === i;
              const [lx, ly] = labelPos(i);
              const [ex, ey] = emojiPos(i);
              return (
                <g key={em.id} role="button" aria-label={em.label} tabIndex={0}
                  onClick={() => pickEmotion(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') pickEmotion(i); }}
                  style={{ cursor: 'pointer' }}>
                  <path d={sectorPath(i)} fill={em.color} opacity={isHov ? 1 : 0.7}
                    stroke="white" strokeWidth="2" style={{ transition: 'opacity 0.1s' }} />
                  {isHov && <path d={sectorPath(i)} fill="none" stroke={em.color}
                    strokeWidth="5" opacity="0.4" style={{ filter: 'blur(4px)' }} />}
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8.5" fontWeight={isHov ? '800' : '600'}
                    fill={isHov ? '#fff' : 'rgba(20,30,60,0.72)'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>{em.label}</text>
                  <text x={ex} y={ey} textAnchor="middle" dominantBaseline="middle"
                    fontSize={isHov ? '24' : '19'}
                    style={{ pointerEvents: 'none', userSelect: 'none', transition: 'font-size 0.1s' }}>{em.emoji}</text>
                </g>
              );
            })}
            <circle cx={CX} cy={CY} r={R_IN - 3}
              fill={longPressing ? 'var(--portal-accent-soft)' : 'white'}
              style={{ cursor: 'pointer', transition: 'fill 0.3s' }} />
            <text x={CX} y={CY - 7} textAnchor="middle" fontSize="10"
              fill={longPressing ? 'var(--portal-cool-accent)' : 'var(--portal-muted)'} fontWeight="600"
              style={{ userSelect: 'none', pointerEvents: 'none' }}>
              {longPressing ? '放开写 Journal' : '此刻'}
            </text>
            <text x={CX} y={CY + 8} textAnchor="middle" fontSize="8.5" fill="var(--portal-muted)"
              style={{ userSelect: 'none', pointerEvents: 'none' }}>
              {longPressing ? '✍️' : '滑动选择'}
            </text>
          </svg>
        </div>
        <p className="nesio-mood-hint-text">滑过一种感觉，松手即记录 · 长按中心写 Journal</p>
      </div>
    </div>
  );
}
