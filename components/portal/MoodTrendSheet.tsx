'use client';

/**
 * MoodTrendSheet — 情绪趋势(批次 136,设计「心情·情绪趋势」)。
 *
 * 首页心情第一拍点「看趋势」进来(nesio-open-mood-trend)。设计:
 * - 柱状图:一柱一天,柱高 = 当天能量(蔫/中/满电 → 30/58/88%)、柱色 = 当天心情(12 色定稿),今天高亮。
 * - 念念一句说人话(这周更多是 X 和 Y)。
 * - 这周的情绪分布(色点 + 条 + 天数)。
 * - 周/月/年可切(本周为主,月/年复用同一读取器扩窗)。
 * 数据 = life-graph health_state + feeling 节点的 attributes.emotion / energyLevel。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';

const EMO: Record<string, string> = {
  joy: '开心', excited: '兴奋', moved: '感动', calm: '平静', content: '满足', grateful: '感激',
  tired: '疲惫', empty: '空洞', sad: '难过', anxious: '焦虑', frustrated: '烦躁', angry: '生气',
};
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

interface DayMood { label: string; emotionId: string | null; energyPct: number; isToday: boolean }
interface TrendData { days: DayMood[]; dist: Array<{ id: string; count: number }>; topEmotion: string | null; warmer: number }

function energyPct(lvl: string): number { return lvl === 'high' ? 88 : lvl === 'low' ? 30 : 58; }

function readTrend(period: 'week' | 'month' | 'year'): TrendData {
  const graph = getLifeGraph().filter((n) => {
    const t = n.tags || [];
    return n.type === 'health_state' && (t.includes('feeling') || t.includes('moment'));
  });
  const now = new Date();
  const spanDays = period === 'week' ? 7 : period === 'month' ? 30 : 365;
  const days: DayMood[] = [];
  const distMap = new Map<string, number>();
  let energySum = 0, energyN = 0;
  // 柱状图只画最近 7 个刻度(周=每天,月=每 ~4 天一格,年=每月一格)
  const buckets = 7;
  const step = Math.ceil(spanDays / buckets);
  for (let b = buckets - 1; b >= 0; b--) {
    const end = new Date(now); end.setDate(now.getDate() - b * step); end.setHours(23, 59, 59, 999);
    const start = new Date(end); start.setDate(end.getDate() - step + 1); start.setHours(0, 0, 0, 0);
    const inBucket = graph.filter((n) => { const t = new Date(n.createdAt); return t >= start && t <= end; })
      .sort((a, b2) => new Date(b2.createdAt).getTime() - new Date(a.createdAt).getTime());
    const m = inBucket[0];
    const emotionId = m && typeof m.attributes?.emotion === 'string' && EMO[m.attributes.emotion] ? m.attributes.emotion : null;
    const lvl = m ? String(m.attributes?.energyLevel || 'mid') : '';
    const isToday = b === 0;
    days.push({
      label: isToday ? '今天' : period === 'week' ? WEEKDAY[end.getDay()] : `${end.getMonth() + 1}/${end.getDate()}`,
      emotionId, energyPct: m ? energyPct(lvl) : 0, isToday,
    });
  }
  // 分布 + 能量均值:全窗口所有心情节点(不只柱子代表的)
  const winStart = new Date(now); winStart.setDate(now.getDate() - spanDays + 1); winStart.setHours(0, 0, 0, 0);
  const halfStart = new Date(now); halfStart.setDate(now.getDate() - Math.floor(spanDays / 2)); halfStart.setHours(0, 0, 0, 0);
  let recentSum = 0, recentN = 0, priorSum = 0, priorN = 0;
  for (const n of graph) {
    const t = new Date(n.createdAt);
    if (t < winStart) continue;
    const eid = typeof n.attributes?.emotion === 'string' && EMO[n.attributes.emotion] ? n.attributes.emotion : null;
    if (eid) distMap.set(eid, (distMap.get(eid) || 0) + 1);
    const e = energyPct(String(n.attributes?.energyLevel || 'mid'));
    energySum += e; energyN += 1;
    if (t >= halfStart) { recentSum += e; recentN += 1; } else { priorSum += e; priorN += 1; }
  }
  void energySum; void energyN;
  const warmer = recentN && priorN ? Math.round((recentSum / recentN) - (priorSum / priorN)) : 0;
  const dist = [...distMap.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  return { days, dist, topEmotion: dist[0]?.id ?? null, warmer };
}

export default function MoodTrendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [data, setData] = useState<TrendData>(() => readTrend('week'));

  useEffect(() => { if (open) setData(readTrend(period)); }, [open, period]);

  if (!open) return null;
  const { days, dist, topEmotion, warmer } = data;
  const hasData = days.some((d) => d.emotionId) || dist.length > 0;
  const topLabel = topEmotion ? EMO[topEmotion] : '';
  const secondLabel = dist[1] ? EMO[dist[1].id] : '';
  const periodWord = period === 'week' ? L(dict, '这周', 'this week') : period === 'month' ? L(dict, '这个月', 'this month') : L(dict, '今年', 'this year');
  const warmWord = warmer > 4 ? L(dict, '回暖了', 'warmed up') : warmer < -4 ? L(dict, '低了些', 'dipped a bit') : L(dict, '大体平稳', 'stayed steady');

  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-mood-card nesio-trend-card"
      ariaLabel={L(dict, '情绪趋势', 'Mood trend')}
    >
        <div className="nesio-trend-header">
          <button type="button" className="nesio-wechat-back-btn" onClick={onClose} aria-label={L(dict, '返回', 'Back')}>‹</button>
          <span className="nesio-trend-title">{L(dict, '情绪趋势', 'Mood trend')}</span>
          <span aria-hidden style={{ width: 28 }} />
        </div>

        <div className="nesio-trend-seg">
          {([['week', '本周', 'Week'], ['month', '本月', 'Month'], ['year', '今年', 'Year']] as const).map(([id, zh, en]) => (
            <button key={id} type="button" className={`nesio-trend-seg-btn${period === id ? ' nesio-trend-seg-btn--on' : ''}`} onClick={() => setPeriod(id)}>
              {L(dict, zh, en)}
            </button>
          ))}
        </div>

        {!hasData ? (
          <p className="nesio-settings-option-hint" style={{ textAlign: 'center', padding: '2.5rem 0' }}>
            {L(dict, `${periodWord}还没有心情记录 —— 回今天页,滑一下情绪盘记一笔。`, `No mood logged ${periodWord} yet — log one on Today.`)}
          </p>
        ) : (
          <>
            <div className="nesio-trend-chart-card">
              <div className="nesio-trend-chart-head">
                <span className="nesio-trend-chart-label">{L(dict, `${periodWord} · 能量与心情`, `${periodWord} · energy & mood`)}</span>
                <span className={`nesio-trend-warm${warmer >= 0 ? ' nesio-trend-warm--up' : ''}`}>
                  {warmer > 4 ? '↑ ' : warmer < -4 ? '↓ ' : ''}{L(dict, `比上期${warmWord}`, warmWord)}
                </span>
              </div>
              <div className="nesio-trend-bars">
                {days.map((d, i) => (
                  <div key={i} className="nesio-trend-bar-col">
                    <div className="nesio-trend-bar-track">
                      <div
                        className={`nesio-trend-bar${d.isToday ? ' nesio-trend-bar--today' : ''}`}
                        style={{ height: `${d.energyPct}%`, background: d.emotionId ? `var(--emotion-${d.emotionId})` : 'var(--portal-line)' }}
                      />
                    </div>
                    <span className={`nesio-trend-bar-lab${d.isToday ? ' nesio-trend-bar-lab--today' : ''}`}>{d.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="nesio-trend-narr">
              <span className="nesio-trend-narr-orb" aria-hidden />
              <p className="nesio-trend-narr-text">
                {L(dict,
                  `${periodWord}你更多是${topLabel}${secondLabel ? `和${secondLabel}` : ''},能量比上期${warmWord}。`,
                  `${periodWord} you leaned ${topLabel}${secondLabel ? ` and ${secondLabel}` : ''}; energy ${warmWord}.`)}
              </p>
            </div>

            {dist.length > 0 && (
              <>
                <p className="nesio-trend-dist-label">{L(dict, `${periodWord}的情绪分布`, `${periodWord} spread`)}</p>
                <div className="nesio-trend-dist">
                  {dist.slice(0, 6).map(({ id, count }) => (
                    <div key={id} className="nesio-trend-dist-row">
                      <span className="nesio-trend-dist-dot" style={{ background: `var(--emotion-${id})` }} aria-hidden />
                      <span className="nesio-trend-dist-name">{EMO[id]}</span>
                      <span className="nesio-trend-dist-track"><span className="nesio-trend-dist-fill" style={{ width: `${(count / dist[0].count) * 100}%`, background: `var(--emotion-${id})` }} /></span>
                      <span className="nesio-trend-dist-count">{count} {L(dict, '天', 'd')}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
    </NesioSheet>
  );
}
