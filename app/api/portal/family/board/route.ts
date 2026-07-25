/**
 * GET /api/portal/family/board?familyId= → 家庭板:我今天的活 + (可审核才有的)待审队列 + 全家余额。
 * 待审队列只对 can_approve 暴露 —— 服务端判定,不靠 UI 藏。today 用家庭时区(纽约)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, getBoard } from '@/lib/family/family-server';
import { userTzDayKey } from '@/lib/portal/user-timezone';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  const familyId = req.nextUrl.searchParams.get('familyId') || '';
  if (!familyId) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const r = await getBoard(actor.value, familyId, userTzDayKey(new Date()));
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, board: r.value });
}
