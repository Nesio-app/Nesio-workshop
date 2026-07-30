/**
 * mood-trend — 情绪趋势的聚合器(单一真源)。
 *
 * 读 life-graph 里 App 自己的情绪记录(health_state + feeling/moment 节点的
 * attributes.emotion / energyLevel,写入口见 lib/portal/mood.ts 的 recordMoment
 * 与 MoodSheet),按周/月/年聚成 7 个刻度 + 情绪分布 + 能量回暖差。
 *
 * 从 MoodTrendSheet.tsx 里搬出来:健康分析页的入口卡(MoodTrendCard)要显示同一份
 * 缩略柱图,而它不该为了一个纯函数把整个 sheet(带 Vaul)拖进首屏包。
 * 「谁算心情」只能有一份 —— 别在卡里再抄一遍统计。
 */

import { getLifeGraph } from '@/lib/portal/life-graph';

export const MOOD_TREND_LABELS: Record<string, string> = {
  joy: '开心', excited: '兴奋', moved: '感动', calm: '平静', content: '满足', grateful: '感激',
  tired: '疲惫', empty: '空洞', sad: '难过', anxious: '焦虑', frustrated: '烦躁', angry: '生气',
};
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export type MoodPeriod = 'week' | 'month' | 'year';
export interface DayMood { label: string; emotionId: string | null; energyPct: number; isToday: boolean }
export interface MoodTrendData {
  days: DayMood[];
  dist: Array<{ id: string; count: number }>;
  topEmotion: string | null;
  warmer: number;
}

function energyPct(lvl: string): number { return lvl === 'high' ? 88 : lvl === 'low' ? 30 : 58; }

export function readMoodTrend(period: MoodPeriod): MoodTrendData {
  const graph = getLifeGraph().filter((n) => {
    const t = n.tags || [];
    return n.type === 'health_state' && (t.includes('feeling') || t.includes('moment'));
  });
  const now = new Date();
  const spanDays = period === 'week' ? 7 : period === 'month' ? 30 : 365;
  const days: DayMood[] = [];
  const distMap = new Map<string, number>();
  // 柱状图只画最近 7 个刻度(周=每天,月=每 ~4 天一格,年=每月一格)
  const buckets = 7;
  const step = Math.ceil(spanDays / buckets);
  for (let b = buckets - 1; b >= 0; b--) {
    const end = new Date(now); end.setDate(now.getDate() - b * step); end.setHours(23, 59, 59, 999);
    const start = new Date(end); start.setDate(end.getDate() - step + 1); start.setHours(0, 0, 0, 0);
    const inBucket = graph.filter((n) => { const t = new Date(n.createdAt); return t >= start && t <= end; })
      .sort((a, b2) => new Date(b2.createdAt).getTime() - new Date(a.createdAt).getTime());
    const m = inBucket[0];
    const emotionId = m && typeof m.attributes?.emotion === 'string' && MOOD_TREND_LABELS[m.attributes.emotion] ? m.attributes.emotion : null;
    const lvl = m ? String(m.attributes?.energyLevel || 'mid') : '';
    const isToday = b === 0;
    days.push({
      label: isToday ? '今天' : period === 'week' ? WEEKDAY[end.getDay()] : `${end.getMonth() + 1}/${end.getDate()}`,
      emotionId, energyPct: m ? energyPct(lvl) : 0, isToday,
    });
  }
  // 分布 + 能量回暖:全窗口所有心情节点(不只柱子代表的那几条)
  const winStart = new Date(now); winStart.setDate(now.getDate() - spanDays + 1); winStart.setHours(0, 0, 0, 0);
  const halfStart = new Date(now); halfStart.setDate(now.getDate() - Math.floor(spanDays / 2)); halfStart.setHours(0, 0, 0, 0);
  let recentSum = 0, recentN = 0, priorSum = 0, priorN = 0;
  for (const n of graph) {
    const t = new Date(n.createdAt);
    if (t < winStart) continue;
    const eid = typeof n.attributes?.emotion === 'string' && MOOD_TREND_LABELS[n.attributes.emotion] ? n.attributes.emotion : null;
    if (eid) distMap.set(eid, (distMap.get(eid) || 0) + 1);
    const e = energyPct(String(n.attributes?.energyLevel || 'mid'));
    if (t >= halfStart) { recentSum += e; recentN += 1; } else { priorSum += e; priorN += 1; }
  }
  const warmer = recentN && priorN ? Math.round((recentSum / recentN) - (priorSum / priorN)) : 0;
  const dist = [...distMap.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  return { days, dist, topEmotion: dist[0]?.id ?? null, warmer };
}
