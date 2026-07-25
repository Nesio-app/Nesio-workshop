/**
 * POST /api/portal/family/payout → 记一笔线下现金冲账(需 can_record_payout,服务端强制)。
 *   默认           body { familyId, personId, amount, date, note? } —— 记一笔发薪。
 *   action:'reverse' body { familyId, payoutId }                    —— 记错了撤这一笔(软删)。
 * **Nesio 永不碰钱** —— 这只是记账,不是转账。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, recordPayoutOp, reversePayoutOp } from '@/lib/family/family-server';
import { userTzDayKey } from '@/lib/portal/user-timezone';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as {
    action?: 'reverse'; familyId?: string; personId?: string; amount?: number; date?: string; note?: string; payoutId?: string;
  };
  if (!body.familyId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  if (body.action === 'reverse') {
    if (!body.payoutId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
    const rr = await reversePayoutOp(actor.value, { familyId: body.familyId, payoutId: body.payoutId });
    if (!rr.ok) return NextResponse.json({ ok: false, error: rr.error }, { status: rr.status });
    return NextResponse.json({ ok: true, reversed: rr.value.reversed });
  }

  if (!body.personId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
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
