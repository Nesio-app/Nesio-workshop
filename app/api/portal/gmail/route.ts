/**
 * GET /api/portal/gmail
 * Fetches the current user's Gmail messages using their OAuth token.
 * Token is read from Supabase (cross-device) or cookies (fallback).
 * Defaults to metadata-only status/preview. Body reads + Gemini extraction
 * require explicit query opt-in: ?includeBody=true&analyze=true.
 */
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getIntegrationToken } from '@/lib/portal/integrations';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function hasStage5LabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  return Boolean(configured && provided === configured && accessMode === 'personal_lab');
}

function requireAuthenticatedGmailAccess(req: NextRequest): NextResponse | null {
  const cookieStore = cookies();
  const hasNesioSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (hasNesioSession || hasStage5LabAccess(req)) return null;

  return NextResponse.json(
    {
      ok: false,
      error: 'gmail_auth_required',
      metadataOnly: true,
      includeBody: false,
      analyze: false,
      bodyRead: false,
      aiAnalysisPerformed: false,
      messages: [],
      nodes: [],
      emailCount: 0,
      connectUrl: '/settings',
    },
    { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
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
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch { return ''; }
}

function extractText(msg: GmailMessage): string {
  const parts = msg.payload?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data).slice(0, 1500);
      }
    }
  }
  if (msg.payload?.body?.data) {
    return decodeBase64Url(msg.payload.body.data).slice(0, 1500);
  }
  return msg.snippet?.slice(0, 400) || '';
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function refreshToken(refreshTk: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshTk,
      client_id: envValue('GOOGLE_CLIENT_ID'),
      client_secret: envValue('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token || null;
}

async function fetchMessages(accessToken: string, max = 10, metadataOnly = true): Promise<GmailMessage[]> {
  const listRes = await fetch(
    `${GMAIL_API}/users/me/messages?maxResults=${max}&q=newer_than:7d`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) throw new Error(`gmail_list_${listRes.status}`);

  const listData = await listRes.json() as { messages?: Array<{ id: string }> };
  const ids = listData.messages || [];
  if (!ids.length) return [];

  const messages = await Promise.all(
    ids.slice(0, max).map(async ({ id }) => {
      const res = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=${metadataOnly ? 'metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date' : 'full'}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return null;
      return res.json() as Promise<GmailMessage>;
    }),
  );
  return messages.filter((m): m is GmailMessage => m !== null);
}

async function extractNodes(messages: GmailMessage[]): Promise<object[]> {
  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey || !messages.length) return [];

  const emailTexts = messages.map((m) => {
    const subject = header(m, 'subject');
    const from = header(m, 'from');
    const date = header(m, 'date');
    const body = extractText(m);
    return `主题：${subject}\n发件人：${from}\n日期：${date}\n内容：${body}`;
  }).join('\n\n───\n\n');

  const prompt = `你是 Nesio 的邮件解析器。从邮件中提取有意义的生活记忆节点。

只提取：预约/约会、承诺、重要日期、人名、地点。忽略广告、营销、自动通知。

输出 JSON 数组（每封邮件最多 2 个节点）：
[{
  "type": "event"|"commitment"|"person"|"place"|"health_state",
  "name": "简短名称",
  "attributes": { "date": "日期", "location": "地点", "source": "发件人" },
  "relations": [{ "targetId": "关联人名", "relation": "involves" }],
  "tags": ["邮件", "分类"],
  "confidence": 0.85,
  "rawInput": "原始摘要（50字以内）"
}]

输出纯 JSON 数组，不要任何其他文字。

邮件内容：
${emailTexts.slice(0, 5000)}`;

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]';
  const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();

  try { return JSON.parse(jsonStr) as object[]; }
  catch { return []; }
}

function metadataPreview(messages: GmailMessage[]) {
  return messages.map((m) => ({
    id: m.id,
    subject: header(m, 'subject'),
    from: header(m, 'from'),
    date: header(m, 'date'),
    snippetPreview: m.snippet ? `${m.snippet.slice(0, 80)}${m.snippet.length > 80 ? '…' : ''}` : '',
  }));
}

export async function GET(req: NextRequest) {
  const authFailure = requireAuthenticatedGmailAccess(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const includeBody = url.searchParams.get('includeBody') === 'true';
  const shouldAnalyze = url.searchParams.get('analyze') === 'true';
  const metadataOnly = !includeBody;
  // Get token for current user (Supabase → cookies fallback)
  let tokens = await getIntegrationToken('gmail');

  if (!tokens) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' },
      { status: 401 },
    );
  }

  let messages: GmailMessage[] = [];

  try {
    messages = await fetchMessages(tokens.accessToken, 10, metadataOnly);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';

    // Try token refresh on 401
    if (msg.includes('401') && tokens.refreshToken) {
      const newToken = await refreshToken(tokens.refreshToken);
      if (!newToken) {
        return NextResponse.json(
          { ok: false, error: 'token_expired', connectUrl: '/api/portal/gmail/connect' },
          { status: 401 },
        );
      }
      tokens = { ...tokens, accessToken: newToken };
      try { messages = await fetchMessages(newToken, 10, metadataOnly); }
      catch {
        return NextResponse.json({ ok: false, error: 'gmail_fetch_failed' }, { status: 500 });
      }
    } else {
      return NextResponse.json({ ok: false, error: msg || 'gmail_fetch_failed' }, { status: 500 });
    }
  }

  const nodes = includeBody && shouldAnalyze ? await extractNodes(messages) : [];

  return NextResponse.json({
    ok: true,
    metadataOnly,
    includeBody,
    analyze: shouldAnalyze,
    bodyRead: includeBody,
    aiAnalysisPerformed: includeBody && shouldAnalyze,
    messages: metadataPreview(messages),
    nodes,
    count: nodes.length,
    emailCount: messages.length,
  });
}
