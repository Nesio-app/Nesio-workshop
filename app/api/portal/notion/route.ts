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

export const dynamic = 'force-dynamic';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
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

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'notion', { limit: 15 });
  if (guard) return guard;

  const { token } = await req.json() as { token?: string };
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 });
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
        page_size: 8,
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

  // Fetch text for each page
  const pageContents = await Promise.all(
    pages.map(async (p) => ({
      title: extractTitle(p),
      text: await fetchPageText(token, p.id),
      url: p.url,
    })),
  );

  const { nodes, summary } = await extractNodes(pageContents.filter((p) => p.text || p.title !== 'Untitled'));

  return NextResponse.json({ ok: true, nodes, summary, pageCount: pages.length });
}
