'use client';

/**
 * HealthLogger — manual health state logging sheet.
 * Captures: symptoms, sleep hours, energy level, mood.
 * Saves to Life Graph as health_state nodes.
 * Feeds into Reasoning Engine for weather+health cross-signal cards.
 */

import { useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

interface HealthLoggerProps { open: boolean; onClose: () => void; }

const SYMPTOMS = ['感冒', '嗓子不舒服', '发烧', '头疼', '疲劳', '过敏', '肌肉酸痛', '消化不适'];
const MOODS = ['😊 不错', '😐 一般', '😴 很累', '😰 焦虑', '😤 烦躁'];

export default function HealthLogger({ open, onClose }: HealthLoggerProps) {
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [sleep, setSleep] = useState('');
  const [energy, setEnergy] = useState(3);
  const [mood, setMood] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  function toggleSymptom(s: string) {
    setSelectedSymptoms((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function handleSave() {
    const today = new Date().toLocaleDateString('zh-CN');

    if (selectedSymptoms.length > 0) {
      selectedSymptoms.forEach((symptom) => {
        ingestLifeNode({
          type: 'health_state',
          name: symptom,
          attributes: { status: 'active', date: today, energy: String(energy), mood, note },
          source: 'manual',
          confidence: 0.9,
          relations: [],
          tags: ['健康记录', today],
          rawInput: `${symptom}，精力${energy}/5，${mood}`,
        });
      });
    }

    // Sleep log
    if (sleep) {
      ingestLifeNode({
        type: 'health_state',
        name: `睡眠 ${sleep}h`,
        attributes: { type: 'sleep', hours: sleep, date: today },
        source: 'manual',
        confidence: 1.0,
        relations: [],
        tags: ['健康记录', '睡眠'],
      });
    }

    // General energy/mood
    if (mood || energy !== 3) {
      ingestLifeNode({
        type: 'health_state',
        name: `今日状态：${mood || '一般'}`,
        attributes: { energy: String(energy), mood, date: today },
        source: 'manual',
        confidence: 1.0,
        relations: [],
        tags: ['健康记录', '心情'],
      });
    }

    setSaved(true);
    setTimeout(() => {
      onClose();
      setSelectedSymptoms([]); setSleep(''); setEnergy(3); setMood(''); setNote(''); setSaved(false);
    }, 1000);
  }

  const hasData = selectedSymptoms.length > 0 || sleep || energy !== 3 || mood;

  if (!open) return null;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="健康记录">
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">今日健康记录</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body">
          {/* Symptoms */}
          <p className="nesio-settings-section-label">症状（可多选）</p>
          <div className="nesio-health-chips">
            {SYMPTOMS.map((s) => (
              <button key={s} type="button"
                className={`nesio-health-chip${selectedSymptoms.includes(s) ? ' nesio-health-chip--active' : ''}`}
                onClick={() => toggleSymptom(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* Sleep */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>昨晚睡了几小时？</p>
          <div className="nesio-health-sleep-row">
            {['4', '5', '6', '7', '8', '9', '10+'].map((h) => (
              <button key={h} type="button"
                className={`nesio-health-sleep-btn${sleep === h ? ' nesio-health-sleep-btn--active' : ''}`}
                onClick={() => setSleep(h)}>
                {h}h
              </button>
            ))}
          </div>

          {/* Energy */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>精力水平（1-5）</p>
          <div className="nesio-health-energy-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button"
                className={`nesio-health-energy-btn${energy === n ? ' nesio-health-energy-btn--active' : ''}`}
                onClick={() => setEnergy(n)}>
                {'⚡'.repeat(n)}
              </button>
            ))}
          </div>

          {/* Mood */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>心情</p>
          <div className="nesio-health-mood-row">
            {MOODS.map((m) => (
              <button key={m} type="button"
                className={`nesio-health-mood-btn${mood === m ? ' nesio-health-mood-btn--active' : ''}`}
                onClick={() => setMood(m)}>
                {m}
              </button>
            ))}
          </div>

          {/* Note */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>补充说明（可选）</p>
          <input
            className="nesio-ob-input"
            placeholder="其他想记录的…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hasData) handleSave(); }}
          />

          <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1rem' }}
            onClick={handleSave} disabled={!hasData}>
            {saved ? '✓ 已记录' : '记录今日状态'}
          </button>

          <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', textAlign: 'center', marginTop: '0.75rem' }}>
            记录后，Today Feed 会结合天气和日程给出健康相关建议
          </p>
        </div>
      </div>
    </div>
  );
}
