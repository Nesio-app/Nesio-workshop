'use client';

/**
 * MetricsCharts — /admin 面板的图表展示层(recharts)。
 * 颜色全部走 design token(var(--...)),日夜主题自动跟随。
 * 只做渲染;数据获取/范围切换在 page.tsx 容器里。
 */

import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
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

/** 每日事件(面积)+ 独立设备(折线)双轴趋势 */
export function TrendChart({ data }: { data: DailyPoint[] }) {
  const points = data.map((d) => ({ ...d, day: d.date.slice(5) }));
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
          formatter={(v, name) => [String(v), name === 'events' ? '事件' : '设备']} />
        <Area type="monotone" dataKey="events" stroke={ACCENT} strokeWidth={2} fill="url(#evFill)" />
        <Line type="monotone" dataKey="devices" stroke={GO} strokeWidth={1.6} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Top 事件横向条形图 */
export function TopEventsChart({ data }: { data: Array<{ name: string; count: number }> }) {
  const height = Math.max(120, data.length * 34);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [String(v), '次']} cursor={{ fill: 'var(--portal-accent-soft)' }} />
        <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={16}
          label={{ position: 'right', fontSize: 11, fill: MUTED }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 使用漏斗:逐级条 + 相对上一步的转化率 */
export function FunnelSteps({ data }: { data: Array<{ step: string; devices: number }> }) {
  const max = Math.max(1, ...data.map((f) => f.devices));
  return (
    <div>
      {data.map((f, i) => {
        const prev = i === 0 ? null : data[i - 1].devices;
        const rate = prev ? Math.round((f.devices / Math.max(1, prev)) * 100) : null;
        return (
          <div key={f.step} style={{ marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: INK, marginBottom: 3 }}>
              <span>{f.step}</span>
              <span>
                {f.devices}
                {rate !== null && (
                  <span style={{ color: rate >= 50 ? GO : GENTLE, marginLeft: 6, fontSize: '0.68rem' }}>{rate}% ↓</span>
                )}
              </span>
            </div>
            <div style={{ height: 10, background: 'var(--portal-accent-soft)', borderRadius: 5 }}>
              <div style={{ width: `${Math.max(2, Math.round((f.devices / max) * 100))}%`, height: '100%', background: GO, borderRadius: 5, transition: 'width 0.4s var(--ease-out)' }} />
            </div>
          </div>
        );
      })}
    </div>
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
  if (total === 0) {
    return <p style={{ fontSize: '0.75rem', color: MUTED }}>还没有反馈 — 今日卡出现后,用户点「有用/不准」会汇到这里。</p>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={38} outerRadius={56} paddingAngle={2} stroke="none">
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div>
        {data.map((d) => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: INK, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: d.color, display: 'inline-block' }} />
            {d.name} · {d.value}({Math.round((d.value / total) * 100)}%)
          </div>
        ))}
      </div>
    </div>
  );
}
