'use client';

/**
 * MoodBeat — 今天页时间线的「现在」第一拍(批次 107,设计规范今天页)。
 *
 * 心情不占额外空间,而是一天时间线的第一个节点:读今天最近一条心情
 * (health_state + feeling/moment 标签),显示「今天 · <心情> · <时>记录·点开看趋势」,
 * 点开进洞察心情趋势。今天还没记心情 → 邀请节点「现在感觉如何?」开心情盘。
 * 节点造型与时间线其它节点一致(左侧圆点在竖轨上 + 时标 + 标题 + 副行)。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

interface Beat { name: string; time: string; tone: 'go' | 'calm' | 'gentle' }

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
    const lvl = String(m.attributes?.energyLevel || '');
    const tone: Beat['tone'] = lvl === 'high' ? 'gentle' : lvl === 'low' ? 'go' : 'calm';
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return { name: m.name.slice(0, 24), time, tone };
  } catch {
    return null;
  }
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

  if (!beat) {
    return (
      <button
        type="button"
        className="nesio-tl-node nesio-tl-node--invite"
        onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-mood'))}
      >
        <span className="nesio-tl-dot nesio-tl-dot--mood" data-tone="calm" aria-hidden><MoodRipple /></span>
        <span className="nesio-tl-time">{L(dict, '现在', 'Now')}</span>
        <span className="nesio-tl-title">{L(dict, '现在感觉如何?', 'How do you feel?')}</span>
        <span className="nesio-tl-sub">{L(dict, '记一下,今天的第一拍', "Log it — today's first beat")}</span>
      </button>
    );
  }

  return (
    <button type="button" className="nesio-tl-node nesio-tl-node--mood" onClick={onOpenTrend}>
      <span className="nesio-tl-dot nesio-tl-dot--mood" data-tone={beat.tone} aria-hidden><MoodRipple /></span>
      <span className="nesio-tl-time">{L(dict, '今天', 'Today')}</span>
      <span className="nesio-tl-title">{beat.name}</span>
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
