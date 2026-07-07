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
import { notionDbTitle } from '@/lib/portal/notion-map';
import { getIntegrationToken } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'notion-databases', { limit: 20 });
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { token?: string };
  let token = body.token || req.cookies.get('nesio_notion_access')?.value || '';
  if (!token) {
    // Notion 修:iOS 授权在别的浏览器完成时 token 只在 Supabase,回落云端读
    const cloud = await getIntegrationToken('notion');
    token = cloud?.accessToken || '';
  }
  if (!token) {
    return NextResponse.json({ ok: false, error: 'not_connected' }, { status: 401 });
  }

  let res: Response;
  try {
    res = await fetch(`${NOTION_API}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'database' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 50,
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'notion_unreachable' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.status === 401 ? 'invalid_token' : `notion_${res.status}` },
      { status: res.status === 401 ? 401 : 502 },
    );
  }

  const data = await res.json() as { results?: Array<{ id: string; title?: unknown }> };
  const databases = (data.results || []).map((db) => ({ id: db.id, title: notionDbTitle(db) }));

  // token 有效但没有共享任何数据库 —— 和页面同理,给准话
  if (databases.length === 0) {
    return NextResponse.json({ ok: true, databases: [], hint: 'no_shared_databases' });
  }

  return NextResponse.json({ ok: true, databases });
}
