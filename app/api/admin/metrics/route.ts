/**
 * GET /api/admin/metrics — 管理员数据面板的聚合只读 API。
 *
 * 数据源(都在自己的 Supabase,不出境):
 *   - telemetry_events:匿名设备级事件计数(schema bundle 2026-07-04 补表)
 *   - product_events:用户确认过的反馈/交互(今日卡反馈等)
 *
 * 门禁:同源 + x-nesio-admin-secret 匹配 NESIO_ADMIN_SECRET + 限流。
 * 无 Supabase 的本地部署直接放行(与 UI 同宽)。聚合在服务端完成,
 * 只回统计数字,不回原始行。
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest, isRateLimited } from '@/lib/portal/api-auth';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { ROADMAP_ITEMS } from '@/lib/portal/roadmap';
import { EXPERIMENTS } from '@/lib/portal/experiments';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface TelemetryRow { name: string; device_id: string; at: string; props?: Record<string, unknown> }
interface ProductEventRow { event_type: string; feedback: string | null; target_type: string | null; created_at: string }

async function supabaseSelect<T>(path: string): Promise<{ rows: T[]; error?: string }> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!url || !key) return { rows: [], error: 'cloud_not_configured' };
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (res.status === 404) return { rows: [], error: 'table_missing' };
    if (!res.ok) return { rows: [], error: `http_${res.status}` };
    return { rows: (await res.json()) as T[] };
  } catch {
    return { rows: [], error: 'fetch_failed' };
  }
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function GET(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (isRateLimited(req, 'admin_metrics', { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const hasSupabase = Boolean(envValue('SUPABASE_URL') && envValue('SUPABASE_ANON_KEY'));
  if (hasSupabase) {
    const secret = envValue('NESIO_ADMIN_SECRET');
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: 'admin_not_configured', hint: 'Vercel 环境变量设置 NESIO_ADMIN_SECRET 后重新部署' },
        { status: 503 },
      );
    }
    const provided = req.headers.get('x-nesio-admin-secret')?.trim() || '';
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: 'admin_secret_required' }, { status: 401 });
    }
  }

  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [telemetry, product, votes] = await Promise.all([
    supabaseSelect<TelemetryRow>(
      `telemetry_events?select=name,device_id,at,props&at=gte.${since60}&order=at.desc&limit=10000`,
    ),
    supabaseSelect<ProductEventRow>(
      `product_events?select=event_type,feedback,target_type,created_at&created_at=gte.${since30}&order=created_at.desc&limit=2000`,
    ),
    supabaseSelect<{ feature_id: string; score: number }>(
      'feature_votes?select=feature_id,score&limit=5000',
    ),
  ]);

  // ── 聚合:总量/独立设备(今日、7 天、30 天) ──
  const now = Date.now();
  const cut = (days: number) => now - days * 86_400_000;
  const windowStats = (days: number) => {
    const rows = telemetry.rows.filter((r) => new Date(r.at).getTime() >= cut(days));
    return { events: rows.length, devices: new Set(rows.map((r) => r.device_id)).size };
  };

  // ── 按事件名计数(7 天) ──
  const byName7 = new Map<string, number>();
  for (const r of telemetry.rows) {
    if (new Date(r.at).getTime() < cut(7)) continue;
    byName7.set(r.name, (byName7.get(r.name) || 0) + 1);
  }

  // ── 每日趋势(60 天:后 30 天供展示,前 30 天供环比虚线) ──
  const daily = new Map<string, { events: number; devices: Set<string> }>();
  for (let i = 59; i >= 0; i -= 1) {
    daily.set(dayKey(new Date(now - i * 86_400_000).toISOString()), { events: 0, devices: new Set() });
  }
  for (const r of telemetry.rows) {
    const d = daily.get(dayKey(r.at));
    if (d) { d.events += 1; d.devices.add(r.device_id); }
  }

  // ── Onboarding/激活漏斗(30 天,按设备去重) ──
  const funnelSteps = ['app_open', 'brief_play', 'mood_open', 'capture_voice_open', 'chat_send'];
  const devicesByEvent = new Map<string, Set<string>>();
  for (const r of telemetry.rows) {
    if (!devicesByEvent.has(r.name)) devicesByEvent.set(r.name, new Set());
    devicesByEvent.get(r.name)!.add(r.device_id);
  }
  const funnel = funnelSteps.map((step) => ({ step, devices: devicesByEvent.get(step)?.size || 0 }));

  // ── 今日卡反馈(product_events,30 天) ──
  const feedback = { useful: 0, wrong: 0, too_much: 0, other: 0 };
  for (const r of product.rows) {
    if (r.event_type !== 'today.card.feedback') continue;
    if (r.feedback === 'useful') feedback.useful += 1;
    else if (r.feedback === 'wrong') feedback.wrong += 1;
    else if (r.feedback === 'too_much') feedback.too_much += 1;
    else feedback.other += 1;
  }
  const productByType = new Map<string, number>();
  for (const r of product.rows) productByType.set(r.event_type, (productByType.get(r.event_type) || 0) + 1);

  // ── AI 调用统计与成本估算(server ai_route 事件,30 天) ──
  // 单价是量级估算(美元/次),用于看趋势与占比,不是账单。
  const COST_PER_CALL: Record<string, number> = {
    chat: 0.004, daily_brief: 0.001, tts: 0.015, analyze: 0.002,
    guidance_language: 0.001, insights: 0.002, narrative: 0.002,
  };
  const aiByRoute = new Map<string, { calls: number; okCalls: number; latencySum: number }>();
  for (const r of telemetry.rows) {
    if (r.name !== 'ai_route' || new Date(r.at).getTime() < cut(30)) continue;
    const p = (r.props || {}) as { route?: string; ok?: boolean; latency_ms?: number };
    const route = typeof p.route === 'string' ? p.route : 'unknown';
    if (!aiByRoute.has(route)) aiByRoute.set(route, { calls: 0, okCalls: 0, latencySum: 0 });
    const a = aiByRoute.get(route)!;
    a.calls += 1;
    if (p.ok === true) a.okCalls += 1;
    a.latencySum += typeof p.latency_ms === 'number' ? p.latency_ms : 0;
  }
  const aiRoutes = [...aiByRoute.entries()].map(([route, a]) => ({
    route,
    calls: a.calls,
    okRate: Math.round((a.okCalls / Math.max(1, a.calls)) * 100),
    avgLatencyMs: Math.round(a.latencySum / Math.max(1, a.calls)),
    estCostUsd: Math.round(a.calls * (COST_PER_CALL[route] ?? 0.002) * 1000) / 1000,
  })).sort((x, y) => y.estCostUsd - x.estCostUsd);
  const aiTotals = {
    calls: aiRoutes.reduce((sum, r) => sum + r.calls, 0),
    estCostUsd: Math.round(aiRoutes.reduce((sum, r) => sum + r.estCostUsd, 0) * 1000) / 1000,
    okRate: aiRoutes.length ? Math.round(aiRoutes.reduce((sum, r) => sum + r.okRate * r.calls, 0) / Math.max(1, aiRoutes.reduce((sum, r) => sum + r.calls, 0))) : null,
    avgLatencyMs: aiRoutes.length ? Math.round(aiRoutes.reduce((sum, r) => sum + r.avgLatencyMs * r.calls, 0) / Math.max(1, aiRoutes.reduce((sum, r) => sum + r.calls, 0))) : null,
  };

  // ── 聪明度(0-100 五维,样本不足的维度按 50 中性并标注) ──
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const fbTotalForSmart = feedback.useful + feedback.wrong + feedback.too_much;
  const funnelStart = funnel[0]?.devices || 0;
  const funnelEnd = funnel[funnel.length - 1]?.devices || 0;
  const smartness = {
    dims: [
      { dim: '推荐有用率', score: fbTotalForSmart >= 3 ? clamp((feedback.useful / fbTotalForSmart) * 100) : 50, thin: fbTotalForSmart < 3 },
      { dim: 'AI 可用性', score: aiTotals.okRate ?? 50, thin: aiTotals.okRate === null },
      { dim: '响应速度', score: aiTotals.avgLatencyMs === null ? 50 : clamp(100 - (aiTotals.avgLatencyMs - 800) / 40), thin: aiTotals.avgLatencyMs === null },
      { dim: '功能走通率', score: funnelStart >= 3 ? clamp((funnelEnd / funnelStart) * 100) : 50, thin: funnelStart < 3 },
      { dim: '反馈参与度', score: windowStats(30).devices >= 3 ? clamp((fbTotalForSmart / Math.max(1, windowStats(30).devices)) * 100) : 50, thin: windowStats(30).devices < 3 },
    ],
  };
  const smartScore = Math.round(smartness.dims.reduce((sum, d) => sum + d.score, 0) / smartness.dims.length);

  // ── Roadmap 评分汇总 ──
  const voteAgg = new Map<string, { sum: number; count: number }>();
  for (const v of votes.rows) {
    if (!voteAgg.has(v.feature_id)) voteAgg.set(v.feature_id, { sum: 0, count: 0 });
    const a = voteAgg.get(v.feature_id)!;
    a.sum += v.score; a.count += 1;
  }
  const roadmapVotes = ROADMAP_ITEMS.map((item) => {
    const a = voteAgg.get(item.id);
    return { id: item.id, title: item.title, status: item.status, avg: a ? Math.round((a.sum / a.count) * 10) / 10 : null, count: a?.count || 0 };
  }).sort((x, y) => (y.avg ?? 0) * y.count - (x.avg ?? 0) * x.count);

  // ── 实验曝光(exp_exposure by exp/variant) ──
  const expAgg = new Map<string, Map<string, Set<string>>>();
  for (const r of telemetry.rows) {
    if (r.name !== 'exp_exposure') continue;
    const p = (r.props || {}) as { exp?: string; variant?: string };
    if (!p.exp || !p.variant) continue;
    if (!expAgg.has(p.exp)) expAgg.set(p.exp, new Map());
    const m = expAgg.get(p.exp)!;
    if (!m.has(p.variant)) m.set(p.variant, new Set());
    m.get(p.variant)!.add(r.device_id);
  }
  const experiments = EXPERIMENTS.map((e) => ({
    id: e.id, name: e.name, enabled: e.enabled,
    variants: e.variants.map((v) => ({ variant: v, devices: expAgg.get(e.id)?.get(v)?.size || 0 })),
  }));

  // ── 客户端错误聚合(client_error 遥测,30 天)——错误自己来找你 ──
  const errAgg = new Map<string, { count: number; devices: Set<string>; lastAt: string; kind: string; message: string }>();
  for (const r of telemetry.rows) {
    if (r.name !== 'client_error' || new Date(r.at).getTime() < cut(30)) continue;
    const p = (r.props || {}) as { kind?: string; message?: string };
    const kind = typeof p.kind === 'string' ? p.kind : 'error';
    const message = typeof p.message === 'string' ? p.message : 'unknown';
    const sig = `${kind}:${message}`;
    if (!errAgg.has(sig)) errAgg.set(sig, { count: 0, devices: new Set(), lastAt: r.at, kind, message });
    const e = errAgg.get(sig)!;
    e.count += 1;
    e.devices.add(r.device_id);
    if (r.at > e.lastAt) e.lastAt = r.at;
  }
  const clientErrors = [...errAgg.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((e) => ({ kind: e.kind, message: e.message, count: e.count, devices: e.devices.size, lastAt: e.lastAt }));

  // ── 洞察引擎:面板不该让人自己找问题——规则先替你看一遍 ──
  const dayEvents = (offsetDays: number, spanDays: number) =>
    telemetry.rows.filter((r) => {
      const t = new Date(r.at).getTime();
      return t >= cut(offsetDays + spanDays) && t < cut(offsetDays);
    }).length;
  const pct = (curr: number, prev: number) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null);

  const todayE = dayEvents(0, 1);
  const yesterdayE = dayEvents(1, 1);
  const week = dayEvents(0, 7);
  const prevWeek = dayEvents(7, 7);
  const deltas = {
    todayVsYesterday: pct(todayE, yesterdayE),
    weekVsPrevWeek: pct(week, prevWeek),
  };

  type Insight = { severity: 'go' | 'gentle' | 'risk'; title: string; detail: string; advice: string };
  const insights: Insight[] = [];
  const latestAt = telemetry.rows.length ? new Date(telemetry.rows[0].at).getTime() : 0;
  const monthTotal = telemetry.rows.filter((r) => new Date(r.at).getTime() >= cut(30)).length;

  if (telemetry.error) {
    insights.push({ severity: 'risk', title: '遥测数据源不可用', detail: `telemetry_events 读取失败(${telemetry.error})。`, advice: telemetry.error === 'table_missing' ? '在 Supabase SQL Editor 执行 schema bundle 的 Telemetry events 段建表。' : '检查 Supabase 服务与密钥配置。' });
  } else if (monthTotal === 0) {
    insights.push({ severity: 'gentle', title: '还没有数据进来', detail: '过去 30 天没有任何遥测事件。', advice: '遥测 2026-07-04 刚接通——自己先把 App 各功能走一遍,几分钟后这里就有数。' });
  } else if (latestAt && Date.now() - latestAt > 24 * 3_600_000) {
    insights.push({ severity: 'risk', title: '数据静默超过 24 小时', detail: `最后一条事件在 ${new Date(latestAt).toLocaleString('zh-CN')}。要么没人访问,要么遥测链路断了。`, advice: '打开一次 www.nesio.app 看这里是否 +1;不动则查 Vercel 日志里的 [telemetry] 行。' });
  }

  if (deltas.weekVsPrevWeek !== null && monthTotal > 20) {
    if (deltas.weekVsPrevWeek <= -30) {
      insights.push({ severity: 'gentle', title: `本周活跃下滑 ${Math.abs(deltas.weekVsPrevWeek)}%`, detail: `近 7 天 ${week} 事件,前 7 天 ${prevWeek}。`, advice: '看看趋势图虚线对比,找到下滑开始的那天,回想当天改了什么/发生了什么。' });
    } else if (deltas.weekVsPrevWeek >= 30) {
      insights.push({ severity: 'go', title: `本周活跃上涨 ${deltas.weekVsPrevWeek}%`, detail: `近 7 天 ${week} 事件,前 7 天 ${prevWeek}。`, advice: '涨势在,看 Top 事件里哪个功能带的量,考虑往它上面加东西。' });
    }
  }

  // 漏斗瓶颈:转化率最低的一步
  let worst: { step: string; rate: number } | null = null;
  for (let i = 1; i < funnel.length; i += 1) {
    const prev = funnel[i - 1].devices;
    if (prev < 3) continue; // 样本太小不判
    const rate = Math.round((funnel[i].devices / prev) * 100);
    if (!worst || rate < worst.rate) worst = { step: funnel[i].step, rate };
  }
  if (worst && worst.rate < 40) {
    insights.push({ severity: 'gentle', title: `漏斗瓶颈:${worst.step}(${worst.rate}%)`, detail: `到「${worst.step}」这步只有 ${worst.rate}% 的设备走过来,是流失最重的一环。`, advice: '这一步的入口是不是太深/文案不清?先降低它的进入门槛再看一周数据。' });
  }

  const fbTotal = feedback.useful + feedback.wrong + feedback.too_much;
  if (fbTotal >= 5) {
    const usefulRate = Math.round((feedback.useful / fbTotal) * 100);
    if (feedback.wrong + feedback.too_much > feedback.useful) {
      insights.push({ severity: 'risk', title: `推荐质量告警:负反馈过半`, detail: `30 天内 有用 ${feedback.useful} vs 不准+不再提醒 ${feedback.wrong + feedback.too_much}。`, advice: 'DEC 卡在惹人烦。优先收紧出卡条件(证据门槛/冷却时长),宁可少出不出错。' });
    } else if (usefulRate >= 60) {
      insights.push({ severity: 'go', title: `推荐质量健康(有用率 ${usefulRate}%)`, detail: `30 天 ${fbTotal} 条反馈,${feedback.useful} 条说有用。`, advice: '当前出卡策略可以保持,可小步提高出卡频率试探上限。' });
    }
  }

  const errTotal = clientErrors.reduce((sum, e) => sum + e.count, 0);
  if (errTotal >= 5) {
    const top = clientErrors[0];
    insights.push({ severity: 'risk', title: `客户端错误 ${errTotal} 次(30 天)`, detail: `最高频:「${top.message}」×${top.count},影响 ${top.devices} 台设备。`, advice: '看下方「客户端错误」区,把最高频那条丢给修复流程(issue 打 claude-fix 标签)。' });
  }

  if (aiTotals.okRate !== null && aiTotals.okRate < 90 && aiTotals.calls >= 10) {
    insights.push({ severity: 'gentle', title: `AI 成功率 ${aiTotals.okRate}%`, detail: `30 天 ${aiTotals.calls} 次调用有失败,看「AI 调用」表里哪条路由最差。`, advice: '成功率最低的路由优先查 key 配额/兜底链;fallback 生效时用户无感但成本翻倍。' });
  }

  if (insights.length === 0) {
    insights.push({ severity: 'go', title: '一切平稳', detail: '数据在进,没有触发任何告警规则。', advice: '不用管面板,去做创意。' });
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    insights,
    deltas,
    ai: { totals: aiTotals, routes: aiRoutes.slice(0, 8) },
    clientErrors,
    smartness: { score: smartScore, dims: smartness.dims },
    roadmapVotes,
    experiments,
    sources: {
      telemetryEvents: telemetry.error ? { ok: false, error: telemetry.error } : { ok: true, rows: telemetry.rows.length },
      productEvents: product.error ? { ok: false, error: product.error } : { ok: true, rows: product.rows.length },
    },
    windows: { today: windowStats(1), week: windowStats(7), month: windowStats(30) },
    topEvents7d: [...byName7.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    daily60d: [...daily.entries()].map(([date, d]) => ({ date, events: d.events, devices: d.devices.size })),
    funnel30d: funnel,
    cardFeedback30d: feedback,
    productEvents30d: [...productByType.entries()].map(([type, count]) => ({ type, count })),
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
