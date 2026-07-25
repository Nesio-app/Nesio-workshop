/**
 * POST /api/portal/family/chore → 建家务模板 + 生成未来 14 天实例(需 can_approve,服务端强制)。
 * body { familyId, title, cadence, value, assigneeId, needsApproval }。窗口用家庭时区(纽约)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, createChoreTemplateOp } from '@/lib/family/family-server';
import type { Cadence } from '@/lib/family/chores-core';
import { userTzDayKey } from '@/lib/portal/user-timezone';

export const dynamic = 'force-dynamic';

const HORIZON_DAYS = 14;

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as {
    familyId?: string; title?: string; cadence?: Cadence; value?: number; assigneeId?: string; needsApproval?: boolean;
  };
  if (!body.familyId || !body.cadence) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const fromKey = userTzDayKey(new Date());
  const toKey = userTzDayKey(new Date(Date.now() + HORIZON_DAYS * 86_400_000));

  const r = await createChoreTemplateOp(actor.value, {
    familyId: body.familyId,
    title: body.title ?? '',
    cadence: body.cadence,
    value: Number(body.value ?? 0),
    assigneeId: body.assigneeId ?? '',
    needsApproval: body.needsApproval !== false,
    window: { fromKey, toKey },
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.value });
}
