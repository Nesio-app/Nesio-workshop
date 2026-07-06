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
import { notionRowToNode, notionDbTitle, type NotionRow } from '@/lib/portal/notion-map';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MAX_DATABASES = 8;       // 一次最多同步几个表
const MAX_ROWS_PER_DB = 100;   // 每个表最多取多少行(Notion 单页上限)
const MAX_TOTAL_ROWS = 400;    // 总行数上限,防止灌爆记忆
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

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
  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey || !pages.length) return { nodes: [], summary: '无内容' };

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
    const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();
    const parsed = JSON.parse(jsonStr) as { nodes?: object[]; summary?: string };
    return { nodes: parsed.nodes || [], summary: parsed.summary || '提取完成' };
  } catch { return { nodes: [], summary: '解析失败' }; }
}

const notionHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
});

async function fetchDbTitle(token: string, dbId: string): Promise<string> {
  try {
    const res = await fetch(`${NOTION_API}/databases/${dbId}`, { headers: notionHeaders(token) });
    if (!res.ok) return 'Notion 表';
    return notionDbTitle(await res.json() as { title?: unknown });
  } catch { return 'Notion 表'; }
}

/** 查询一个数据库的行,每行 → 一个记忆节点(批次 38 的核心:row-as-node)。 */
async function queryDatabaseRows(token: string, dbId: string, dbTitle: string): Promise<object[]> {
  try {
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ page_size: MAX_ROWS_PER_DB }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: NotionRow[] };
    return (data.results || []).map((row) => notionRowToNode(row, dbTitle));
  } catch { return []; }
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'notion', { limit: 15 });
  if (guard) return guard;

  // 批次 18:优先用 OAuth 授权存下的 cookie token(像 flomo 连 Notion 那样
  // 一键授权、选页面);body token 是老的内部集成用法,保留兼容
  const body = await req.json().catch(() => ({})) as { token?: string; databaseIds?: string[] };
  const token = body.token || req.cookies.get('nesio_notion_access')?.value || '';
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/notion/connect' },
      { status: 401 },
    );
  }

  // 批次 38:用户选定了数据库 → 每行存成一条记忆(结构化,字段进属性/标签/日期)。
  const databaseIds = Array.isArray(body.databaseIds) ? body.databaseIds.filter(Boolean) : [];
  if (databaseIds.length) {
    const nodes: object[] = [];
    for (const dbId of databaseIds.slice(0, MAX_DATABASES)) {
      const title = await fetchDbTitle(token, dbId);
      const rows = await queryDatabaseRows(token, dbId, title);
      nodes.push(...rows);
      if (nodes.length >= MAX_TOTAL_ROWS) break;
    }
    const capped = nodes.slice(0, MAX_TOTAL_ROWS);
    return NextResponse.json({
      ok: true,
      nodes: capped,
      summary: `从 ${Math.min(databaseIds.length, MAX_DATABASES)} 个表导入 ${capped.length} 行`,
      pageCount: capped.length,
      aiUsed: false,
    });
  }

  // Search recently edited pages
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
