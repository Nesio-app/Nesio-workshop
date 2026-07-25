/**
 * GET /api/portal/family/assignment?sourceEventId= → 查某条日历事件当前分派给谁 + 状态。
 * 供记忆详情按钮重开时显示「已交给谁 · 状态」而非又回到「派活」。session + membership。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, getEventAssignmentOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const sourceEventId = req.nextUrl.searchParams.get('sourceEventId') || '';
  const r = await getEventAssignmentOp(actor.value, sourceEventId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.value });
}
