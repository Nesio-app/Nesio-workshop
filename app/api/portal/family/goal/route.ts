/**
 * POST /api/portal/family/goal → 设「我」在某家庭的攒钱目标(攒够 amount 买 label)。
 * 只能设自己的;amount<=0 清除。session + membership。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, setMyGoalOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as { familyId?: string; amount?: number; label?: string };
  if (!body.familyId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const r = await setMyGoalOp(actor.value, { familyId: body.familyId, amount: Number(body.amount ?? 0), label: body.label ?? '' });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
