'use client';

/**
 * MetricsCharts — /admin 面板的图表展示层(recharts)。
 * 颜色全部走 design token(var(--...)),日夜主题自动跟随。
 * 只做渲染;数据获取/范围切换在 page.tsx 容器里。
 */

import { useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar,
  RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const INK = 'var(--portal-ink)';
const MUTED = 'var(--portal-muted)';
const ACCENT = 'var(--portal-accent)';
const GO = 'var(--status-go)';
const GENTLE = 'var(--status-gentle)';
const LINE = 'var(--portal-line)';

const tooltipStyle: React.CSSProperties = {
  background: 'var(--glass-bg-pop)', border: `1px solid ${LINE}`,
  borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: INK,
};

export interface DailyPoint { date: string; events: number; devices: number }

/** 每日事件(面积)+ 独立设备(折线)+ 上一周期(灰虚线)趋势 */
export function TrendChart({ data, prev }: { data: DailyPoint[]; prev?: DailyPoint[] }) {
  const points = data.map((d, i) => ({
    ...d,
    day: d.date.slice(5),
    prevEvents: prev?.[i]?.events ?? null,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="evFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: MUTED }}
          formatter={(v, name) => [String(v ?? 0), name === 'events' ? '事件' : name === 'devices' ? '设备' : '上一周期']} />
        <Line type="monotone" dataKey="prevEvents" stroke={MUTED} strokeWidth={1.2} strokeDasharray="4 4" dot={false} />
        <Area type="monotone" dataKey="events" stroke={ACCENT} strokeWidth={2} fill="url(#evFill)" />
        <Line type="monotone" dataKey="devices" stroke={GO} strokeWidth={1.6} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Top 事件横向条形图 */
const TOP_EVENT_LABEL_W = 150;
/** Bug4 图17:名字默认右对齐(贴着条形起点),长短不一时左边缘是锯齿状,读起来要来回找。
    自绘 tick,统一钉在轴区左边缘。 */
function TopEventTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  return (
    <text x={(x ?? 0) - TOP_EVENT_LABEL_W} y={y ?? 0} dy={4} textAnchor="start" fontSize={11} fill={INK}>
      {String(payload?.value ?? '')}
    </text>
  );
}
export function TopEventsChart({ data }: { data: Array<{ name: string; count: number }> }) {
  const height = Math.max(120, data.length * 34);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={TOP_EVENT_LABEL_W} tick={<TopEventTick />} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [String(v), '次']} cursor={{ fill: 'var(--portal-accent-soft)' }} />
        <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={16}
          label={{ position: 'right', fontSize: 11, fill: MUTED }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 使用漏斗:逐级条 + 相对上一步的转化率;转化最差的一步自动高亮为瓶颈 */
export function FunnelSteps({ data }: { data: Array<{ step: string; devices: number }> }) {
  const max = Math.max(1, ...data.map((f) => f.devices));
  const rates = data.map((f, i) => {
    const prev = i === 0 ? null : data[i - 1].devices;
    return prev && prev >= 3 ? Math.round((f.devices / prev) * 100) : null;
  });
  const validRates = rates.filter((r): r is number => r !== null);
  const worstRate = validRates.length ? Math.min(...validRates) : null;
  return (
    <div>
      {data.map((f, i) => {
        const rate = rates[i];
        const isBottleneck = worstRate !== null && rate === worstRate && rate < 40;
        return (
          <div key={f.step} style={{ marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: INK, marginBottom: 3 }}>
              <span>
                {f.step}
                {isBottleneck && (
                  <span style={{ marginLeft: 6, fontSize: '0.62rem', color: 'var(--status-risk)', border: '1px solid var(--status-risk)', borderRadius: 'var(--radius-pill)', padding: '0 0.4rem' }}>瓶颈</span>
                )}
              </span>
              <span>
                {f.devices}
                {rate !== null && (
                  <span style={{ color: isBottleneck ? 'var(--status-risk)' : rate >= 50 ? GO : GENTLE, marginLeft: 6, fontSize: '0.68rem' }}>{rate}% ↓</span>
                )}
              </span>
            </div>
            <div style={{ height: 10, background: 'var(--portal-accent-soft)', borderRadius: 5 }}>
              <div style={{ width: `${Math.max(2, Math.round((f.devices / max) * 100))}%`, height: '100%', background: isBottleneck ? 'var(--status-risk)' : GO, borderRadius: 5, transition: 'width 0.4s var(--ease-out)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 洞察卡:严重度着色 + 描述 + 建议 */
export function InsightCard({ severity, title, detail, advice }: { severity: 'go' | 'gentle' | 'risk'; title: string; detail: string; advice: string }) {
  const color = severity === 'risk' ? 'var(--status-risk)' : severity === 'gentle' ? GENTLE : GO;
  const soft = severity === 'risk' ? 'var(--status-risk-soft)' : severity === 'gentle' ? 'var(--status-gentle-soft)' : 'var(--status-go-soft)';
  const icon = severity === 'risk' ? '⚠' : severity === 'gentle' ? '◐' : '✓';
  return (
    <div style={{ display: 'flex', gap: '0.7rem', padding: '0.75rem 0.9rem', borderRadius: 'var(--radius-md)', background: soft, borderLeft: `3px solid ${color}`, marginBottom: '0.5rem' }}>
      <span style={{ color, fontSize: '1rem', lineHeight: 1.3 }} aria-hidden>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: INK }}>{title}</p>
        <p style={{ margin: '0.15rem 0 0', fontSize: '0.76rem', color: INK, opacity: 0.85 }}>{detail}</p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.76rem', color }}>建议:{advice}</p>
      </div>
    </div>
  );
}

/** KPI 环比箭头 */
export function Delta({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const flat = value === 0;
  const color = flat ? MUTED : up ? GO : GENTLE;
  return (
    <span style={{ color, fontSize: '0.72rem', marginLeft: 6 }}>
      {flat ? '持平' : `${up ? '↑' : '↓'} ${Math.abs(value)}%`}
    </span>
  );
}

/** 今日卡反馈环形图 */
export function FeedbackDonut({ useful, wrong, tooMuch }: { useful: number; wrong: number; tooMuch: number }) {
  const total = useful + wrong + tooMuch;
  const data = [
    { name: '有用', value: useful, color: GO },
    { name: '不准', value: wrong, color: GENTLE },
    { name: '不再提醒', value: tooMuch, color: MUTED },
  ];
  // Bug4 图15:右边那张图例是「看图的人自己做连线题」——颜色→名字→数字要在两处来回对。
  // 改成:图例整块删掉,环心直接写字;点(或悬停)某一瓣,环心换成那一瓣。默认停在「有用」。
  // Hook 必须在任何 return 之前(空态那条早退在下面)。
  const [active, setActive] = useState(0);
  if (total === 0) {
    return <p style={{ fontSize: '0.75rem', color: MUTED }}>还没有反馈 — 今日卡出现后,用户点「有用/不准」会汇到这里。</p>;
  }
  const cur = data[Math.min(active, data.length - 1)];
  const pct = Math.round((cur.value / total) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <ResponsiveContainer width="100%" height={168}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={54}
            outerRadius={78}
            paddingAngle={2}
            stroke="none"
            isAnimationActive={false}
            onMouseEnter={(_, i) => setActive(i)}
            onClick={(_, i) => setActive(i)}
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.color} opacity={i === active ? 1 : 0.42} cursor="pointer" />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', textAlign: 'center', pointerEvents: 'none' }}>
        <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: cur.color }}>{pct}%</p>
        <p style={{ margin: 0, fontSize: '0.74rem', color: INK }}>{cur.name}</p>
        <p style={{ margin: 0, fontSize: '0.68rem', color: MUTED }}>{cur.value} / {total} 次</p>
      </div>
    </div>
  );
}

/** 聪明度雷达:五维 0-100;样本不足的维度在轴名上标 · */
export function SmartnessRadar({ dims }: { dims: Array<{ dim: string; score: number; thin: boolean }> }) {
  const data = dims.map((d) => ({ ...d, label: d.thin ? `${d.dim}·` : d.dim }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={LINE} />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: INK }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar dataKey="score" stroke={ACCENT} fill={ACCENT} fillOpacity={0.28} strokeWidth={2} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [String(v), '分']} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
