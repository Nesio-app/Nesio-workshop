/**
 * GET /api/portal/gmail
 * Fetches recent Gmail messages and returns AI-extracted Life Graph nodes.
 * Uses stored HttpOnly access token (set by /callback).
 * If token expired, attempts refresh using refresh token.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
    body?: { data?: string };
  };
};

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractTextFromPayload(msg: GmailMessage): string {
  const parts = msg.payload?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data).slice(0, 2000);
      }
    }
  }
  if (msg.payload?.body?.data) {
    return decodeBase64Url(msg.payload.body.data).slice(0, 2000);
  }
  return msg.snippet || '';
}

function getHeader(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: envValue('GOOGLE_CLIENT_ID'),
      client_secret: envValue('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token || null;
}

async function fetchEmailNodes(accessToken: string, maxMessages = 10): Promise<object[]> {
  // List recent messages
  const listRes = await fetch(
    `${GMAIL_API}/users/me/messages?maxResults=${maxMessages}&q=is:unread OR newer_than:3d`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!listRes.ok) throw new Error(`gmail_list_${listRes.status}`);
  const listData = await listRes.json() as { messages?: Array<{ id: string }> };
  const messageIds = listData.messages?.slice(0, maxMessages) || [];

  if (!messageIds.length) return [];

  // Fetch message details in parallel
  const messages = await Promise.all(
    messageIds.map(async ({ id }) => {
      const res = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return res.ok ? await res.json() as GmailMessage : null;
    }),
  );

  // Build text summaries for AI
  const emailTexts = messages
    .filter((m): m is GmailMessage => m !== null)
    .map((m) => {
      const subject = getHeader(m, 'subject');
      const from = getHeader(m, 'from');
      const date = getHeader(m, 'date');
      const body = extractTextFromPayload(m);
      return `邮件主题：${subject}\n发件人：${from}\n日期：${date}\n内容：${body}`;
    })
    .join('\n\n---\n\n');

  // AI extraction
  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey) return [];

  const prompt = `你是 Nesio 的邮件解析器。从以下邮件中提取人物、事件、承诺、地点、日期等生活记忆节点。

输出 JSON 数组，每个节点格式：
{
  "type": "person"|"event"|"commitment"|"place"|"object"|"health_state",
  "name": "节点名称",
  "attributes": { "key": "value" },
  "relations": [{"targetId": "关联名称", "relation": "关系类型"}],
  "tags": ["邮件", "标签"],
  "confidence": 0.0-1.0,
  "rawInput": "原始文字"
}

只提取有实际意义的信息（预约、承诺、人名、地点、日期）。忽略广告和营销邮件。
输出纯 JSON 数组，不要其他文字。

邮件内容：
${emailTexts.slice(0, 6000)}`;

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]';

  const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();
  return JSON.parse(jsonStr) as object[];
}

export async function GET() {
  const cookieStore = cookies();
  let accessToken = cookieStore.get('nesio_gmail_access')?.value;
  const refreshToken = cookieStore.get('nesio_gmail_refresh')?.value;

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });
  }

  let nodes: object[] = [];
  let refreshed = false;

  try {
    if (!accessToken && refreshToken) {
      const newToken = await refreshAccessToken(refreshToken);
      if (!newToken) return NextResponse.json({ ok: false, error: 'token_expired' }, { status: 401 });
      accessToken = newToken;
      refreshed = true;
    }

    nodes = await fetchEmailNodes(accessToken!, 10);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';

    // Try token refresh if 401
    if (msg.includes('401') && refreshToken) {
      const newToken = await refreshAccessToken(refreshToken);
      if (newToken) {
        try { nodes = await fetchEmailNodes(newToken, 10); refreshed = true; }
        catch { return NextResponse.json({ ok: false, error: 'gmail_fetch_failed' }, { status: 500 }); }
      } else {
        return NextResponse.json({ ok: false, error: 'token_expired', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });
      }
    } else {
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  const response = NextResponse.json({ ok: true, nodes, count: nodes.length, refreshed });

  // Update access token cookie if refreshed
  if (refreshed && accessToken) {
    response.cookies.set('nesio_gmail_access', accessToken, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/', maxAge: 3600,
    });
  }

  return response;
}
