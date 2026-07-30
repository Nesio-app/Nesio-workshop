'use client';

/**
 * MoodTrendCard — 健康「分析」页的心情趋势(缩略柱图 + 进趋势面板)。
 *
 * bug3 p43 的要求是「心情趋势显示在健康分析页」。第一版只把入口挂在 MoodCard 的
 * 底部,结果用户反馈「心情趋势挪到健康页?我没见到」—— 真因是**数据门错配**:
 * MoodCard 只在 `data.mood`(Apple Health 的 State of Mind)存在时渲染,还埋在
 * 「专项」折叠里;而趋势读的是 App 自己的情绪盘记录(life-graph 的 health_state +
 * feeling/moment 节点),跟 Apple Health 一点关系没有。于是「用情绪盘记心情的人
 * 有数据、却没有任何入口」。
 *
 * 所以这张卡:
 * ① 不挂任何 Apple Health 门 —— 连没导过 Apple Health 的早退分支也要给;
 * ② 直接放在分析页第一屏,不进折叠;
 * ③ 自己挂 MoodTrendSheet,不再靠 window 事件 —— 监听原来写在 TodayFeed 里,
 *    而洞察是浮层:activeSurface 是「记忆」时 TodayFeed 压根没挂载,点了真没反应。
 * 聚合逻辑复用 lib/portal/mood-trend 的 readMoodTrend(别把「谁算心情」写成两份)。
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { readMoodTrend, type MoodTrendData } from '@/lib/portal/mood-trend';
import { emotionOf } from '@/lib/portal/mood';
import { L } from '@/lib/portal/i18n';

const MoodTrendSheet = dynamic(() => import('../MoodTrendSheet'), { ssr: false });

export default function MoodTrendCard({ dict }: { dict: string }) {
  const [trend, setTrend] = useState<MoodTrendData | null>(null);
  const [open, setOpen] = useState(false);

  // 读 localStorage 必须等挂载后(SSR 没有 life-graph),否则 hydration 不一致。
  // 关掉面板时重读一次:面板里可能刚补记了一笔。
  useEffect(() => { if (!open) setTrend(readMoodTrend('week')); }, [open]);

  const dist = trend?.dist ?? [];
  const days = trend?.days ?? [];
  const total = dist.reduce((s, d) => s + d.count, 0);
  const hasData = total > 0 || days.some((d) => d.emotionId);
  const top = trend?.topEmotion ? emotionOf(trend.topEmotion) : undefined;
  const second = dist[1] ? emotionOf(dist[1].id) : undefined;

  return (
    <>
      <div className="nesio-health-card nesio-health-moodtrend">
        <span className="nesio-health-card-label">{L(dict, '心情 · 情绪趋势', 'Mood · trend')}</span>
        {hasData ? (
          <>
            <span className="nesio-health-card-value">
              {top ? L(dict, top.label, top.labelEn) : L(dict, '有记录', 'Logged')}
              <span className="nesio-health-card-unit">
                {second ? L(dict, `和${second.label} · ${total} 次`, `& ${second.labelEn} · ${total}`) : L(dict, `${total} 次记录`, `${total} logs`)}
              </span>
            </span>
            <div className="nesio-trend-bars nesio-trend-bars--mini">
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
          </>
        ) : (
          <span className="nesio-health-card-range">
            {L(dict, '这周还没有心情记录 —— 回今天页,滑一下情绪盘就记一笔。',
              'No mood logged this week — spin the wheel on Today to add one.')}
          </span>
        )}
        {/* 没有本周数据也留入口:月/年窗口里可能有(面板自己能切) */}
        <button type="button" className="nesio-health-card-link" onClick={() => setOpen(true)}>
          {L(dict, '看趋势 ›', 'See trend ›')}
        </button>
      </div>
      {open && <MoodTrendSheet open onClose={() => setOpen(false)} />}
    </>
  );
}
