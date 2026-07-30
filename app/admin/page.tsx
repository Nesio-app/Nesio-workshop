'use client';

/**
 * /admin — 管理员数据面板(只读,容器)。
 * 数据全部来自自己的 Supabase(经 /api/admin/metrics 服务端聚合),
 * 不依赖任何第三方分析服务。密钥存本机浏览器,随请求头发送。
 * 图表展示层在 ./MetricsCharts.tsx。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Delta, FeedbackDonut, FunnelSteps, InsightCard, SmartnessRadar, TopEventsChart, TrendChart, type DailyPoint } from './MetricsCharts';
import { telemetryLabel } from '@/lib/portal/telemetry-labels';
import { UserAccess } from './UserAccess';
import { GovernancePanel } from './GovernancePanel';
import { AnalystCard } from './AnalystCard';

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
  ai?: { totals: { calls: number; estCostUsd: number; measuredCostUsd?: number; measuredCalls?: number; okRate: number | null; avgLatencyMs: number | null }; routes: Array<{ route: string; calls: number; okRate: number; avgLatencyMs: number; estCostUsd: number; measuredCalls?: number; measuredCostUsd?: number }> };
  smartness?: { score: number; dims: Array<{ dim: string; score: number; thin: boolean }> };
  clientErrors?: Array<{ kind: string; message: string; source?: string; count: number; devices: number; lastAt: string; firstAt?: string }>;
  roadmapVotes?: Array<{ id: string; title: string; status: string; avg: number | null; count: number }>;
  experiments?: Array<{ id: string; name: string; enabled: boolean; variants: Array<{ variant: string; devices: number }> }>;
  cardFeedback30d?: { useful: number; wrong: number; too_much: number; other: number };
  productEvents30d?: Array<{ type: string; count: number }>;
}

/**
 * 报错 → 下一步该看哪里(Bug4 图15「点开后要说怎么修」)。
 *
 * 只按**报错自己的形态**给方向,不猜业务原因 —— 说得出「先看哪里」就够,
 * 说不出就如实说「按出错文件定位」,不编。顺序:具体形态优先,kind 兜底。
 */
function fixHint(kind: string, message: string): string {
  const m = message.toLowerCase();
  if (/loading chunk|chunkloaderror|dynamically imported module/.test(m)) {
    return '换版后旧页面去拿旧构建的分包了。用户刷新即好;要根治就在发版后提示刷新(检测 buildSha 变化)。';
  }
  if (/quotaexceeded|exceeded the quota|storage.*full/.test(m)) {
    return '本机存储写满了。看 storage-manifest 的分类是否有该判 cache 的键被当成 durable 一直堆;storage-health 的告警事件也应该已经弹给用户了。';
  }
  if (/load failed|failed to fetch|networkerror|network request failed|aborted/.test(m)) {
    return '请求没回来(超时 / 离线 / 接口 5xx)。先在上面「AI 调用与成本」表里看同期哪条路由成功率掉了;若都正常,多半是用户网络,确认那次调用有失败 UI 而不是静默转圈。';
  }
  if (/cannot read propert|undefined is not an object|null is not an object|of undefined|of null/.test(m)) {
    return '取了空值上的字段。按下面的出错文件定位;这类多半是同步回来的数据缺字段 —— 检查该处有没有对可选字段做兜底。';
  }
  if (/json|unexpected token .* in json|parse/.test(m)) {
    return '解析返回体失败 —— 接口回的不是预期 JSON(常见是网关的 HTML 错误页)。在那个 fetch 处加非 200 分支,别直接 .json()。';
  }
  if (kind === 'boundary') {
    return '组件渲染时抛了异常,被错误边界兜住。按出错文件定位那个组件;渲染期抛错基本都是坏数据进了渲染层。';
  }
  if (kind === 'rejection') {
    return '有个 Promise 没人 catch。按出错文件定位,给它补 catch 并落一个可见的失败态(仓库红线:异步动作必须有可见失败态)。';
  }
  return '按下面的「出错文件」定位;再用「第一次出现」的时间对一下是哪次发版引入的。';
}

