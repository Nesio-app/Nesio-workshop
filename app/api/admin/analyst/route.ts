/**
 * GET /api/admin/analyst — 分析师日报卡的只读数据源。
 * 计算「学习后」的日报(历史基线 + 反馈),不调 AI、不发邮件、不写库 —— 快且免费。
 * 门禁:requireAdmin。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/portal/admin-gate';
import { computeDailyReport } from '@/lib/portal/analyst-runtime';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export async function GET(req: NextRequest) {
  const blocked = requireAdmin(req, 'admin-analyst');
  if (blocked) return blocked;
  const { report } = await computeDailyReport(req.nextUrl.origin, envValue('NESIO_ADMIN_SECRET'));
  return NextResponse.json({ ok: true, report });
}
