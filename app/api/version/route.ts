/**
 * GET /api/version — 当前部署的构建标识。
 * 批次 7:iOS PWA 后台驻留的页面从不重新加载,用户会连续几天停在旧版 UI。
 * 客户端在回到前台时对比这个值,变了就整页刷新拿新版。
 * 公开只读,无用户数据。
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_DEPLOYMENT_ID
    || 'dev';
  return NextResponse.json(
    { ok: true, v },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
