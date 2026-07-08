/**
 * GET /api/portal/tasks — 读取 Google Tasks(免费最大化·Google 扩展授权 58b)。
 *
 * scope tasks 已在 58a 并入联合授权。拉全部任务列表 + 每个列表的未完成任务,
 * 映射成 { id, title, due, notes, status, listTitle }。读取即可(双向写回留后续)。
 * 鉴权复用 resolveGmailAccessToken(Gmail/Calendar/Tasks 同一次 Google 授权)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TASKS = 'https://tasks.googleapis.com/tasks/v1';

interface TaskItem { id: string; title: string; due?: string; notes?: string; status: string; listTitle: string }

export async function GET(req: NextRequest) {
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });
  }
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  try {
    const listRes = await fetch(`${TASKS}/users/@me/lists?maxResults=100`, auth);
    if (!listRes.ok) return NextResponse.json({ ok: false, error: `tasks_lists_${listRes.status}` }, { status: 502 });
    const lists = (await listRes.json() as { items?: Array<{ id?: string; title?: string }> }).items || [];

    const out: TaskItem[] = [];
    for (const l of lists) {
      if (!l.id) continue;
      // showCompleted=false:只要还没做完的(待办语义);每列表上限 100
      const tRes = await fetch(`${TASKS}/lists/${l.id}/tasks?showCompleted=false&maxResults=100`, auth);
      if (!tRes.ok) continue; // 单列表失败不阻断其它列表
      const items = (await tRes.json() as { items?: Array<{ id?: string; title?: string; due?: string; notes?: string; status?: string }> }).items || [];
      for (const t of items) {
        if (!t.id || !t.title) continue;
        out.push({
          id: t.id,
          title: t.title.slice(0, 200),
          due: t.due || undefined,           // RFC3339(仅日期有效)
          notes: t.notes ? t.notes.slice(0, 500) : undefined,
          status: t.status || 'needsAction',
          listTitle: l.title || 'Tasks',
        });
      }
    }
    return NextResponse.json({ ok: true, tasks: out }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'tasks_unreachable' }, { status: 502 });
  }
}
