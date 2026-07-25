/**
 * POST /api/portal/family/chore/action → 对一件家务做 done / approve / send_back。
 * body { familyId, instanceId, action, proofRef? }。能力 + 状态机全在 lib/family/chores-core 判:
 * 无 can_approve 审核 → 403;非本人打勾 → 403;非法状态迁移 → 409。UI 藏不藏是体验,这里拒才是安全。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, applyChoreAction } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const body = await req.json().catch(() => ({})) as {
    familyId?: string; instanceId?: string; action?: 'done' | 'approve' | 'send_back'; proofRef?: string;
  };
  if (!body.familyId || !body.instanceId || !body.action) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const r = await applyChoreAction(actor.value, {
    familyId: body.familyId,
    instanceId: body.instanceId,
    action: body.action,
    at: new Date().toISOString(),
    proofRef: body.proofRef,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, instance: r.value });
}
