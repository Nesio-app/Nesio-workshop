/**
 * POST /api/portal/family/payout → 记一笔线下现金冲账(需 can_record_payout,服务端强制)。
 * body { familyId, personId, amount, date, note? }。**Nesio 永不碰钱** —— 这只是记账,不是转账。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, recordPayoutOp } from '@/lib/family/family-server';
import { userTzDayKey } from '@/lib/portal/user-timezone';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as { familyId?: string; personId?: string; amount?: number; date?: string; note?: string };
  if (!body.familyId || !body.personId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const r = await recordPayoutOp(actor.value, {
    familyId: body.familyId,
    personId: body.personId,
    amount: Number(body.amount ?? 0),
    date: body.date || userTzDayKey(new Date()),
    note: body.note,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, payout: r.value });
}
