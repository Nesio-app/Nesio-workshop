'use client';

/**
 * MoodBeat — 今天页时间线的「现在」第一拍(批次 107;批次 119 按设计规范 12 色定稿重做)。
 *
 * 设计规范(design-spec.html 落位·首页第一拍):
 * - 心情是一天时间线的「现在」第一拍,不占额外空间。用心情波纹方块作节点。
 * - 符号 + 标题文字严格取情绪盘里同一色 var(--emotion-<id>)—— 跟着当天记录的心情变。
 * - 已记:染上情绪色(哑光白核 + 该情绪色光晕,标题该情绪色 + 能量)。
 * - 未记(邀请态):淡紫、波纹符号 =「问你自己」。
 * - 质感与记忆球一致:低饱和、有光韵(彩色光晕),边缘一丝透色而非白边。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L, type DictLocale } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

// 12 情绪标签(与 MoodSheet EMOTIONS 同源;首页第一拍取盘里同一 var(--emotion-<id>) 色)
const EMOTION_LABELS: Record<string, [string, string]> = {
  joy: ['开心', 'Joyful'], excited: ['兴奋', 'Excited'], moved: ['感动', 'Moved'],
  calm: ['平静', 'Calm'], content: ['满足', 'Content'], grateful: ['感激', 'Grateful'],
  tired: ['疲惫', 'Tired'], empty: ['空洞', 'Empty'], sad: ['难过', 'Sad'],
  anxious: ['焦虑', 'Anxious'], frustrated: ['烦躁', 'Restless'], angry: ['生气', 'Angry'],
};

interface Beat { emotionId: string | null; label: string; labelEn: string; energyLevel: string; time: string; hasEmotion: boolean }

function readLatestMoodToday(): Beat | null {
  try {
    const moods = getLifeGraph().filter((n) => {
      const tags = n.tags || [];
      return n.type === 'health_state' && (tags.includes('feeling') || tags.includes('moment'));
    });
    if (moods.length === 0) return null;
    moods.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const m = moods[0];
    const t = new Date(m.createdAt);
    const now = new Date();
    if (t.getFullYear() !== now.getFullYear() || t.getMonth() !== now.getMonth() || t.getDate() !== now.getDate()) {
      return null; // 只把「今天」的心情当第一拍
    }
    // 解析情绪 id:优先直接 attributes.emotion,退而用 emotionLabel 反查(兜住旧数据)
    const rawEmotion = typeof m.attributes?.emotion === 'string' ? m.attributes.emotion : '';
    const emotionLabelAttr = typeof m.attributes?.emotionLabel === 'string' ? m.attributes.emotionLabel : '';
    let emotionId: string | null = EMOTION_LABELS[rawEmotion] ? rawEmotion : null;
    if (!emotionId && emotionLabelAttr) {
      const found = Object.entries(EMOTION_LABELS).find(([, [zh]]) => zh === emotionLabelAttr);
      if (found) emotionId = found[0];
    }
    const labels = emotionId ? EMOTION_LABELS[emotionId] : null;
    // 有干净的情绪词(来自 id 或 emotionLabel)才追加能量词,否则退回节点名整条显示(不重复追加能量)
    // 用 || 而非 ??:空串也要兜底(?? 只兜 null/undefined,会漏掉空 emotionLabel)
    const hasEmotion = !!(labels || emotionLabelAttr);
    const zh = labels?.[0] || emotionLabelAttr || m.name.slice(0, 14);
    const en = labels?.[1] || emotionLabelAttr || zh;
    const energyLevel = String(m.attributes?.energyLevel || 'mid');
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return { emotionId, label: zh, labelEn: en, energyLevel, time, hasEmotion };
  } catch {
    return null;
  }
}

function energyWord(level: string, dict: DictLocale): string {
  if (level === 'high') return L(dict, '能量高', 'high energy');
  if (level === 'low') return L(dict, '能量低', 'low energy');
  return L(dict, '能量中', 'steady energy');
}

export default function MoodBeat() {
  const onOpenTrend = () => window.dispatchEvent(new CustomEvent('nesio-open-mood-trend'));
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [beat, setBeat] = useState<Beat | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const refresh = () => { setBeat(readLatestMoodToday()); setReady(true); };
    refresh();
    window.addEventListener('nesio-life-graph-updated', refresh);
    return () => window.removeEventListener('nesio-life-graph-updated', refresh);
  }, []);

  if (!ready) return null;

  // 未记(邀请态):淡紫、波纹符 =「问你自己」
  if (!beat) {
    return (
      <button
        type="button"
        className="nesio-tl-node nesio-tl-node--mood nesio-tl-node--invite"
        onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-mood'))}
      >
        <span className="nesio-tl-dot nesio-tl-dot--mood nesio-tl-dot--mood-invite" aria-hidden><MoodRipple /></span>
        <span className="nesio-tl-time">{L(dict, '现在', 'Now')}</span>
        <span className="nesio-tl-title">{L(dict, '此刻,你感觉——', 'This moment, you feel —')}</span>
        <span className="nesio-tl-sub">{L(dict, '滑一下记 5 秒 · 今天还没记', '5 seconds to log · not yet today')}</span>
      </button>
    );
  }

  // 已记:符号 + 标题都染上当天情绪色(取盘里同一 var(--emotion-<id>))
  const moodC = beat.emotionId ? `var(--emotion-${beat.emotionId})` : 'var(--portal-muted)';
  return (
    <button
      type="button"
      className="nesio-tl-node nesio-tl-node--mood"
      onClick={onOpenTrend}
      style={{ ['--mood-c']: moodC } as React.CSSProperties}
    >
      <span className="nesio-tl-dot nesio-tl-dot--mood" aria-hidden><MoodRipple /></span>
      <span className="nesio-tl-time">{L(dict, '今天', 'Today')}</span>
      <span className="nesio-tl-title">
        <span className="nesio-mood-word">{L(dict, beat.label, beat.labelEn)}</span>
        {beat.hasEmotion && <span className="nesio-mood-energy"> · {energyWord(beat.energyLevel, dict)}</span>}
      </span>
      <span className="nesio-tl-sub">{beat.time} · {L(dict, '记录 · 点开看这周趋势', 'logged · tap for this week')}</span>
    </button>
  );
}

/** 心情波纹符号(设计规范 mood-node.html 权威:一道情绪波纹曲线,不是双波、不用圆点) */
function MoodRipple() {
  return (
    <svg className="nesio-mood-ripple" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 13c2 0 2.4-4 3.8-4s1.9 6 3.8 6 2.4-8 3.8-8 1.9 5 3.8 5" />
    </svg>
  );
}
