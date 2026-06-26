/**
 * POST /api/portal/toggl
 * Fetches recent Toggl Track time entries using a user-supplied API token.
 * Summarizes time usage into Life Graph nodes.
 *
 * Body: { token: string }  (Toggl Track API token, from toggl.com → Profile → API Token)
 * Returns: { ok, nodes, summary, totalHours }
 *
 * Token never persisted server-side. Toggl uses HTTP Basic auth: token:api_token
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TOGGL_API = 'https://api.track.toggl.com/api/v9';

interface TogglEntry {
  id: number;
  description?: string;
  project_id?: number;
  start?: string;
  stop?: string;
  duration?: number; // seconds; negative = running
}

function basicAuth(token: string): string {
  return 'Basic ' + Buffer.from(`${token}:api_token`).toString('base64');
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
}

export async function POST(req: NextRequest) {
  const { token } = await req.json() as { token?: string };
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 });
  }

  // Fetch last 7 days of time entries
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  let res: Response;
  try {
    res = await fetch(`${TOGGL_API}/me/time_entries?start_date=${since.slice(0, 10)}`, {
      headers: { Authorization: basicAuth(token), 'Content-Type': 'application/json' },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'toggl_unreachable' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.status === 403 || res.status === 401 ? 'invalid_token' : `toggl_${res.status}` },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    );
  }

  const entries = await res.json() as TogglEntry[];
  const completed = entries.filter((e) => (e.duration ?? 0) > 0);

  // Aggregate by description
  const byTask = new Map<string, number>();
  let totalSec = 0;
  for (const e of completed) {
    const key = e.description?.trim() || '未命名';
    byTask.set(key, (byTask.get(key) || 0) + (e.duration || 0));
    totalSec += e.duration || 0;
  }

  // Build nodes: one summary + top tasks
  const topTasks = Array.from(byTask.entries()).sort(([, a], [, b]) => b - a).slice(0, 5);
  const today = new Date().toLocaleDateString('zh-CN');

  const nodes: object[] = [
    {
      type: 'event',
      name: `本周专注 ${formatDuration(totalSec)}`,
      attributes: {
        source: 'Toggl',
        totalHours: (totalSec / 3600).toFixed(1),
        entries: String(completed.length),
        period: '近7天',
        date: today,
      },
      relations: [],
      tags: ['Toggl', '时间记录'],
      confidence: 1.0,
      rawInput: `近7天专注 ${formatDuration(totalSec)}，${completed.length} 条记录`,
    },
    ...topTasks.map(([task, sec]) => ({
      type: 'event' as const,
      name: task,
      attributes: { source: 'Toggl', duration: formatDuration(sec), date: today },
      relations: [],
      tags: ['Toggl', '时间记录'],
      confidence: 0.9,
      rawInput: `${task}：${formatDuration(sec)}`,
    })),
  ];

  return NextResponse.json({
    ok: true,
    nodes,
    summary: `近7天专注 ${formatDuration(totalSec)}，共 ${completed.length} 条记录`,
    totalHours: (totalSec / 3600).toFixed(1),
  });
}
