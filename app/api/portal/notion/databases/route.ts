/**
 * POST /api/portal/notion/databases
 * Lists the Notion databases (tables) the integration can see, for the picker UI.
 * Body: { token?: string }  (or OAuth cookie)
 * Returns: { ok, databases: [{ id, title }] } | { ok:false, error }
 *
 * 批次 38:用户「选择要同步的表」用这个列表勾选;实际行→节点在 /api/portal/notion 完成。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { discoverDatabases, primaryDataSourceId } from '@/lib/portal/notion-api';
import { getIntegrationTokenRefreshed } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'notion-databases', { limit: 20 });
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { token?: string };
  let token = body.token || req.cookies.get('nesio_notion_access')?.value || '';
  if (!token) {
    // Notion 修:iOS 授权在别的浏览器完成时 token 只在 Supabase,回落云端读
    const cloud = await getIntegrationTokenRefreshed('notion');
    token = cloud?.accessToken || '';
  }
  if (!token) {
    return NextResponse.json({ ok: false, error: 'not_connected' }, { status: 401 });
  }

  // N-1:discovery(2025-09-03)—— 枚举库并展开 data_sources[]。
  let result: Awaited<ReturnType<typeof discoverDatabases>>;
  try {
    result = await discoverDatabases(token);
  } catch {
    return NextResponse.json({ ok: false, error: 'notion_unreachable' }, { status: 502 });
  }

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.status === 401 ? 'invalid_token' : `notion_${result.status}` },
      { status: result.status === 401 ? 401 : 502 },
    );
  }

  // 返回给客户端的 id 用「主数据源 id」(2025-09-03 查询用它);databaseId 一并带上便于日后诊断。
  const databases = result.databases.map((db) => ({
    id: primaryDataSourceId(db),
    databaseId: db.databaseId,
    title: db.title,
  }));

  // token 有效但没有共享任何数据库 —— 和页面同理,给准话
  if (databases.length === 0) {
    return NextResponse.json({ ok: true, databases: [], hint: 'no_shared_databases' });
  }

  return NextResponse.json({ ok: true, databases });
}
