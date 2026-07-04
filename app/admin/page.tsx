'use client';

/**
 * /admin — 管理员数据面板(只读)。
 * 数据全部来自自己的 Supabase(经 /api/admin/metrics 服务端聚合),
 * 不依赖任何第三方分析服务。密钥存本机浏览器,随请求头发送。
 */

import { useEffect, useState } from 'react';

const SECRET_KEY = 'nesio_admin_secret';

interface Metrics {
  ok: boolean;
  error?: string;
  hint?: string;
  generatedAt?: string;
  sources?: { telemetryEvents: { ok: boolean; error?: string; rows?: number }; productEvents: { ok: boolean; error?: string; rows?: number } };
  windows?: { today: { events: number; devices: number }; week: { events: number; devices: number }; month: { events: number; devices: number } };
  topEvents7d?: Array<{ name: string; count: number }>;
  daily14d?: Array<{ date: string; events: number; devices: number }>;
  funnel30d?: Array<{ step: string; devices: number }>;
  cardFeedback30d?: { useful: number; wrong: number; too_much: number; other: number };
  productEvents30d?: Array<{ type: string; count: number }>;
}

const card: React.CSSProperties = {
  background: 'var(--glass-bg-raised)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-lg)', padding: '1rem 1.1rem', boxShadow: 'var(--shadow-card)',
};
const label: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--portal-muted)', letterSpacing: '0.08em' };
const big: React.CSSProperties = { fontSize: '1.6rem', fontWeight: 700, color: 'var(--portal-ink)' };

function Bar({ value, max, color = 'var(--portal-accent)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 6, background: 'var(--portal-accent-soft)', borderRadius: 3 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

export default function AdminPage() {
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem(SECRET_KEY) || '';
    setSecret(s);
    setSaved(Boolean(s));
  }, []);

  async function load(withSecret: string) {
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
  }

  useEffect(() => {
    const s = localStorage.getItem(SECRET_KEY) || '';
    void load(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxDaily = Math.max(1, ...(data?.daily14d?.map((d) => d.events) || [1]));
  const maxTop = Math.max(1, ...(data?.topEvents7d?.map((e) => e.count) || [1]));
  const maxFunnel = Math.max(1, ...(data?.funnel30d?.map((f) => f.devices) || [1]));

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '1.2rem 1rem 4rem', fontFamily: 'var(--font-sans)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: 'var(--text-h2)', color: 'var(--portal-ink)', margin: 0 }}>Nesio 数据面板</h1>
        <span style={label}>{data?.generatedAt ? `更新于 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}` : ''}</span>
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
                  {data.sources?.telemetryEvents.error === 'table_missing' && ' — 需在 Supabase SQL Editor 执行一次 database/schema/supabase-backend-v1-bundle.sql(2026-07-04 起含此表)'}
                </p>
              )}
              {!data.sources?.productEvents.ok && (
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--status-gentle)' }}>
                  product_events 数据源不可用({data.sources?.productEvents.error})
                </p>
              )}
            </section>
          )}

          {/* ── 窗口统计 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.7rem', marginBottom: '1rem' }}>
            {([['今日', data.windows?.today], ['7 天', data.windows?.week], ['30 天', data.windows?.month]] as const).map(([name, w]) => (
              <div key={name} style={card}>
                <p style={{ ...label, margin: '0 0 0.3rem' }}>{name}</p>
                <p style={{ ...big, margin: 0 }}>{w?.events ?? 0}</p>
                <p style={{ ...label, margin: '0.2rem 0 0' }}>事件 · {w?.devices ?? 0} 台设备</p>
              </div>
            ))}
          </section>

          {/* ── 14 天趋势 ── */}
          <section style={{ ...card, marginBottom: '1rem' }}>
            <p style={{ ...label, margin: '0 0 0.6rem' }}>14 天事件趋势</p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
              {data.daily14d?.map((d) => (
                <div key={d.date} title={`${d.date}:${d.events} 事件 / ${d.devices} 设备`}
                  style={{ flex: 1, height: `${Math.max(3, Math.round((d.events / maxDaily) * 100))}%`, background: 'var(--portal-accent)', opacity: d.events ? 0.9 : 0.25, borderRadius: 2 }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={label}>{data.daily14d?.[0]?.date.slice(5)}</span>
              <span style={label}>{data.daily14d?.[data.daily14d.length - 1]?.date.slice(5)}</span>
            </div>
          </section>

          {/* ── Top 事件 + 漏斗 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.7rem', marginBottom: '1rem' }}>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>Top 事件(7 天)</p>
              {(data.topEvents7d?.length ?? 0) === 0 && <p style={label}>暂无数据 — 遥测刚接通,等它累积。</p>}
              {data.topEvents7d?.map((e) => (
                <div key={e.name} style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--portal-ink)' }}>
                    <span>{e.name}</span><span>{e.count}</span>
                  </div>
                  <Bar value={e.count} max={maxTop} />
                </div>
              ))}
            </div>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>使用漏斗(30 天,按设备)</p>
              {data.funnel30d?.map((f) => (
                <div key={f.step} style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--portal-ink)' }}>
                    <span>{f.step}</span><span>{f.devices}</span>
                  </div>
                  <Bar value={f.devices} max={maxFunnel} color="var(--status-go)" />
                </div>
              ))}
            </div>
          </section>

          {/* ── 反馈 + 产品事件 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.7rem' }}>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>今日卡反馈(30 天)</p>
              <div style={{ display: 'flex', gap: '1.2rem' }}>
                {([['有用', data.cardFeedback30d?.useful, 'var(--status-go)'], ['不准', data.cardFeedback30d?.wrong, 'var(--status-gentle)'], ['不再提醒', data.cardFeedback30d?.too_much, 'var(--portal-muted)']] as const).map(([n, v, c]) => (
                  <div key={n}>
                    <p style={{ ...big, margin: 0, fontSize: '1.2rem', color: c }}>{v ?? 0}</p>
                    <p style={{ ...label, margin: 0 }}>{n}</p>
                  </div>
                ))}
              </div>
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
