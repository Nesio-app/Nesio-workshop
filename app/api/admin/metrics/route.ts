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
  const [telemetry, product] = await Promise.all([
    supabaseSelect<TelemetryRow>(
      `telemetry_events?select=name,device_id,at&at=gte.${since60}&order=at.desc&limit=10000`,
    ),
    supabaseSelect<ProductEventRow>(
      `product_events?select=event_type,feedback,target_type,created_at&created_at=gte.${since30}&order=created_at.desc&limit=2000`,
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

  if (insights.length === 0) {
    insights.push({ severity: 'go', title: '一切平稳', detail: '数据在进,没有触发任何告警规则。', advice: '不用管面板,去做创意。' });
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    insights,
    deltas,
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
