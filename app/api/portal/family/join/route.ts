/**
 * POST /api/portal/family/join — 凭邀请码入伙(默认孩子权限:needs_approval=on)。
 * body { inviteCode, displayName }。家长可在成员管理里改权限。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, joinFamily } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as { inviteCode?: string; displayName?: string; avatarUrl?: string };
  const r = await joinFamily(actor.value, { inviteCode: body.inviteCode ?? '', displayName: body.displayName ?? '', avatarUrl: body.avatarUrl });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.value });
}
