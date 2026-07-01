'use client';

import { useEffect, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

interface MoodSheetProps {
  open: boolean;
  onClose: () => void;
}

const EMOTIONS = [
  { id: 'joy',        label: '开心', emoji: '😄', color: '#FFD166' },
  { id: 'trust',      label: '放松', emoji: '😌', color: '#74C69D' },
  { id: 'fear',       label: '害怕', emoji: '😰', color: '#4ECDC4' },
  { id: 'surprise',   label: '惊讶', emoji: '😲', color: '#48CAE4' },
  { id: 'sadness',    label: '难过', emoji: '😢', color: '#90CAF9' },
  { id: 'disgust',    label: '厌烦', emoji: '😒', color: '#CE93D8' },
  { id: 'anger',      label: '生气', emoji: '😠', color: '#FF8A65' },
  { id: 'anticipate', label: '期待', emoji: '🤩', color: '#FFB74D' },
];

const MAX_PICK = 3;
const CX = 150, CY = 150, R_IN = 58, R_OUT = 118, R_LABEL = 92, R_EMOJI = 138;
const GAP = 2.5;

function rad(d: number) { return (d * Math.PI) / 180; }

function sectorPath(i: number): string {
  const s = rad(i * 45 + GAP - 90);
  const e = rad((i + 1) * 45 - GAP - 90);
  const x1 = CX + R_OUT * Math.cos(s), y1 = CY + R_OUT * Math.sin(s);
  const x2 = CX + R_OUT * Math.cos(e), y2 = CY + R_OUT * Math.sin(e);
  const x3 = CX + R_IN  * Math.cos(e), y3 = CY + R_IN  * Math.sin(e);
  const x4 = CX + R_IN  * Math.cos(s), y4 = CY + R_IN  * Math.sin(s);
  return `M${x1} ${y1} A${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${R_IN} ${R_IN} 0 0 0 ${x4} ${y4}Z`;
}

function labelPos(i: number): [number, number] {
  const a = rad(i * 45 + 22.5 - 90);
  return [CX + R_LABEL * Math.cos(a), CY + R_LABEL * Math.sin(a)];
}

function emojiPos(i: number): [number, number] {
  const a = rad(i * 45 + 22.5 - 90);
  return [CX + R_EMOJI * Math.cos(a), CY + R_EMOJI * Math.sin(a)];
}

export default function MoodSheet({ open, onClose }: MoodSheetProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) { setSelected([]); setNote(''); setSaved(false); }
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((l) => l !== id);
      if (prev.length >= MAX_PICK) return prev;
      return [...prev, id];
    });
  }

  function save() {
    if (selected.length === 0) return;
    const picks = selected.map((id) => {
      const em = EMOTIONS.find((e) => e.id === id);
      return em ? `${em.emoji} ${em.label}` : id;
    });
    const nowStr = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    addLifeNode({
      name: `情绪 · ${nowStr}`,
      type: 'health_state',
      tags: ['mood', '情绪', ...selected],
      attributes: {
        mood: picks.join(' · '),
        ...(note.trim() ? { note: note.trim() } : {}),
        recordedAt: new Date().toISOString(),
      },
      rawInput: `情绪装盘: ${picks.join(', ')}${note.trim() ? ` — ${note.trim()}` : ''}`,
      confidence: 1,
      source: 'manual',
      relations: [],
    });
    setSaved(true);
    setTimeout(() => onClose(), 1400);
  }

  if (!open) return null;

  if (saved) {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal>
        <div className="nesio-mood-backdrop" onClick={onClose} />
        <div className="nesio-mood-card nesio-mood-card--saved">
          <div className="nesio-mood-saved-emoji">🌟</div>
          <p className="nesio-mood-saved-text">已记下这一刻</p>
          <p className="nesio-mood-saved-hint">会和你其他的记忆慢慢连起来</p>
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
          {selected.length === 0 ? '此刻感受' : selected.length < MAX_PICK ? `还可再选 ${MAX_PICK - selected.length} 个` : '再多就挤了'}
        </p>

        {/* SVG Wheel */}
        <div className="nesio-mood-wheel-wrap">
          <svg viewBox="0 0 300 300" className="nesio-mood-wheel-svg" role="group" aria-label="情绪转盘">
            {EMOTIONS.map((em, i) => {
              const on = selected.includes(em.id);
              const [lx, ly] = labelPos(i);
              const [ex, ey] = emojiPos(i);
              return (
                <g
                  key={em.id}
                  role="button"
                  aria-pressed={on}
                  aria-label={em.label}
                  tabIndex={0}
                  onClick={() => toggle(em.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(em.id); }}
                  style={{ cursor: 'pointer' }}
                >
                  <path
                    d={sectorPath(i)}
                    fill={em.color}
                    opacity={on ? 1 : 0.72}
                    stroke="white"
                    strokeWidth="2.5"
                    style={{ transition: 'opacity 0.15s' }}
                  />
                  {on && (
                    <path
                      d={sectorPath(i)}
                      fill="none"
                      stroke={em.color}
                      strokeWidth="4"
                      opacity="0.5"
                      style={{ filter: 'blur(3px)' }}
                    />
                  )}
                  <text
                    x={lx} y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="9.5"
                    fontWeight={on ? '800' : '600'}
                    fill={on ? '#fff' : 'rgba(20,30,60,0.75)'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {em.label}
                  </text>
                  <text
                    x={ex} y={ey}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="22"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {em.emoji}
                  </text>
                </g>
              );
            })}
            {/* Center */}
            <circle cx={CX} cy={CY} r={R_IN - 3} fill="white" />
            <text x={CX} y={CY - 7} textAnchor="middle" fontSize="10" fill="#8899bb" fontWeight="600" style={{ userSelect: 'none' }}>此刻</text>
            <text x={CX} y={CY + 9} textAnchor="middle" fontSize="9" fill="#aabbcc" style={{ userSelect: 'none' }}>感受</text>
          </svg>
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="nesio-mood-picks">
            {selected.map((id) => {
              const em = EMOTIONS.find((e) => e.id === id);
              return em ? (
                <span key={id} className="nesio-mood-pick-chip" style={{ background: em.color }}>
                  {em.emoji} {em.label}
                </span>
              ) : null;
            })}
          </div>
        )}

        <input
          type="text"
          className="nesio-mood-note"
          placeholder="一个词也好…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={30}
        />

        <button
          type="button"
          className={`nesio-mood-save-btn${selected.length > 0 ? ' nesio-mood-save-btn--ready' : ''}`}
          onClick={save}
          disabled={selected.length === 0}
        >
          {selected.length === 0
            ? '转盘点一个感受'
            : `记住这刻 · ${selected.map((id) => EMOTIONS.find((e) => e.id === id)?.emoji).join('')}`}
        </button>
      </div>
    </div>
  );
}
