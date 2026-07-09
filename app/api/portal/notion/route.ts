/**
 * POST /api/portal/notion
 * Fetches recently-edited Notion pages using a user-supplied integration token,
 * extracts Life Graph nodes via Gemini.
 *
 * Body: { token: string }  (Notion internal integration token, "secret_xxx" / "ntn_xxx")
 * Returns: { ok, nodes, summary, pageCount }
 *
 * The token is supplied by the client (stored in their localStorage) and never
 * persisted server-side. To get one: notion.so/my-integrations → New integration →
 * copy the Internal Integration Secret, then share the pages/databases with it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { NOTION_API, NOTION_VERSION, notionHeaders, queryDataSourceRows, getDataSourceSchema, discoverDatabases, primaryDataSourceId } from '@/lib/portal/notion-api';
import { foldSourcesToMemories, type NotionPageRow } from '@/lib/portal/notion-fold';
import type { NotionSourceSchema } from '@/lib/portal/notion-classify';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { getIntegrationTokenRefreshed } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_DATABASES = 8;       // 一次最多同步几个表
const MAX_ROWS_PER_DB = 100;   // 每个表最多取多少行(Notion 单页上限)
const MAX_TOTAL_ROWS = 400;    // 总行数上限,防止灌爆记忆

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

function extractTitle(page: NotionPage): string {
  const props = page.properties || {};
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (v?.type === 'title' && Array.isArray(v.title)) {
      return v.title.map((t) => t.plain_text || '').join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

async function fetchPageText(token: string, pageId: string): Promise<string> {
  try {
    const res = await fetch(`${NOTION_API}/blocks/${pageId}/children?page_size=30`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
    });
    if (!res.ok) return '';
    const data = await res.json() as { results?: Array<Record<string, unknown>> };
    const texts: string[] = [];
    for (const block of data.results || []) {
      const b = block as Record<string, { rich_text?: Array<{ plain_text?: string }> }> & { type?: string };
      const type = (block as { type?: string }).type;
      if (!type) continue;
      const content = b[type];
      if (content?.rich_text) {
        texts.push(content.rich_text.map((r) => r.plain_text || '').join(''));
      }
    }
    return texts.filter(Boolean).join('\n').slice(0, 1500);
  } catch { return ''; }
}

async function extractNodes(pages: Array<{ title: string; text: string; url?: string }>): Promise<{ nodes: object[]; summary: string }> {
  if (!aiProviderAvailable() || !pages.length) return { nodes: [], summary: '无内容' };

  const docText = pages.map((p) => `页面：${p.title}\n内容：${p.text}`).join('\n\n───\n\n');

  const prompt = `你是 Nesio 的 Notion 解析器。从以下 Notion 页面中提取人物、项目、承诺、任务、想法等生活记忆节点。

输出 JSON：
{
  "nodes": [{
    "type": "person|object|place|event|commitment|preference",
    "name": "简短名称",
    "attributes": { "source": "Notion", "page": "页面名" },
    "relations": [{"targetId": "关联", "relation": "关系"}],
    "tags": ["Notion", "标签"],
    "confidence": 0.85,
    "rawInput": "原始摘要"
  }],
  "summary": "一句话总结"
}

只提取有意义的信息，忽略模板和空白页。只输出 JSON。

Notion 内容：
${docText.slice(0, 5000)}`;

  try {
    const { text: raw } = await completeText({ prompt, maxTokens: 2048 });
    const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();
    const parsed = JSON.parse(jsonStr) as { nodes?: object[]; summary?: string };
    return { nodes: parsed.nodes || [], summary: parsed.summary || '提取完成' };
  } catch { return { nodes: [], summary: '解析失败' }; }
}

/** 行里抽 title 列文本(供 titleSamples 判日历维度表)。 */
function rowTitle(row: NotionPageRow): string {
  const props = row.properties || {};
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (v?.type === 'title' && Array.isArray(v.title)) return v.title.map((t) => t.plain_text || '').join('');
  }
  return '';
}

/**
 * N-3:拉一个数据源的 schema + 行(rowCount 用实际行数,供 classify 判父子)。失败返回 null。
 * 关键修:补 titleSamples —— 否则 looksCalendarDim 只能看表名,日期行标题的表漏判成 log,
 * 每行倒成一张日期卡(用户实测的 2026-07-03 垃圾卡即此)。
 */