/** 产品事件的人话名(Bug4 图14)。没登记的照原样印,不猜、不硬翻。 */
const PRODUCT_EVENT_LABEL: Record<string, string> = {
  'today.card.feedback': '给今日卡打了反馈',
  'feature.wish': '给未来功能投了票',
  'plan.notify_optin': '打开了提醒推送',
};

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
  const [errOpen, setErrOpen] = useState<string | null>(null); // 展开中的客户端错误(Bug4 图15)
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Bug4 图13:这一页原本是条单行道 —— 进来之后既没有返回,也没法退出登录,
              只能靠浏览器后退或手动改地址栏。左边给「回 App」,右边给「退出」。 */}
          <a href="/" style={{ ...chip(false), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>‹ 回 App</a>
          <h1 style={{ fontSize: 'var(--text-h2)', color: 'var(--portal-ink)', margin: 0 }}>Nesio 数据面板</h1>
        </div>
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
          {data?.ok && (
            <button
              type="button"
              style={{ ...chip(false), color: 'var(--status-risk)', borderColor: 'var(--status-risk)' }}
              title="清掉本机存的管理密钥"
              onClick={() => {
                localStorage.removeItem(SECRET_KEY);
                setSecret(''); setSaved(false); setData(null);
                setData({ ok: false, error: 'admin_secret_required' });
              }}
            >
              退出
            </button>
          )}
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

          {/* ── 分析师日报(替你读整个面板:精简要点 + 重要预警) ── */}
          <AnalystCard secret={typeof window !== 'undefined' ? localStorage.getItem(SECRET_KEY) || '' : ''} />

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
              {/* Bug4 图17:图例原来是「事件/设备/上一周期」三个内部词,看图的人得先翻译一遍。 */}
              <p style={{ ...label, margin: 0 }}>最近 {range} 天 — 蓝色面积 = 用了多少次 · 绿线 = 多少台设备在用 · 灰虚线 = 上一个 {range} 天</p>
              <span style={label}>{data.generatedAt ? `更新 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}` : ''}</span>
            </div>
            <TrendChart data={daily} prev={prevDaily.length === daily.length ? prevDaily : undefined} />
          </section>

          {/* ── Top 事件 + 漏斗 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>用得最多的动作(7 天)</p>
              {(data.topEvents7d?.length ?? 0) === 0
                ? <p style={{ ...label }}>暂无数据 — 遥测刚接通,等它累积。</p>
                : <TopEventsChart data={data.topEvents7d!.map((e) => ({ ...e, name: telemetryLabel(e.name) }))} />}
            </div>
            <div style={card}>
              <p style={{ ...label, margin: '0 0 0.6rem' }}>一路走到哪一步(30 天,按设备算 · 百分比是「上一步里还剩多少人」)</p>
              {/* Bug4 图17「事件说人话」:漏斗的每一级也是原始事件名,一并过表。 */}
              <FunnelSteps data={(data.funnel30d || []).map((f) => ({ ...f, step: telemetryLabel(f.step) }))} />
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
              <p style={{ ...label, margin: '0 0 0.2rem' }}>
                AI 调用与成本(30 天)
                {data.ai && <span style={{ marginLeft: 8, color: 'var(--portal-ink)' }}>共 {data.ai.totals.calls} 次 · ≈ ${data.ai.totals.estCostUsd}</span>}
              </p>
              {/* Bug4 图18:「量级估算」是一句免责声明,不是信息 —— 直接说清有几成是真价。 */}
              {data.ai && data.ai.totals.calls > 0 && (
                <p style={{ ...label, margin: '0 0 0.4rem', letterSpacing: 0 }}>
                  其中 {Math.round(((data.ai.totals.measuredCalls ?? 0) / data.ai.totals.calls) * 100)}% 的调用带回了真实 token 价(${data.ai.totals.measuredCostUsd ?? 0}),
                  其余按每路由拍平单价估;带 ≈ 的行含估算成分。延迟只算真报了耗时的调用。
                </p>
              )}
              {(data.ai?.routes.length ?? 0) === 0
                ? <p style={label}>暂无 AI 调用记录 — 服务端落库 2026-07-04 接通,用一次听简报/问一问就有了。</p>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ minWidth: 420 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.8fr 0.7fr', fontSize: '0.68rem', color: 'var(--portal-muted)', padding: '0 0 0.3rem' }}>
                      <span>路由</span><span>次数</span><span>成功</span><span>延迟</span><span>花费</span>
                    </div>
                    {data.ai!.routes.map((r) => {
                      const allMeasured = (r.measuredCalls ?? 0) >= r.calls;
                      return (
                      <div key={r.route} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.8fr 0.7fr', fontSize: '0.76rem', color: 'var(--portal-ink)', padding: '0.22rem 0', borderTop: '1px solid var(--portal-line)' }}>
                        <span>{r.route}</span>
                        <span>{r.calls}</span>
                        <span style={{ color: r.okRate >= 95 ? 'var(--status-go)' : r.okRate >= 85 ? 'var(--status-gentle)' : 'var(--status-risk)' }}>{r.okRate}%</span>
                        <span>{r.avgLatencyMs}ms</span>
                        <span title={allMeasured ? '全部按真实 token 价' : `${r.measuredCalls ?? 0}/${r.calls} 次有真实价,其余为估算`}>{allMeasured ? '' : '≈'}${r.estCostUsd}</span>
                      </div>
                      );
                    })}
                    </div>
                  </div>
                )}
            </div>
          </section>

          {/* ── 功能许愿(Roadmap 评分)+ 实验 ── */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
            <div style={card}>
              {/* Bug4 图16:榜单是死是活看不出来 —— 补一句数据从哪来、★ 和「待投票」各是什么意思。 */}
              <p style={{ ...label, margin: '0 0 0.2rem' }}>功能许愿榜</p>
              <p style={{ ...label, margin: '0 0 0.6rem', letterSpacing: 0 }}>
                候选功能写在 lib/portal/roadmap.ts 里(改代码才增删);★ 分和票数是真实用户票,
                来自「设置 → 投票给未来功能」,一人一功能一票、可改。写「待投票」= 这条还一票没有。
              </p>
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
              {/* Bug4 图15:原来只写了「注册表在哪个文件」,看的人不知道这块在说什么。 */}
              <p style={{ ...label, margin: '0 0 0.2rem' }}>A/B 实验</p>
              {/* Bug4 图15 上写的是「怎么用」——不是「是什么」。所以这里写的是**步骤**。 */}
              <p style={{ ...label, margin: '0 0 0.6rem', letterSpacing: 0 }}>
                同一个功能做两版、按设备随机分,用来判断哪一版更好。怎么用:
                ① 在 <code>lib/portal/experiments.ts</code> 里加一条(id / 名字 / 变体名 / enabled),登记即生效;
                ② 代码里用 <code>getVariant(&apos;实验id&apos;)</code> 取这台设备分到哪一版,按它渲染,
                并在真正露出时调一次 <code>trackExposure(&apos;实验id&apos;)</code> —— 不埋曝光,下面的设备数就是空的;
                ③ 回这里看各版本分到多少台设备 —— 分得太偏(比如 9:1)结果就不能信,先等样本;
                ④ 看效果不在这张表,看上面的「一路走到哪一步」和「今日卡反馈」在实验期间有没有分化;
                ⑤ 定了就把输的那版从代码里删掉,别把 enabled 关了留着 —— 留着就是下一个人的坑。
              </p>
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
            <p style={{ ...label, margin: '0 0 0.2rem' }}>用户那边报的错(30 天)</p>
            <p style={{ ...label, margin: '0 0 0.5rem', letterSpacing: 0 }}>
              用户浏览器崩了会自动送一条过来(只送报错文字和文件名,不带任何个人数据)。点一行看全文。
            </p>
            {(data.clientErrors?.length ?? 0) === 0
              ? <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--status-go)' }}>✓ 没有错误上报 — 用户端一切干净。</p>
              : data.clientErrors!.map((e) => {
                const sig = `${e.kind}:${e.message}`;
                const open = errOpen === sig;
                return (
                  <div key={sig} style={{ padding: '0.35rem 0', borderTop: '1px solid var(--portal-line)', fontSize: '0.76rem' }}>
                    {/* Bug4 图15:一行截断的报错等于没有报错 —— 点开给全文 + 出错文件 + 第一次出现。 */}
                    <button
                      type="button"
                      onClick={() => setErrOpen(open ? null : sig)}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                    >
                      <span style={{ color: 'var(--portal-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--status-risk)', marginRight: 6 }}>{e.kind}</span>{e.message}
                      </span>
                      <span style={{ color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>×{e.count} · {e.devices} 台 · {e.lastAt.slice(5, 16).replace('T', ' ')}</span>
                    </button>
                    {open && (
                      <div style={{ marginTop: '0.4rem', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', background: 'var(--portal-accent-soft)' }}>
                        <p style={{ margin: 0, color: 'var(--portal-ink)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{e.message}</p>
                        {e.source && <p style={{ ...label, margin: '0.35rem 0 0', letterSpacing: 0, wordBreak: 'break-all' }}>出错文件:{e.source}</p>}
                        <p style={{ ...label, margin: '0.2rem 0 0', letterSpacing: 0 }}>
                          第一次 {e.firstAt ? e.firstAt.slice(0, 16).replace('T', ' ') : '—'} · 最近一次 {e.lastAt.slice(0, 16).replace('T', ' ')} · 影响 {e.devices} 台设备
                        </p>
                        {/* Bug4 图15「点开后要说怎么修」:光有报错文字还是要人自己去猜从哪下手。
                            按报错的形态给一条**下一步**,不是给答案 —— 说得出「先看哪里」就够了。 */}
                        {(() => {
                          const fix = fixHint(e.kind, e.message);
                          return (
                            <p style={{ margin: '0.45rem 0 0', fontSize: '0.76rem', color: 'var(--portal-ink)', lineHeight: 1.6 }}>
                              <b style={{ color: 'var(--portal-accent)' }}>怎么修</b> · {fix}
                            </p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
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
              <p style={{ ...label, margin: '0 0 0.6rem' }}>用户主动做的事(30 天,已登录用户)</p>
              {(data.productEvents30d?.length ?? 0) === 0 && <p style={label}>暂无数据</p>}
              {data.productEvents30d?.map((e) => (
                <div key={e.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--portal-ink)', marginBottom: '0.35rem' }}>
                  {/* Bug4 图14:原来直接印内部事件名(today.card.feedback…),看板的人得先认代码。 */}
                  <span title={e.type}>{PRODUCT_EVENT_LABEL[e.type] || e.type}</span><span>{e.count}</span>
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
          {/* ── 软件治理地图 ── */}
          <section style={{ marginTop: '0.9rem' }}>
            <p style={{ ...label, margin: '0 0 0.2rem' }}>软件治理</p>
            <p style={{ ...label, margin: '0 0 0.4rem' }}>
              契约/就绪层的运行状态:哪些真在跑、哪些算了没人看、哪个已漂移。数据来自 governance-map + 构建期快照。
            </p>
            <GovernancePanel secret={typeof window !== 'undefined' ? localStorage.getItem(SECRET_KEY) || '' : ''} />
          </section>
        </>
      )}
    </main>
  );
}
