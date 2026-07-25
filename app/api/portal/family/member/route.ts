/**
 * POST /api/portal/family/member → 成员管理。
 *  action:'role'   改权限(需 can_approve)  { familyId, memberUserId, canApprove, needsApproval, canRecordPayout }
 *  action:'remove' 移出/退出(踢别人需 can_approve;踢自己=退出)  { familyId, memberUserId }
 * 服务端防锁死:不把最后一个家长降级/踢掉。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, setMemberRoleOp, removeMemberOp } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as {
    action?: 'role' | 'remove'; familyId?: string; memberUserId?: string;
    canApprove?: boolean; needsApproval?: boolean; canRecordPayout?: boolean;
  };
  if (!body.familyId || !body.memberUserId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const r = body.action === 'remove'
    ? await removeMemberOp(actor.value, { familyId: body.familyId, memberUserId: body.memberUserId })
    : await setMemberRoleOp(actor.value, {
        familyId: body.familyId, memberUserId: body.memberUserId,
        canApprove: !!body.canApprove, needsApproval: !!body.needsApproval, canRecordPayout: !!body.canRecordPayout,
      });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
