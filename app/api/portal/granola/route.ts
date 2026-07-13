/**
 * GET /api/portal/granola  (批次 156)
 * Granola 会议同步 —— 服务端作为 Granola 远程 MCP 客户端,拉会议列表+转写返回浏览器,
 * 由浏览器过批次154 抽取(ingestGranolaMeeting)落成 To do/Inferred 节点(本地优先)。
 *
 * Query:
 *   range   = this_week | last_week | last_30_days(默认 last_30_days)
 *   max     = 本轮最多取几场转写(默认 10,上限 20)
 *   skip    = 逗号分隔的已入库 meeting id(源头去重,不重复取转写)
 * Output: { ok, meetings: GranolaMeetingFull[] } | { ok:false, error, connectUrl? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIntegrationToken } from '@/lib/portal/integrations';
import { fetchGranolaMeetings, type GranolaTimeRange } from '@/lib/portal/granola-mcp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_RANGES: GranolaTimeRange[] = ['this_week', 'last_week', 'last_30_days'];

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
    cookieStore.get('baohe_auth_refresh')?.value ||
    cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (!hasSession) {
    return NextResponse.json({ ok: false, error: 'auth_required', meetings: [] }, { status: 401 });
  }

  const tokens = await getIntegrationToken('granola');
  if (!tokens?.accessToken) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/granola/connect', meetings: [] },
      { status: 200 },
    );
  }

  const url = new URL(req.url);
  const rangeParam = url.searchParams.get('range') || 'last_30_days';
  const range: GranolaTimeRange = (VALID_RANGES as string[]).includes(rangeParam) ? rangeParam as GranolaTimeRange : 'last_30_days';
  const max = Number(url.searchParams.get('max') || 10) || 10;
  const skipIds = new Set(
    (url.searchParams.get('skip') || '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  try {
    const meetings = await fetchGranolaMeetings(tokens.accessToken, { timeRange: range, maxTranscripts: max, skipIds });
    return NextResponse.json({ ok: true, meetings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Bearer 过期/无效 → 让前端引导重新授权(token 刷新在 OAuth 路由,这里只报信号)。
    if (/401|403|unauthor|invalid_token|expired/i.test(msg)) {
      return NextResponse.json(
        { ok: false, error: 'token_expired', connectUrl: '/api/portal/granola/connect', meetings: [] },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: false, error: msg || 'sync_failed', meetings: [] }, { status: 200 });
  }
}
