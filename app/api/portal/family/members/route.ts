/**
 * GET /api/portal/family/members?familyId= → 家庭全体成员(供「分派给家人」选人)。
 * 任何成员可读;非成员 403(服务端强制)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, listFamilyMembersOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const familyId = req.nextUrl.searchParams.get('familyId') || '';
  if (!familyId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const r = await listFamilyMembersOp(actor.value, familyId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.value });
}
