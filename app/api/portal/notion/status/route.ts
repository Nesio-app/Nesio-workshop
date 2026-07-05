/**
 * GET /api/portal/notion/status — Notion OAuth 是否已配置(批次 23)。
 * 用于连接按钮点击前的轻量预检:未配置就在面板内直接提示,不做无反馈跳转。
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const configured = Boolean((process.env.NOTION_CLIENT_ID ?? '').trim());
  return NextResponse.json({ ok: true, configured });
}
