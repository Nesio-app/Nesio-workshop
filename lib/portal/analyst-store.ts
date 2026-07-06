/**
 * 分析师持久化 —— 每日指标快照(基线学习用)+ 用户反馈(反馈学习用)。
 *
 * 存自己的 Supabase(与 telemetry 同一套:SUPABASE_SERVICE_ROLE_KEY,/rest/v1/<table>)。
 * 未配置 Supabase → 所有函数优雅降级(读返回空、写返回 false),分析师退回冷启动固定阈值,
 * 功能不崩。建表 SQL 见 docs/governance/analyst-schema.sql。
 */
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

type Signals = Record<string, number | null>;
type FeedbackRow = { alertType: string; reaction: string };

function env(key: string): string {
  return (process.env[key] ?? '').trim();
}

function config(): { url: string; key: string } | null {
  const url = normalizeSupabaseRuntimeUrl(env('SUPABASE_URL'));
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  return { url, key };
}

export function analystStoreConfigured(): boolean {
  return config() !== null;
}

async function rest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<Response | null> {
  const c = config();
  if (!c) return null;
  try {
    return await fetch(`${c.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: c.key,
        Authorization: `Bearer ${c.key}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return null;
  }
}

/** 最近 N 天的指标快照(给基线做历史序列)。无库/出错 → 空数组。 */
export async function loadHistory(days = 45): Promise<Signals[]> {
  const res = await rest('GET', `analyst_daily?select=signals&order=date.desc&limit=${days}`);
  if (!res || !res.ok) return [];
  try {
    const rows = await res.json() as Array<{ signals?: Signals }>;
    return rows.map((r) => r.signals || {}).filter((s) => s && typeof s === 'object');
  } catch {
    return [];
  }
}

/** upsert 今日快照(按 date 去重合并)。 */
export async function saveDaily(date: string, signals: Signals): Promise<boolean> {
  const res = await rest('POST', 'analyst_daily?on_conflict=date', { date, signals }, { Prefer: 'resolution=merge-duplicates' });
  return !!res && res.ok;
}

/** 最近的反馈记录(给反馈学习汇总)。 */
export async function loadFeedback(limit = 500): Promise<FeedbackRow[]> {
  const res = await rest('GET', `analyst_feedback?select=alert_type,reaction&order=created_at.desc&limit=${limit}`);
  if (!res || !res.ok) return [];
  try {
    const rows = await res.json() as Array<{ alert_type?: string; reaction?: string }>;
    return rows
      .filter((r) => r.alert_type && r.reaction)
      .map((r) => ({ alertType: r.alert_type as string, reaction: r.reaction as string }));
  } catch {
    return [];
  }
}

/** 记一条反馈。reaction ∈ useful|dismiss|wrong。 */
export async function saveFeedback(alertType: string, reaction: string, reportDate: string): Promise<boolean> {
  const clean = ['useful', 'dismiss', 'wrong'].includes(reaction) ? reaction : 'dismiss';
  const res = await rest('POST', 'analyst_feedback', { alert_type: alertType, reaction: clean, report_date: reportDate });
  return !!res && res.ok;
}
