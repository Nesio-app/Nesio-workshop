'use client';

/**
 * MoodSheet — Moment Capture（留住这一刻）
 *
 * 设计原则（来自 docs/design/moment-capture.md）：
 * - 不是情绪记录，而是 Moment Capture — 情绪只是此刻的一个维度
 * - 5 秒完成 Level 1 记录，所有层级可选
 * - 12 情绪基于 Russell 环状模型（效价 × 唤醒 4象限，每象限 3 个）
 * - Energy 维度独立：身体内感受，比情绪标签更原始
 * - 滑动选择（touchmove），不需要点击保存按钮
 * - 3s 无输入自动关闭思考层
 *
 * 情绪权威依据：Russell (1980) Circumplex + Ekman (1972) 基础情绪 + 日常高频状态
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

// ── 12-Emotion taxonomy (Russell Circumplex 4 quadrants × 3) ─────────────────
// 顺序从"正向高能"开始顺时针，映射到 SVG 从-90°顺时针

const EMOTIONS = [
  // 正向高能 (High Valence, High Arousal) — 暖金
  { id: 'joy',        label: '开心', emoji: '😄', color: '#FFD166', quadrant: 'hv-ha' },
  { id: 'excited',    label: '兴奋', emoji: '🤩', color: '#FFB347', quadrant: 'hv-ha' },
  { id: 'moved',      label: '感动', emoji: '🥰', color: '#FF8FAB', quadrant: 'hv-ha' },
  // 正向低能 (High Valence, Low Arousal) — 柔绿
  { id: 'calm',       label: '平静', emoji: '😌', color: '#74C69D', quadrant: 'hv-la' },
  { id: 'content',    label: '满足', emoji: '😊', color: '#52B788', quadrant: 'hv-la' },
  { id: 'grateful',   label: '感激', emoji: '🤗', color: '#95D5B2', quadrant: 'hv-la' },
  // 负向低能 (Low Valence, Low Arousal) — 冷蓝
  { id: 'tired',      label: '疲惫', emoji: '😪', color: '#90CAF9', quadrant: 'lv-la' },
  { id: 'empty',      label: '空洞', emoji: '😶', color: '#B0C4DE', quadrant: 'lv-la' },
  { id: 'sad',        label: '难过', emoji: '😢', color: '#7B9CCC', quadrant: 'lv-la' },
  // 负向高能 (Low Valence, High Arousal) — 暖橙紫
  { id: 'anxious',    label: '焦虑', emoji: '😰', color: '#CE93D8', quadrant: 'lv-ha' },
  { id: 'frustrated', label: '烦躁', emoji: '😤', color: '#FF8A65', quadrant: 'lv-ha' },
  { id: 'angry',      label: '生气', emoji: '😠', color: '#EF5350', quadrant: 'lv-ha' },
] as const;

type EmotionId = typeof EMOTIONS[number]['id'];
type EnergyLevel = 'high' | 'mid' | 'low';

// ── SVG geometry ──────────────────────────────────────────────────────────────
const N = EMOTIONS.length;           // 12
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

function midAngle(i: number): number {
  return ((i + 0.5) * 360) / N - 90;
}

function labelPos(i: number): [number, number] {
  const a = rad(midAngle(i));
  return [CX + R_LABEL * Math.cos(a), CY + R_LABEL * Math.sin(a)];
}

function emojiPos(i: number): [number, number] {
  const a = rad(midAngle(i));
  return [CX + R_EMOJI * Math.cos(a), CY + R_EMOJI * Math.sin(a)];
}

// Hit-test: which sector does a point fall into?
function sectorAtPoint(svgX: number, svgY: number): number | null {
  const dx = svgX - CX, dy = svgY - CY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < R_IN - 4 || dist > R_OUT + 8) return null;

  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // 0 = top
  if (angle < 0) angle += 360;
  const step = 360 / N;
  return Math.floor(angle / step) % N;
}

// ── Thought prompts (rotating) ────────────────────────────────────────────────
const PROMPTS = [
  '今天最开心的一件事？',
  '今天最感谢什么？',
  '今天什么最消耗你？',
  '此刻你想对自己说什么？',
  '今天发现了什么？',
  '一句话描述此刻。',
  '今天最让你意外的是？',
];

function todayPrompt(): string {
  const idx = new Date().getDate() % PROMPTS.length;
  return PROMPTS[idx];
}

// ── Context auto-fill ─────────────────────────────────────────────────────────
function autoContext(): Record<string, string | boolean | number> {
  const now = new Date();
  const hour = now.getHours();
  const isWorkHours = hour >= 9 && hour < 18 && now.getDay() >= 1 && now.getDay() <= 5;
  const isEvening = hour >= 21;
  const isMorning = hour >= 6 && hour < 10;
  return {
    recordedAt: now.toISOString(),
    hourOfDay: hour,
    isWorkHours,
    isEvening,
    isMorning,
    dayOfWeek: now.getDay(),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MoodSheetProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'wheel' | 'energy' | 'thought' | 'saved';

export default function MoodSheet({ open, onClose }: MoodSheetProps) {
  const [phase, setPhase] = useState<Phase>('wheel');
  const [selected, setSelected] = useState<EmotionId | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [energy, setEnergy] = useState<EnergyLevel>('mid');
  const [thought, setThought] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const thoughtRef = useRef<HTMLInputElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptRef = useRef(todayPrompt());

  // Reset on open
  useEffect(() => {
    if (open) {
      setPhase('wheel');
      setSelected(null);
      setHovered(null);
      setEnergy('mid');
      setThought('');
      promptRef.current = todayPrompt();
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, [open]);

  // Auto-focus thought input when entering thought phase
  useEffect(() => {
    if (phase === 'thought') {
      thoughtRef.current?.focus();
      // Auto-close after 4s of inactivity
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      autoCloseRef.current = setTimeout(() => {
        handleSave();
      }, 4000);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancelAutoClose() {
    if (autoCloseRef.current) { clearTimeout(autoCloseRef.current); autoCloseRef.current = null; }
  }

  // ── Save to life-graph ────────────────────────────────────────────────────
  const handleSave = useCallback((overrideThought?: string) => {
    cancelAutoClose();
    if (!selected) return;
    const em = EMOTIONS.find((e) => e.id === selected);
    if (!em) return;

    const ctx = autoContext();
    const finalThought = overrideThought ?? thought;

    addLifeNode({
      name: `此刻 · ${em.emoji} ${em.label}`,
      type: 'health_state',
      tags: ['moment', 'feeling', em.id, em.quadrant, `energy-${energy}`],
      attributes: {
        emotion: em.id,
        emotionLabel: em.label,
        emotionEmoji: em.emoji,
        emotionQuadrant: em.quadrant,
        energy,
        ...(finalThought.trim() ? { thought: finalThought.trim() } : {}),
        ...ctx,
      },
      rawInput: `此刻 ${em.emoji}${em.label} ⚡${energy}${finalThought.trim() ? ` · ${finalThought.trim()}` : ''}`,
      confidence: 1,
      source: 'manual',
      relations: [],
    });

    setPhase('saved');
    setTimeout(() => onClose(), 1600);
  }, [selected, energy, thought, onClose]);

  // ── Wheel: pick emotion ───────────────────────────────────────────────────
  function pickEmotion(idx: number) {
    const em = EMOTIONS[idx];
    setSelected(em.id);
    setPhase('energy');
  }

  // ── SVG touch/mouse hit-test ──────────────────────────────────────────────
  function svgCoords(e: React.MouseEvent | React.TouchEvent): [number, number] | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e
      ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0)
      : e.clientX;
    const clientY = 'touches' in e
      ? (e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0)
      : e.clientY;
    const scaleX = 300 / rect.width;
    const scaleY = 300 / rect.height;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
  }

  function onSvgMove(e: React.MouseEvent | React.TouchEvent) {
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    const idx = sectorAtPoint(coords[0], coords[1]);
    setHovered(idx);
  }

  function onSvgEnd(e: React.MouseEvent | React.TouchEvent) {
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    const idx = sectorAtPoint(coords[0], coords[1]);
    if (idx !== null) pickEmotion(idx);
    setHovered(null);
  }

  function onSvgLeave() {
    setHovered(null);
  }

  if (!open) return null;

  // ── Saved state ───────────────────────────────────────────────────────────
  if (phase === 'saved') {
    const em = EMOTIONS.find((e) => e.id === selected);
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal>
        <div className="nesio-mood-backdrop" onClick={onClose} />
        <div className="nesio-mood-card nesio-mood-card--saved">
          <div className="nesio-mood-saved-emoji">{em?.emoji ?? '🌟'}</div>
          <p className="nesio-mood-saved-text">留住了这一刻</p>
          <p className="nesio-mood-saved-hint">会和你其他的记忆慢慢连起来</p>
        </div>
      </div>
    );
  }

  const hoveredEm = hovered !== null ? EMOTIONS[hovered] : null;
  const selectedEm = selected ? EMOTIONS.find((e) => e.id === selected) : null;

  // ── Energy phase ──────────────────────────────────────────────────────────
  if (phase === 'energy') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="记录精力">
        <div className="nesio-mood-backdrop" onClick={() => handleSave()} />
        <div className="nesio-mood-card">
          <div className="nesio-mood-handle" aria-hidden />
          <p className="nesio-mood-title">
            {selectedEm?.emoji} {selectedEm?.label} · 精力怎么样？
          </p>

          <div className="nesio-mood-energy-row">
            {(['high', 'mid', 'low'] as EnergyLevel[]).map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`nesio-mood-energy-btn${energy === lvl ? ' nesio-mood-energy-btn--active' : ''}`}
                onClick={() => setEnergy(lvl)}
              >
                <span className="nesio-mood-energy-icon">
                  {lvl === 'high' ? '⚡⚡⚡' : lvl === 'mid' ? '⚡⚡' : '⚡'}
                </span>
                <span className="nesio-mood-energy-label">
                  {lvl === 'high' ? '充沛' : lvl === 'mid' ? '一般' : '没电'}
                </span>
              </button>
            ))}
          </div>

          <div className="nesio-mood-energy-actions">
            <button
              type="button"
              className="nesio-mood-save-btn nesio-mood-save-btn--ready"
              onClick={() => setPhase('thought')}
            >
              再说一句 →
            </button>
            <button
              type="button"
              className="nesio-mood-skip-btn"
              onClick={() => handleSave()}
            >
              留住这一刻
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Thought phase ─────────────────────────────────────────────────────────
  if (phase === 'thought') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="记录此刻想法">
        <div className="nesio-mood-backdrop" onClick={() => handleSave()} />
        <div className="nesio-mood-card">
          <div className="nesio-mood-handle" aria-hidden />
          <p className="nesio-mood-title">{selectedEm?.emoji} {promptRef.current}</p>
          <input
            ref={thoughtRef}
            type="text"
            className="nesio-mood-note nesio-mood-note--large"
            placeholder="一句话也好…"
            value={thought}
            onChange={(e) => { setThought(e.target.value); cancelAutoClose(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            maxLength={80}
          />
          <p className="nesio-mood-auto-hint">4 秒无输入自动保存</p>
          <button
            type="button"
            className="nesio-mood-save-btn nesio-mood-save-btn--ready"
            onClick={() => handleSave()}
          >
            留住这一刻
          </button>
        </div>
      </div>
    );
  }

  // ── Wheel phase ───────────────────────────────────────────────────────────
  return (
    <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="记录此刻感受">
      <div className="nesio-mood-backdrop" onClick={onClose} />
      <div className="nesio-mood-card">
        <div className="nesio-mood-handle" aria-hidden />

        <p className="nesio-mood-title">
          {hoveredEm ? `${hoveredEm.emoji} ${hoveredEm.label}` : '此刻，是什么感觉？'}
        </p>

        {/* SVG Wheel — touch/mouse interactive */}
        <div className="nesio-mood-wheel-wrap">
          <svg
            ref={svgRef}
            viewBox="0 0 300 300"
            className="nesio-mood-wheel-svg"
            role="group"
            aria-label="情绪转盘"
            onMouseMove={onSvgMove}
            onMouseUp={onSvgEnd}
            onMouseLeave={onSvgLeave}
            onTouchMove={(e) => { e.preventDefault(); onSvgMove(e); }}
            onTouchEnd={(e) => { e.preventDefault(); onSvgEnd(e); }}
            style={{ touchAction: 'none' }}
          >
            {EMOTIONS.map((em, i) => {
              const isHovered = hovered === i;
              const [lx, ly] = labelPos(i);
              const [ex, ey] = emojiPos(i);
              return (
                <g
                  key={em.id}
                  role="button"
                  aria-label={em.label}
                  tabIndex={0}
                  onClick={() => pickEmotion(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') pickEmotion(i); }}
                  style={{ cursor: 'pointer' }}
                >
                  <path
                    d={sectorPath(i)}
                    fill={em.color}
                    opacity={isHovered ? 1 : 0.7}
                    stroke="white"
                    strokeWidth="2"
                    style={{ transition: 'opacity 0.1s' }}
                  />
                  {isHovered && (
                    <path
                      d={sectorPath(i)}
                      fill="none"
                      stroke={em.color}
                      strokeWidth="5"
                      opacity="0.4"
                      style={{ filter: 'blur(4px)' }}
                    />
                  )}
                  <text
                    x={lx} y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8.5"
                    fontWeight={isHovered ? '800' : '600'}
                    fill={isHovered ? '#fff' : 'rgba(20,30,60,0.72)'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {em.label}
                  </text>
                  <text
                    x={ex} y={ey}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={isHovered ? '24' : '19'}
                    style={{ pointerEvents: 'none', userSelect: 'none', transition: 'font-size 0.1s' }}
                  >
                    {em.emoji}
                  </text>
                </g>
              );
            })}

            {/* Center */}
            <circle cx={CX} cy={CY} r={R_IN - 3} fill="white" />
            <text x={CX} y={CY - 7} textAnchor="middle" fontSize="10" fill="#8899bb" fontWeight="600" style={{ userSelect: 'none' }}>此刻</text>
            <text x={CX} y={CY + 8} textAnchor="middle" fontSize="8.5" fill="#aabbcc" style={{ userSelect: 'none' }}>滑动选择</text>
          </svg>
        </div>

        <p className="nesio-mood-hint-text">滑过一种感觉，松手即记录</p>
      </div>
    </div>
  );
}
