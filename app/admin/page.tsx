'use client';

/**
 * /admin — 管理员数据面板(只读,容器)。
 * 数据全部来自自己的 Supabase(经 /api/admin/metrics 服务端聚合),
 * 不依赖任何第三方分析服务。密钥存本机浏览器,随请求头发送。
 * 图表展示层在 ./MetricsCharts.tsx。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Delta, FeedbackDonut, FunnelSteps, InsightCard, SmartnessRadar, TopEventsChart, TrendChart, type DailyPoint } from './MetricsCharts';
import { UserAccess } from './UserAccess';

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
  insights?: Array<{ severity: 'go' | 'gentle' | 'risk'; title: string; detail: string; advice: string }>;
  deltas?: { todayVsYesterday: number | null; weekVsPrevWeek: number | null };
  topEvents7d?: Array<{ name: string; count: number }>;
  daily60d?: DailyPoint[];
  funnel30d?: Array<{ step: string; devices: number }>;
  ai?: { totals: { calls: number; estCostUsd: number; okRate: number | null; avgLatencyMs: number | null }; routes: Array<{ route: string; calls: number; okRate: number; avgLatencyMs: number; estCostUsd: number }> };
  smartness?: { score: number; dims: Array<{ dim: string; score: number; thin: boolean }> };
  clientErrors?: Array<{ kind: string; message: string; count: number; devices: number; lastAt: string }>;
  roadmapVotes?: Array<{ id: string; title: string; status: string; avg: number | null; count: number }>;
  experiments?: Array<{ id: string; name: string; enabled: boolean; variants: Array<{ variant: string; devices: number }> }>;
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
  whiteSpace: 'nowrap',
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

  function exportCsv() {
    if (!data?.ok) return;
    const lines: string[] = [];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    lines.push('# Nesio 数据导出,' + new Date().toISOString());
    lines.push('');
    lines.push('## 每日趋势');
    lines.push('date,events,devices');
    for (const d of data.daily60d || []) lines.push(`${d.date},${d.events},${d.devices}`);
    lines.push('');
    lines.push('## Top 事件(7天)');
    lines.push('event,count');
    for (const e of data.topEvents7d || []) lines.push(`${esc(e.name)},${e.count}`);
    lines.push('');
    lines.push('## AI 调用(30天)');
    lines.push('route,calls,ok_rate,avg_latency_ms,est_cost_usd');
    for (const r of data.ai?.routes || []) lines.push(`${esc(r.route)},${r.calls},${r.okRate},${r.avgLatencyMs},${r.estCostUsd}`);
    lines.push('');
    lines.push('## 功能许愿榜');
    lines.push('feature,status,avg,votes');
    for (const v of data.roadmapVotes || []) lines.push(`${esc(v.title)},${v.status},${v.avg ?? ''},${v.count}`);
    lines.push('');
    lines.push('## 客户端错误(30天)');
    lines.push('kind,message,count,devices,last_at');
    for (const e of data.clientErrors || []) lines.push(`${esc(e.kind)},${esc(e.message)},${e.count},${e.devices},${e.lastAt}`);
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nesio-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const all = data?.daily60d || [];
  const daily = all.slice(-range);
  const prevDaily = all.slice(-range * 2, -range);
  const rangeEvents = daily.reduce((s, d) => s + d.events, 0);
  const rangeDevices = Math.max(0, ...daily.map((d) => d.devices));

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '1.2rem 1rem 4rem', fontFamily: 'var(--font-sans)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: 'var(--text-h2)', color: 'var(--portal-ink)', margin: 0 }}>Nesio 数据面板</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
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
          <button type="button" style={chip(false)} onClick={exportCsv} disabled={!data?.ok} title="导出全部数据为 CSV(Excel 可直接打开)">
            ⤓ CSV
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

          {/* ── 洞察与建议(规则引擎替你先看一遍) ── */}
          <section style={{ marginBottom: '0.9rem' }}>
            <p style={{ ...label, margin: '0 0 0.5rem' }}>洞察与建议</p>
            {data.insights?.map((ins) => <InsightCard key={ins.title} {...ins} />)}
          </section>

          {/* ── KPI 行 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            {([
              ['今日事件', data.windows?.today.events, `${data.windows?.today.devices ?? 0} 台设备`, data.deltas?.todayVsYesterday],
              ['7 天事件', data.windows?.week.events, '对比前 7 天', data.deltas?.weekVsPrevWeek],
              ['单日峰值设备', rangeDevices, `${range} 天内`, null],
              ['30 天设备', data.windows?.month.devices, `${data.windows?.month.events ?? 0} 事件`, null],
            ] as const).map(([name, value, sub, delta]) => (
              <div key={name} style={card}>
                <p style={{ ...label, margin: '0 0 0.3rem' }}>{name}</p>
                <p style={{ ...big, margin: 0 }}>{value ?? 0}<Delta value={delta} /></p>
                <p style={{ ...label, margin: '0.2rem 0 0' }}>{sub}</p>
              </div>
            ))}
          </section>

          {/* ── 趋势 ── */}
          <section style={{ ...card, marginBottom: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <p style={{ ...label, margin: 0 }}>{range} 天趋势 — 事件(面积)/ 设备(绿线)/ 上一周期(灰虚线)</p>
              <span style={label}>{data.generatedAt ? `更新 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}` : ''}</span>
            </div>
            <TrendChart data={daily} prev={prevDaily.length === daily.length ? prevDaily : undefined} />
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

          {/* ── 聪明度 + AI 成本 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p style={{ ...label, margin: 0 }}>聪明度(30 天,带·的维度样本不足按 50 中性)</p>
                <span style={{ ...big, fontSize: '1.4rem', color: (data.smartness?.score ?? 0) >= 70 ? 'var(--status-go)' : (data.smartness?.score ?? 0) >= 50 ? 'var(--status-gentle)' : 'var(--status-risk)' }}>{data.smartness?.score ?? '—'}</span>
              </div>
              {data.smartness && <SmartnessRadar dims={data.smartness.dims} />}
            </div>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.4rem' }}>
                AI 调用与成本(30 天,成本为量级估算)
                {data.ai && <span style={{ marginLeft: 8, color: 'var(--portal-ink)' }}>共 {data.ai.totals.calls} 次 · ≈ ${data.ai.totals.estCostUsd}</span>}
              </p>
              {(data.ai?.routes.length ?? 0) === 0
                ? <p style={label}>暂无 AI 调用记录 — 服务端落库 2026-07-04 接通,用一次听简报/问一问就有了。</p>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ minWidth: 420 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.8fr 0.7fr', fontSize: '0.68rem', color: 'var(--portal-muted)', padding: '0 0 0.3rem' }}>
                      <span>路由</span><span>次数</span><span>成功</span><span>延迟</span><span>估算</span>
                    </div>
                    {data.ai!.routes.map((r) => (
                      <div key={r.route} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.8fr 0.7fr', fontSize: '0.76rem', color: 'var(--portal-ink)', padding: '0.22rem 0', borderTop: '1px solid var(--portal-line)' }}>
                        <span>{r.route}</span>
                        <span>{r.calls}</span>
                        <span style={{ color: r.okRate >= 95 ? 'var(--status-go)' : r.okRate >= 85 ? 'var(--status-gentle)' : 'var(--status-risk)' }}>{r.okRate}%</span>
                        <span>{r.avgLatencyMs}ms</span>
                        <span>${r.estCostUsd}</span>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
            </div>
          </section>

          {/* ── 功能许愿(Roadmap 评分)+ 实验 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>功能许愿榜(用户在设置 → 投票给未来功能 里打分)</p>
              {data.roadmapVotes?.map((v) => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderTop: '1px solid var(--portal-line)', fontSize: '0.78rem', color: 'var(--portal-ink)' }}>
                  <span>
                    {v.title}
                    <span style={{ ...label, marginLeft: 6 }}>{v.status === 'building' ? '在做' : v.status === 'planned' ? '已排期' : '探索中'}</span>
                  </span>
                  <span>{v.avg !== null ? `★ ${v.avg}(${v.count} 票)` : '待投票'}</span>
                </div>
              ))}
            </div>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>A/B 实验(代码注册表 lib/portal/experiments.ts,注册即用)</p>
              {(data.experiments?.length ?? 0) === 0 && <p style={label}>暂无注册实验</p>}
              {data.experiments?.map((e) => (
                <div key={e.id} style={{ padding: '0.3rem 0', borderTop: '1px solid var(--portal-line)' }}>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--portal-ink)' }}>
                    {e.name}
                    <span style={{ ...label, marginLeft: 6, color: e.enabled ? 'var(--status-go)' : 'var(--portal-muted)' }}>{e.enabled ? '运行中' : '未启用'}</span>
                  </p>
                  <p style={{ ...label, margin: '0.15rem 0 0' }}>
                    {e.variants.map((v) => `${v.variant}: ${v.devices} 设备`).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 客户端错误(错误自己来找你) ── */}
          <section style={{ ...card, marginBottom: '0.9rem', ...(data.clientErrors?.length ? { borderColor: 'var(--status-risk)' } : {}) }}>
            <p style={{ ...label, margin: '0 0 0.5rem' }}>客户端错误(30 天,来自用户浏览器的自动上报)</p>
            {(data.clientErrors?.length ?? 0) === 0
              ? <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--status-go)' }}>✓ 没有错误上报 — 用户端一切干净。</p>
              : data.clientErrors!.map((e) => (
                <div key={`${e.kind}:${e.message}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', padding: '0.35rem 0', borderTop: '1px solid var(--portal-line)', fontSize: '0.76rem' }}>
                  <span style={{ color: 'var(--portal-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--status-risk)', marginRight: 6 }}>{e.kind}</span>{e.message}
                  </span>
                  <span style={{ color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>×{e.count} · {e.devices} 台 · {e.lastAt.slice(5, 16).replace('T', ' ')}</span>
                </div>
              ))}
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
          {/* ── 用户权限管理 ── */}
          <section style={{ ...card, marginTop: '0.9rem' }}>
            <p style={{ ...label, margin: '0 0 0.2rem' }}>用户权限管理</p>
            <p style={{ ...label, margin: '0 0 0.7rem' }}>
              角色:普通=公开功能;测试员=+下方勾选模块;Lab=全部实验功能与 secretary。改动即存,用户下次打开 App 生效。
            </p>
            <UserAccess secret={typeof window !== 'undefined' ? localStorage.getItem(SECRET_KEY) || '' : ''} />
          </section>
        </>
      )}
    </main>
  );
}
