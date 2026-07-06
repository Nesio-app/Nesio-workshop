/**
 * POST /api/admin/analyst/feedback — 记一条对预警的反馈(反馈学习的输入)。
 * body: { alertType: string, reaction: 'useful'|'dismiss'|'wrong', date?: string }
 * 门禁:requireAdmin。未配 Supabase → saved:false(不报错,只是学不了)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/portal/admin-gate';
import { saveFeedback } from '@/lib/portal/analyst-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const blocked = requireAdmin(req, 'admin-analyst-feedback');
  if (blocked) return blocked;

  let body: { alertType?: string; reaction?: string; date?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }
  const alertType = (body.alertType || '').trim();
  const reaction = (body.reaction || '').trim();
  if (!alertType || !['useful', 'dismiss', 'wrong'].includes(reaction)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const saved = await saveFeedback(alertType, reaction, body.date || new Date().toISOString().slice(0, 10));
  return NextResponse.json({ ok: true, saved });
}
