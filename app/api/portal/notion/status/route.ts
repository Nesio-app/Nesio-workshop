/**
 * GET /api/portal/notion/status — Notion 是否已配置 + 是否已连接。
 * configured:OAuth 是否配了 NOTION_CLIENT_ID(点连接前的轻量预检)。
 * connected:是否已有 OAuth 授权(cookie token)—— 批次 39:OAuth 连过但没有本地 token 时,
 *   让连接按钮也能正确翻成「同步/选表」。
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const configured = Boolean((process.env.NOTION_CLIENT_ID ?? '').trim());
  const connected = Boolean(req.cookies.get('nesio_notion_access')?.value);
  return NextResponse.json({ ok: true, configured, connected });
}