async function loadSource(token: string, sourceId: string): Promise<{ schema: NotionSourceSchema; rows: NotionPageRow[] } | null> {
  try {
    const schema = await getDataSourceSchema(token, sourceId);
    if (!schema) return null;
    const rows = await queryDataSourceRows(token, sourceId, MAX_ROWS_PER_DB);
    const titleSamples = rows.slice(0, 12).map(rowTitle).filter(Boolean);
    return { schema: { ...schema, rowCount: rows.length, titleSamples }, rows };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'notion', { limit: 15 });
  if (guard) return guard;

  // 批次 18:优先用 OAuth 授权存下的 token;body token 是老的内部集成用法,保留兼容。
  // Notion 修:再回落 Supabase integrations(iOS 授权在别的浏览器完成时,
  // token 只在云端,本机 cookie 没有)。
  const body = await req.json().catch(() => ({})) as { token?: string; databaseIds?: string[] };
  let token = body.token || req.cookies.get('nesio_notion_access')?.value || '';
  if (!token) {
    const cloud = await getIntegrationTokenRefreshed('notion');
    token = cloud?.accessToken || '';
  }
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/notion/connect' },
      { status: 401 },
    );
  }

  // N-3 结构折叠是正路:拉每个源的 schema + 行 → classifyDatabase 认结构角色 →
  // foldSourcesToMemories 把子表(划线/笔记)折进父表(书),一本书 = 一条记忆;日历/维度表和技术列丢。
  //
  // 关键修:折叠**不再只在用户成功「选表」时才走**。此前没选表就退回盲搜页面 /search,把日期行
  //   页面倒成日期垃圾卡(用户实测症结),且「选表」按钮一旦不响应就彻底进不了折叠。
  //   现在:没显式选表 → 自动 discovery 发现所有共享数据库、全量折叠(折叠本就需要父+子表同时在场,
  //   自动加载全部比手选单表更对);只有一个库都没有时才回落页面搜(松散页面场景)。
  const explicitIds = Array.isArray(body.databaseIds) ? body.databaseIds.filter(Boolean) : [];
  let sourceIds = explicitIds;
  if (!sourceIds.length) {
    try {
      const disc = await discoverDatabases(token);
      if (disc.ok && disc.databases.length) {
        sourceIds = disc.databases.map(primaryDataSourceId).slice(0, MAX_DATABASES);
      }
    } catch { /* 发现失败 → 落到下面页面搜兜底 */ }
  }

  if (sourceIds.length) {
    const schemas: NotionSourceSchema[] = [];
    const rowsBySource: Record<string, NotionPageRow[]> = {};
    for (const sourceId of sourceIds.slice(0, MAX_DATABASES)) {
      const loaded = await loadSource(token, sourceId);
      if (!loaded) continue;
      schemas.push(loaded.schema);
      rowsBySource[loaded.schema.id] = loaded.rows;
    }
    const memories = foldSourcesToMemories(schemas, rowsBySource);
    // 显式选表:即使折叠出 0 也返回(用户明确指定了,别再盲搜倒垃圾);
    // 自动发现:折叠出 0(全被判成日历/维度丢弃)才回落页面搜(可能是松散页面库)。
    if (explicitIds.length || memories.length) {
      const capped = memories.slice(0, MAX_TOTAL_ROWS);
      return NextResponse.json({
        ok: true,
        nodes: capped,
        summary: `按结构折叠导入 ${capped.length} 条记忆(子表已折进父条目)`,
        pageCount: capped.length,
        aiUsed: false,
        folded: true,
      });
    }
  }

  // Search recently edited pages(兜底:一个数据库都没发现,或自动折叠为空)
  let searchRes: Response;
  try {
    searchRes = await fetch(`${NOTION_API}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 30,
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'notion_unreachable' }, { status: 502 });
  }

  if (!searchRes.ok) {
    const status = searchRes.status;
    return NextResponse.json(
      { ok: false, error: status === 401 ? 'invalid_token' : `notion_${status}` },
      { status: status === 401 ? 401 : 502 },
    );
  }

  const searchData = await searchRes.json() as { results?: NotionPage[] };
  const pages = searchData.results?.slice(0, 6) || [];

  // 批次 31:token 有效但搜不到页面 = 集成没被授权任何页面(最常见的坑)。
  // 明确告诉用户去每个页面「…→ 连接 → 选中这个集成」,而不是静默返回 0。
  if (pages.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_shared_pages' }, { status: 200 });
  }

  // Fetch text for each page
  const pageContents = await Promise.all(
    pages.map(async (p) => ({
      id: p.id,
      title: extractTitle(p),
      text: await fetchPageText(token, p.id),
      url: p.url,
    })),
  );
  const contentPages = pageContents.filter((p) => p.text || p.title !== 'Untitled');

  const { nodes, summary } = await extractNodes(contentPages);

  // 批次 31:没配 Gemini(或 AI 解析空)时,别丢数据 —— 直接把每个 Notion 页面
  // 存成可读的记忆节点(标题 + 正文),用户至少能看到、能读。
  // 修「重同步堆重复」:兜底节点与页面 1:1,带上 notionPageId,ingestLifeNode 按
  //(source + notionPageId)幂等 upsert,重复点"同步"不再成倍入库。
  // (AI 提取路径每页可能产出多个实体,无法用单个 pageId 作幂等键,故仅兜底路径去重。)
  const finalNodes = nodes.length ? nodes : contentPages.map((p) => ({
    type: 'preference',
    name: (p.title || 'Notion').slice(0, 60),
    attributes: { source: 'Notion', notionPageId: p.id, ...(p.url ? { url: p.url } : {}), ...(p.text ? { article: p.text } : {}) },
    relations: [],
    tags: ['Notion'],
    confidence: 0.7,
    rawInput: (p.text || p.title).slice(0, 200),
  }));

  return NextResponse.json({
    ok: true,
    nodes: finalNodes,
    summary: nodes.length ? summary : `导入 ${contentPages.length} 个 Notion 页面`,
    pageCount: pages.length,
    aiUsed: nodes.length > 0,
  });
}
