/**
 * GET /api/portal/family/ledger?familyId=&personId= → 某成员账本:余额 + 已挣家务 + 付款历史。
 * 家庭成员可看家人的攒钱数(共享账本)。余额 = Σ(approved) − Σ(payout),纯算术。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, getLedger } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const familyId = req.nextUrl.searchParams.get('familyId') || '';
  const personId = req.nextUrl.searchParams.get('personId') || '';
  if (!familyId || !personId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const r = await getLedger(actor.value, familyId, personId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ledger: r.value });
}
