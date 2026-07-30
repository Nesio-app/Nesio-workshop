'use client';

/**
 * MoodTrendSheet — 情绪趋势(批次 136,设计「心情·情绪趋势」)。
 *
 * 入口:健康「分析」页的心情趋势卡(MoodTrendCard 自己挂这张 sheet)。设计:
 * - 柱状图:一柱一天,柱高 = 当天能量(蔫/中/满电 → 30/58/88%)、柱色 = 当天心情(12 色定稿),今天高亮。
 * - 念念一句说人话(这周更多是 X 和 Y)。
 * - 这周的情绪分布(色点 + 条 + 天数)。
 * - 周/月/年可切(本周为主,月/年复用同一读取器扩窗)。
 * 数据 = lib/portal/mood-trend.ts 的 readMoodTrend(入口卡复用同一份聚合)。
 */

import { useEffect, useState } from 'react';
import { readMoodTrend, MOOD_TREND_LABELS as EMO, type MoodTrendData as TrendData } from '@/lib/portal/mood-trend';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';

export default function MoodTrendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [data, setData] = useState<TrendData>(() => readMoodTrend('week'));

  useEffect(() => { if (open) setData(readMoodTrend(period)); }, [open, period]);

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
      // 2026-07-29:趋势入口从今天页搬到了健康页(洞察是 fullscreen 浮层)。
      // 普通 bottom 是 z-901,会被洞察那层整个盖住 —— 表现是「点了没反应」,
      // 而这个坑本会话已经踩过一次(收纳页从洞察打开时同样被盖)。抬到 941。
      elevated
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
