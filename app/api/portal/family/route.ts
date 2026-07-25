/**
 * /api/portal/family
 * GET  → 我所属的家庭 + 我在每个家庭的权限
 * POST → 建家(创建者自动成为家长成员);body { name, displayName }
 * 家庭分享 workshop 域实验(不进 V1)。信任模型 A:服务端授权 + 能力强制。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveActor, createFamily, listMyFamilies, type FamilyResult } from '@/lib/family/family-server';

export const dynamic = 'force-dynamic';

function err<T>(r: Extract<FamilyResult<T>, { ok: false }>) {
  return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return err(actor);
  const r = await listMyFamilies(actor.value);
  if (!r.ok) return err(r);
  return NextResponse.json({ ok: true, families: r.value });
}

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (!actor.ok) return err(actor);
  const body = await req.json().catch(() => ({})) as { name?: string; displayName?: string; avatarUrl?: string };
  const r = await createFamily(actor.value, { name: body.name ?? '', displayName: body.displayName ?? '', avatarUrl: body.avatarUrl });
  if (!r.ok) return err(r);
  return NextResponse.json({ ok: true, ...r.value });
}
