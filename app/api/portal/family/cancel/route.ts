/**
 * POST /api/portal/family/cancel → 停掉/删除一条(含周期全部)来自日历事件的家务(软删)。
 * 管理动作:需 can_approve(服务端强制)。body { familyId, sourceEventId }。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, cancelEventChoreOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as { familyId?: string; sourceEventId?: string };
  if (!body.familyId || !body.sourceEventId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const r = await cancelEventChoreOp(actor.value, { familyId: body.familyId, sourceEventId: body.sourceEventId });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.value });
}
