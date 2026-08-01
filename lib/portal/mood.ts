/**
 * mood — 心情系统单一真源:12 情绪(Russell 环状 4象限×3)+ 记录「此刻」moment 的写入口。
 * MoodSheet(留住这一刻)与疗愈闭环共用这份表与 recordMoment,保证疗愈后的心情进同一套情绪记录/趋势。
 */

import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

// ── 12-Emotion taxonomy (Russell Circumplex 4 quadrants × 3) ─────────────────
export const EMOTIONS = [
  { id: 'joy',        label: '开心', labelEn: 'Joyful',    emoji: '😄', color: 'var(--emotion-joy)', quadrant: 'hv-ha' },
  { id: 'excited',    label: '兴奋', labelEn: 'Excited',   emoji: '🤩', color: 'var(--emotion-excited)', quadrant: 'hv-ha' },
  { id: 'moved',      label: '感动', labelEn: 'Moved',     emoji: '🥰', color: 'var(--emotion-moved)', quadrant: 'hv-ha' },
  { id: 'calm',       label: '平静', labelEn: 'Calm',      emoji: '😌', color: 'var(--emotion-calm)', quadrant: 'hv-la' },
  { id: 'content',    label: '满足', labelEn: 'Content',   emoji: '😊', color: 'var(--emotion-content)', quadrant: 'hv-la' },
  { id: 'grateful',   label: '感激', labelEn: 'Grateful',  emoji: '🤗', color: 'var(--emotion-grateful)', quadrant: 'hv-la' },
  { id: 'tired',      label: '疲惫', labelEn: 'Tired',     emoji: '😪', color: 'var(--emotion-tired)', quadrant: 'lv-la' },
  { id: 'empty',      label: '空洞', labelEn: 'Empty',     emoji: '😶', color: 'var(--emotion-empty)', quadrant: 'lv-la' },
  { id: 'sad',        label: '难过', labelEn: 'Sad',       emoji: '😢', color: 'var(--emotion-sad)', quadrant: 'lv-la' },
  { id: 'anxious',    label: '焦虑', labelEn: 'Anxious',   emoji: '😰', color: 'var(--emotion-anxious)', quadrant: 'lv-ha' },
  { id: 'frustrated', label: '烦躁', labelEn: 'Restless',  emoji: '😤', color: 'var(--emotion-frustrated)', quadrant: 'lv-ha' },
  { id: 'angry',      label: '生气', labelEn: 'Angry',     emoji: '😠', color: 'var(--emotion-angry)', quadrant: 'lv-ha' },
] as const;

export type EmotionId = typeof EMOTIONS[number]['id'];
export const emotionOf = (id: string) => EMOTIONS.find((e) => e.id === id);

export function autoContext(): Record<string, string | boolean | number> {
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

/**
 * 记录一次「此刻」心情 moment(轻量入口:只需一个情绪,不带精力轮/日记)。
 * 写成与 MoodSheet「此刻」同形的 health_state 节点(tags: moment/feeling),自然进情绪趋势。
 * opts.tags 可加来源标(如 'healing'),opts.thought 存一句话备注。
 */
export function recordMoment(emotionId: EmotionId, opts?: { en?: boolean; thought?: string; tags?: string[] }) {
  const em = emotionOf(emotionId);
  if (!em) return;
  const note = opts?.thought?.trim();
  ingestLifeNode({
    name: opts?.en ? `This moment · ${em.labelEn}` : `此刻 · ${em.label}`,
    type: 'Mind',
    tags: ['moment', 'feeling', em.id, em.quadrant, ...(opts?.tags ?? [])],
    attributes: {
      emotion: em.id, emotionLabel: em.label, emotionEmoji: em.emoji, emotionQuadrant: em.quadrant,
      ...(note ? { thought: note } : {}),
      ...autoContext(),
    },
    rawInput: opts?.en
      ? `This moment ${em.labelEn}${note ? ` · ${note}` : ''}`
      : `此刻 ${em.label}${note ? ` · ${note}` : ''}`,
    confidence: 1, source: 'manual', relations: [],
  });
}
