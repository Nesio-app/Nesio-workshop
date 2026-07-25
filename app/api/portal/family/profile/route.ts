/**
 * POST /api/portal/family/profile → 把「我」的账号资料(名字/头像)同步到我在各家庭的成员行。
 * 家庭成员身份自成一套 —— 名字头像来自本人账号,不匹配 People。session + membership(隐含)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, syncMyProfileOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as { displayName?: string; avatarUrl?: string };
  const r = await syncMyProfileOp(actor.value, { displayName: body.displayName, avatarUrl: body.avatarUrl });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.value });
}
