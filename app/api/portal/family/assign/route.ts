/**
 * POST /api/portal/family/assign → 把一条日历事件(记忆节点)分派给某个家庭成员。
 * 需 can_approve(分派 = 家长动作,服务端强制)。一事件一实例:按来源去重,再点即改派。
 * body { familyId, sourceEventId, title, dueDate(YYYY-MM-DD), assigneeId, value?, needsApproval? }。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, assignChoreFromEventOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as {
    familyId?: string; sourceEventId?: string; title?: string; dueDate?: string; assigneeId?: string; value?: number; needsApproval?: boolean;
  };
  if (!body.familyId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const r = await assignChoreFromEventOp(actor.value, {
    familyId: body.familyId,
    sourceEventId: body.sourceEventId ?? '',
    title: body.title ?? '',
    dueDate: body.dueDate ?? '',
    assigneeId: body.assigneeId ?? '',
    value: Number(body.value ?? 0),
    needsApproval: body.needsApproval !== false,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, instance: r.value });
}
