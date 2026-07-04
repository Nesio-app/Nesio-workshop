'use client';

/**
 * /admin — 管理员数据面板(只读,容器)。
 * 数据全部来自自己的 Supabase(经 /api/admin/metrics 服务端聚合),
 * 不依赖任何第三方分析服务。密钥存本机浏览器,随请求头发送。
 * 图表展示层在 ./MetricsCharts.tsx。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FeedbackDonut, FunnelSteps, TopEventsChart, TrendChart, type DailyPoint } from './MetricsCharts';

const SECRET_KEY = 'nesio_admin_secret';
const RANGES = [7, 14, 30] as const;
type RangeDays = (typeof RANGES)[number];

interface Metrics {
  ok: boolean;
  error?: string;
  hint?: string;
  generatedAt?: string;
  sources?: { telemetryEvents: { ok: boolean; error?: string; rows?: number }; productEvents: { ok: boolean; error?: string; rows?: number } };
  windows?: { today: { events: number; devices: number }; week: { events: number; devices: number }; month: { events: number; devices: number } };
  topEvents7d?: Array<{ name: string; count: number }>;
  daily30d?: DailyPoint[];
  funnel30d?: Array<{ step: string; devices: number }>;
  cardFeedback30d?: { useful: number; wrong: number; too_much: number; other: number };
  productEvents30d?: Array<{ type: string; count: number }>;
}

const card: React.CSSProperties = {
  background: 'var(--glass-bg-raised)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-lg)', padding: '1rem 1.1rem', boxShadow: 'var(--shadow-card)',
};
const label: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--portal-muted)', letterSpacing: '0.08em' };
const big: React.CSSProperties = { fontSize: '1.7rem', fontWeight: 700, color: 'var(--portal-ink)' };
const chip = (active: boolean): React.CSSProperties => ({
  padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-pill)', fontSize: '0.75rem', cursor: 'pointer',
  border: `1px solid ${active ? 'var(--portal-accent)' : 'var(--glass-border)'}`,
  background: active ? 'var(--portal-accent-soft-md)' : 'var(--glass-bg-solid)',
  color: active ? 'var(--portal-accent)' : 'var(--portal-muted)',
});

export default function AdminPage() {
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<RangeDays>(14);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (withSecret: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/metrics', { headers: withSecret ? { 'x-nesio-admin-secret': withSecret } : {} });
      const json = (await res.json()) as Metrics;
      setData(json);
      if (json.ok) { localStorage.setItem(SECRET_KEY, withSecret); setSaved(true); }
    } catch {
      setData({ ok: false, error: 'network_failed' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const s = localStorage.getItem(SECRET_KEY) || '';
    setSecret(s);
    setSaved(Boolean(s));
    void load(s);
  }, [load]);

  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh) {
      timerRef.current = setInterval(() => { void load(localStorage.getItem(SECRET_KEY) || ''); }, 60_000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, load]);

  const daily = (data?.daily30d || []).slice(-range);
  const rangeEvents = daily.reduce((s, d) => s + d.events, 0);
  const rangeDevices = Math.max(0, ...daily.map((d) => d.devices));

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '1.2rem 1rem 4rem', fontFamily: 'var(--font-sans)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: 'var(--text-h2)', color: 'var(--portal-ink)', margin: 0 }}>Nesio 数据面板</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          {RANGES.map((r) => (
            <button key={r} type="button" style={chip(range === r)} onClick={() => setRange(r)}>{r} 天</button>
          ))}
          <button type="button" style={chip(autoRefresh)} onClick={() => setAutoRefresh((v) => !v)}
            title="每 60 秒自动拉取">
            {autoRefresh ? '⟳ 自动中' : '⟳ 自动'}
          </button>
          <button type="button" style={chip(false)} onClick={() => void load(localStorage.getItem(SECRET_KEY) || '')} disabled={loading}>
            {loading ? '…' : '刷新'}
          </button>
        </div>
      </header>

      {/* ── 密钥 / 失败态 ── */}
      {data && !data.ok && (
        <section style={{ ...card, marginBottom: '1rem' }}>
          {data.error === 'admin_secret_required' || data.error === 'forbidden' ? (
            <>
              <p style={{ margin: '0 0 0.6rem', color: 'var(--portal-ink)' }}>输入管理密钥(NESIO_ADMIN_SECRET),只保存在本机浏览器。</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void load(secret); }}
                  placeholder="管理密钥"
                  style={{ flex: 1, padding: '0.55rem 0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)' }}
                />
                <button type="button" onClick={() => void load(secret)} disabled={loading || !secret.trim()}
                  style={{ padding: '0.55rem 1rem', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--portal-accent)', color: '#fff', cursor: 'pointer' }}>
                  {loading ? '验证中…' : '进入'}
                </button>
              </div>
              {saved && <p style={{ ...label, marginTop: '0.5rem' }}>已存的密钥未通过,可能已在服务端更换。</p>}
            </>
          ) : data.error === 'admin_not_configured' ? (
            <p style={{ margin: 0, color: 'var(--status-gentle)' }}>面板未激活:{data.hint}</p>
          ) : (
            <p style={{ margin: 0, color: 'var(--status-risk)' }}>加载失败({data.error}),请稍后重试。</p>
          )}
        </section>
      )}

      {loading && !data && <p style={label}>加载中…</p>}

      {data?.ok && (
        <>
          {/* ── 数据源健康 ── */}
          {(!data.sources?.telemetryEvents.ok || !data.sources?.productEvents.ok) && (
            <section style={{ ...card, marginBottom: '1rem', borderColor: 'var(--status-gentle)' }}>
              {!data.sources?.telemetryEvents.ok && (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--status-gentle)' }}>
                  telemetry_events 数据源不可用({data.sources?.telemetryEvents.error})
                  {data.sources?.telemetryEvents.error === 'table_missing' && ' — 需在 Supabase SQL Editor 建表(schema bundle 的 Telemetry events 段)'}
                </p>
              )}
              {!data.sources?.productEvents.ok && (
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--status-gentle)' }}>
                  product_events 数据源不可用({data.sources?.productEvents.error})
                  {data.sources?.productEvents.error === 'table_missing' && ' — 需在 Supabase SQL Editor 建表(schema bundle 的 Product events 段)'}
                </p>
              )}
            </section>
          )}

          {/* ── KPI 行 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            {([
              ['今日事件', data.windows?.today.events, `${data.windows?.today.devices ?? 0} 台设备`],
              [`${range} 天事件`, rangeEvents, '所选范围'],
              ['单日峰值设备', rangeDevices, `${range} 天内`],
              ['30 天设备', data.windows?.month.devices, `${data.windows?.month.events ?? 0} 事件`],
            ] as const).map(([name, value, sub]) => (
              <div key={name} style={card}>
                <p style={{ ...label, margin: '0 0 0.3rem' }}>{name}</p>
                <p style={{ ...big, margin: 0 }}>{value ?? 0}</p>
                <p style={{ ...label, margin: '0.2rem 0 0' }}>{sub}</p>
              </div>
            ))}
          </section>

          {/* ── 趋势 ── */}
          <section style={{ ...card, marginBottom: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <p style={{ ...label, margin: 0 }}>{range} 天趋势 — 事件(面积)/ 独立设备(线)</p>
              <span style={label}>{data.generatedAt ? `更新 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}` : ''}</span>
            </div>
            <TrendChart data={daily} />
          </section>

          {/* ── Top 事件 + 漏斗 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>Top 事件(7 天)</p>
              {(data.topEvents7d?.length ?? 0) === 0
                ? <p style={{ ...label }}>暂无数据 — 遥测刚接通,等它累积。</p>
                : <TopEventsChart data={data.topEvents7d!} />}
            </div>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>使用漏斗(30 天,按设备 · 百分比为相对上一步)</p>
              <FunnelSteps data={data.funnel30d || []} />
            </div>
          </section>

          {/* ── 反馈 + 产品事件 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.7rem' }}>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>今日卡反馈(30 天)— DEC 推荐质量</p>
              <FeedbackDonut
                useful={data.cardFeedback30d?.useful ?? 0}
                wrong={data.cardFeedback30d?.wrong ?? 0}
                tooMuch={data.cardFeedback30d?.too_much ?? 0}
              />
            </div>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>产品事件(30 天,已登录用户)</p>
              {(data.productEvents30d?.length ?? 0) === 0 && <p style={label}>暂无数据</p>}
              {data.productEvents30d?.map((e) => (
                <div key={e.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--portal-ink)', marginBottom: '0.35rem' }}>
                  <span>{e.type}</span><span>{e.count}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
