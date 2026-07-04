/**
 * L-5 AI 成本循环(report-only,每月/手动)。
 *
 * 数据源(按可用性自动选择):
 *   1. Supabase telemetry_events 表(配置了 SUPABASE_URL + key 时)
 *   2. --from-file <path>:Vercel 日志导出(JSON lines,含 [telemetry] 行)
 * 两者都不可用时打印取数指引。
 *
 * 汇总维度:每个 ai_route 的调用数 / 失败率 / 延迟 p50 / 降级率,
 * 以及客户端核心动作计数(brief_play / chat_send / …)。
 * guidance-language 曾经"每次打开烧一次"靠肉眼发现 — 这份报告让异常
 * 调用量变成月报里的一行。
 *
 * 用法:node scripts/report-ai-cost.mjs [--from-file logs.json] [--days 30] [--markdown]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const markdown = args.includes('--markdown');
const fileIdx = args.indexOf('--from-file');
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 30 : 30;
const sinceMs = Date.now() - days * 86_400_000;

function envValue(key) { return (process.env[key] ?? '').trim(); }

async function loadEvents() {
  // 来源 1:本地日志文件(Vercel dashboard → Logs → export,或 vercel logs 输出)
  if (fileIdx >= 0) {
    const raw = readFileSync(args[fileIdx + 1], 'utf8');
    const events = [];
    for (const line of raw.split('\n')) {
      const at = line.indexOf('[telemetry]');
      if (at < 0) continue;
      try { events.push(JSON.parse(line.slice(at + '[telemetry]'.length).trim())); }
      catch { /* skip unparseable */ }
    }
    return { events, source: `file(${args[fileIdx + 1]})` };
  }
  // 来源 2:Supabase telemetry_events
  const url = envValue('SUPABASE_URL');
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (url && key) {
    const res = await fetch(
      `${url}/rest/v1/telemetry_events?at=gte.${new Date(sinceMs).toISOString()}&select=name,props,at&limit=10000`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.ok) {
      const rows = await res.json();
      return { events: rows.map((r) => ({ name: r.name, props: r.props, ts: new Date(r.at).getTime() })), source: 'supabase' };
    }
  }
  return { events: null, source: 'none' };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const { events, source } = await loadEvents();
if (!events) {
  console.log('无可用数据源。取数方式任选:');
  console.log('  A. 配置 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 后重跑(telemetry 自动入库)');
  console.log('  B. Vercel Dashboard → 项目 → Logs → 过滤 "[telemetry]" → 导出,然后:');
  console.log('     node scripts/report-ai-cost.mjs --from-file logs.json');
  console.log('AI_COST_SOURCE=none');
  process.exit(0);
}

const recent = events.filter((e) => (e.ts ?? 0) >= sinceMs);
const aiByRoute = new Map();
const actionCounts = new Map();
for (const e of recent) {
  if (e.name === 'ai_route') {
    const route = String(e.props?.route ?? 'unknown');
    if (!aiByRoute.has(route)) aiByRoute.set(route, { calls: 0, fails: 0, latencies: [], fallbacks: 0 });
    const r = aiByRoute.get(route);
    r.calls++;
    if (e.props?.ok === false) r.fails++;
    if (typeof e.props?.latency_ms === 'number') r.latencies.push(e.props.latency_ms);
    if (e.props?.fallback) r.fallbacks++;
  } else {
    actionCounts.set(e.name, (actionCounts.get(e.name) ?? 0) + 1);
  }
}

const h = markdown ? (s) => console.log(`\n### ${s}\n`) : (s) => console.log(`\n== ${s} ==`);
console.log(markdown ? `## AI 成本月报(L-5)· 近 ${days} 天 · 源:${source}\n` : `AI 成本月报 · 近 ${days} 天 · 源:${source}`);

h('AI Route');
if (aiByRoute.size === 0) console.log('(无 ai_route 事件)');
if (markdown && aiByRoute.size) console.log('| route | 调用 | 失败率 | p50 延迟 | 降级 |\n|---|---|---|---|---|');
for (const [route, r] of [...aiByRoute.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
  const failRate = r.calls ? `${Math.round((r.fails / r.calls) * 100)}%` : '-';
  const p50 = percentile(r.latencies, 0.5);
  const line = markdown
    ? `| ${route} | ${r.calls} | ${failRate} | ${p50 ?? '-'}ms | ${r.fallbacks} |`
    : `${route.padEnd(20)} 调用=${r.calls} 失败率=${failRate} p50=${p50 ?? '-'}ms 降级=${r.fallbacks}`;
  console.log(line);
}

h('核心动作');
for (const [name, count] of [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(markdown ? `- ${name}: ${count}` : `${name.padEnd(24)} ${count}`);
}

console.log(`\nAI_COST_SOURCE=${source}`);
