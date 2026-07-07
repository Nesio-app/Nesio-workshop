/**
 * GET /api/portal/notion/status — Notion 是否已配置 + 是否已连接。
 * configured:OAuth 是否配了 NOTION_CLIENT_ID(点连接前的轻量预检)。
 * connected:本机 cookie **或 Supabase integrations**(Notion 修:
 *   iOS 上授权常在另一个浏览器上下文完成,token 存云端后,
 *   PWA 用自己的会话就能看到已连接,按钮不再永远停在「接入」)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIntegrationTokenRefreshed } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const configured = Boolean((process.env.NOTION_CLIENT_ID ?? '').trim());
  let connected = Boolean(req.cookies.get('nesio_notion_access')?.value);
  if (!connected) {
    const cloud = await getIntegrationTokenRefreshed('notion');
    connected = Boolean(cloud?.accessToken);
  }
  return NextResponse.json({ ok: true, configured, connected });
}
