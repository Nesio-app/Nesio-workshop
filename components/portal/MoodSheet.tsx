'use client';

/**
 * MoodSheet — "情绪装盘"
 * Tap-to-compose your emotional state like plating a dish.
 * No forms. Pick 1-3 tokens, add an optional word, done.
 * Saves as a LifeNode so it connects to insights later.
 */

import { useEffect, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

interface MoodSheetProps {
  open: boolean;
  onClose: () => void;
}

interface MoodToken {
  emoji: string;
  label: string;
  group: 'up' | 'still' | 'down';
}

const MOODS: MoodToken[] = [
  // 高能 / up
  { emoji: '⚡', label: '亢奋', group: 'up' },
  { emoji: '🔥', label: '充能', group: 'up' },
  { emoji: '🎯', label: '专注', group: 'up' },
  { emoji: '🎵', label: '愉悦', group: 'up' },
  // 平静 / still
  { emoji: '🌊', label: '沉浸', group: 'still' },
  { emoji: '🌸', label: '轻盈', group: 'still' },
  { emoji: '🌤', label: '平静', group: 'still' },
  { emoji: '💭', label: '深思', group: 'still' },
  // 中性混合
  { emoji: '😌', label: '知足', group: 'still' },
  { emoji: '🌫', label: '迷茫', group: 'still' },
  { emoji: '🍂', label: '感伤', group: 'still' },
  { emoji: '🤝', label: '联结', group: 'still' },
  // 低能 / down
  { emoji: '😴', label: '困乏', group: 'down' },
  { emoji: '🌩', label: '焦虑', group: 'down' },
  { emoji: '💢', label: '烦躁', group: 'down' },
  { emoji: '🧊', label: '麻木', group: 'down' },
];

const MAX_PICK = 3;

export default function MoodSheet({ open, onClose }: MoodSheetProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) { setSelected([]); setNote(''); setSaved(false); }
  }, [open]);

  function toggle(label: string) {
    setSelected((prev) => {
      if (prev.includes(label)) return prev.filter((l) => l !== label);
      if (prev.length >= MAX_PICK) return prev;
      return [...prev, label];
    });
  }

  function save() {
    if (selected.length === 0) return;
    const picks = selected.map((l) => {
      const t = MOODS.find((m) => m.label === l);
      return t ? `${t.emoji} ${l}` : l;
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

        <div className="nesio-mood-header">
          <p className="nesio-mood-title">此刻感受</p>
          <p className="nesio-mood-subtitle">
            {selected.length === 0 ? '选 1-3 个，装盘就好' : selected.length < MAX_PICK ? `还可以再加 ${MAX_PICK - selected.length} 个` : '再多就挤了'}
          </p>
        </div>

        <div className="nesio-mood-grid">
          {MOODS.map((m) => {
            const on = selected.includes(m.label);
            return (
              <button
                key={m.label}
                type="button"
                className={`nesio-mood-token${on ? ' nesio-mood-token--on' : ''}`}
                onClick={() => toggle(m.label)}
                aria-pressed={on}
              >
                <span className="nesio-mood-token-emoji">{m.emoji}</span>
                <span className="nesio-mood-token-label">{m.label}</span>
              </button>
            );
          })}
        </div>

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
          {selected.length === 0 ? '先选一个感受' : `记住这刻 · ${selected.map((l) => MOODS.find((m) => m.label === l)?.emoji).join('')}`}
        </button>
      </div>
    </div>
  );
}
