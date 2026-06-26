/**
 * POST /api/portal/ingest
 * Universal inbound ingestion endpoint.
 * Any data source that lacks a public API (Apple Reminders, Keep, WeChat Reading,
 * Toggl exports, automation tools) can POST raw text/JSON here, optionally via
 * iOS Shortcuts, and Nesio runs it through the analyzer into Life Graph nodes.
 *
 * Body: { source: string, content: string, secret?: string }
 * Returns: { ok, nodes, summary }
 *
 * `secret` is an optional per-user ingest token. When INGEST_SHARED_SECRET is set
 * server-side, the request must match it (for webhook security). When unset, the
 * endpoint is open (relies on the unguessable nature of the deploy URL for MVP).
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

const SOURCE_HINTS: Record<string, string> = {
  reminder: '这是来自 Apple 提醒事项的待办。提取为 commitment 节点，标注截止日期。',
  keep: '这是来自 Keep 的运动健康数据。提取为 health_state 节点（运动类型、时长、卡路里）。',
  wechat_reading: '这是来自微信读书的阅读数据。提取为 preference 节点（书名、作者、进度、笔记）。',
  toggl: '这是来自 Toggl 的时间记录。提取为 event 节点（项目、任务、时长）。',
  shortcuts: '这是来自 iOS 快捷指令的数据。根据内容判断类型。',
  generic: '根据内容判断最合适的节点类型。',
};

async function extractNodes(source: string, content: string): Promise<{ nodes: object[]; summary: string }> {
  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  const hint = SOURCE_HINTS[source] || SOURCE_HINTS.generic;

  if (!geminiKey) {
    // Rule-based fallback
    return {
      nodes: [{
        type: source === 'reminder' ? 'commitment' : source === 'keep' ? 'health_state' : source === 'wechat_reading' ? 'preference' : 'object',
        name: content.slice(0, 40),
        attributes: { source, raw: content.slice(0, 200) },
        relations: [],
        tags: [source],
        confidence: 0.65,
        rawInput: content.slice(0, 200),
      }],
      summary: `已记录来自 ${source} 的数据`,
    };
  }

  const prompt = `你是 Nesio 的数据解析器。${hint}

将以下数据提取为结构化生活记忆节点，输出 JSON：
{
  "nodes": [{
    "type": "person|object|place|event|commitment|health_state|preference",
    "name": "简短名称",
    "attributes": { "key": "value", "source": "${source}" },
    "relations": [{"targetId": "关联名", "relation": "关系"}],
    "tags": ["${source}", "标签"],
    "confidence": 0.85,
    "rawInput": "原始摘要"
  }],
  "summary": "一句话总结"
}

只输出 JSON，不要其他文字。

数据来源：${source}
内容：
${content.slice(0, 5000)}`;

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
    return { nodes: parsed.nodes || [], summary: parsed.summary || '已记录' };
  } catch {
    return {
      nodes: [{ type: 'object', name: content.slice(0, 40), attributes: { source }, relations: [], tags: [source], confidence: 0.6, rawInput: content.slice(0, 200) }],
      summary: '已记录',
    };
  }
}

export async function POST(req: NextRequest) {
  let body: { source?: string; content?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    // Allow raw text body (for simple Shortcuts)
    const text = await req.text();
    body = { source: 'shortcuts', content: text };
  }

  const sharedSecret = envValue('INGEST_SHARED_SECRET');
  if (sharedSecret && body.secret !== sharedSecret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const source = (body.source || 'generic').toLowerCase();
  const content = (body.content || '').trim();
  if (!content) {
    return NextResponse.json({ ok: false, error: 'empty_content' }, { status: 400 });
  }

  const { nodes, summary } = await extractNodes(source, content);
  return NextResponse.json({ ok: true, source, nodes, summary, count: nodes.length });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description: 'Universal ingest endpoint. POST { source, content } to extract Life Graph nodes.',
    sources: Object.keys(SOURCE_HINTS),
    shortcutsUsage: 'In iOS Shortcuts: Get Contents of URL → POST → /api/portal/ingest with JSON { source, content }',
  });
}
