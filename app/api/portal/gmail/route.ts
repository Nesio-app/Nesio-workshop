/**
 * GET /api/portal/gmail
 * Fetches the current user's Gmail messages using their OAuth token.
 * Token is read from Supabase (cross-device) or cookies (fallback).
 * Defaults to metadata-only status/preview. Body reads + Gemini extraction
 * require explicit query opt-in: ?includeBody=true&analyze=true.
 */
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSignal } from '@/lib/life-domain/create-signal';
import { writeCloudSignalsForCurrentUser } from '@/lib/platform/runtime/cloud-signals-server';
import { normalizeGmailToSignal } from '@/lib/life-domain/normalizers';
import { getIntegrationToken, saveIntegrationToken } from '@/lib/portal/integrations';
import { buildEmailExtractionPrompt, parseJsonBlock } from '@/lib/extraction/extraction';
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

async function requireAuthenticatedGmailAccess(req: NextRequest): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const hasNesioSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  if (hasNesioSession || hasStage5LabAccess(req) || noSupabase) return null;

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

function parseHeaderDate(value: string): string | undefined {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
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
  if (!listRes.ok) {
    // 403 有两种截然不同的病因,把 Google 的 reason 带出来一锤定音:
    // accessNotConfigured = GCP 项目没启用 Gmail API;insufficientPermissions = token 缺 scope
    let reason = '';
    try {
      const body = await listRes.json() as { error?: { errors?: Array<{ reason?: string }>; status?: string; message?: string } };
      reason = body.error?.errors?.[0]?.reason || body.error?.status || '';
    } catch { /* body 不是 JSON 就算了 */ }
    throw new Error(`gmail_list_${listRes.status}${reason ? `:${reason}` : ''}`);
  }

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

  const prompt = buildEmailExtractionPrompt(emailTexts);

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]';
  return parseJsonBlock<object[]>(raw) ?? [];
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
  const authFailure = await requireAuthenticatedGmailAccess(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const includeBody = url.searchParams.get('includeBody') === 'true';
  const shouldAnalyze = url.searchParams.get('analyze') === 'true';
  const metadataOnly = !includeBody;
  // Get token for current user (Supabase → cookies fallback)
  let tokens = await getIntegrationToken('gmail');

  // Gmail and Calendar consent share one Google authorization; if only the
  // calendar cookies survived, borrow its refresh token to mint a gmail one.
  if (!tokens?.refreshToken) {
    const calendarTokens = await getIntegrationToken('calendar');
    if (calendarTokens?.refreshToken) {
      tokens = { accessToken: tokens?.accessToken || '', refreshToken: calendarTokens.refreshToken };
    }
  }

  // 根因修复(批次 10):日历 route 一直是「会话门之后直接读 cookie」,而这里
  // 只走 getIntegrationToken——生产环境(配了 Supabase)默认禁用 cookie 回退,
  // 只读 Supabase;但 calendar/oauth 回调只写 cookie。结果就是用户看到的
  // 「日历 19 条正常、邮件永远授权失效」。requireAuthenticatedGmailAccess
  // 已在上面挡掉匿名请求,这里与日历 route 同构地把本设备 cookie 也列为
  // 候选;跨设备仍靠 Supabase。
  const cookieStore = await cookies();
  const cookieAccess = cookieStore.get('nesio_gmail_access')?.value
    || cookieStore.get('nesio_google_calendar_access')?.value || '';
  const cookieRefresh = cookieStore.get('nesio_gmail_refresh')?.value
    || cookieStore.get('nesio_google_calendar_refresh')?.value || '';
  const candidates: Array<{ accessToken: string; refreshToken?: string }> = [];
  if (tokens) candidates.push(tokens);
  if ((cookieAccess || cookieRefresh)
    && (cookieAccess !== tokens?.accessToken || cookieRefresh !== (tokens?.refreshToken || ''))) {
    candidates.push({ accessToken: cookieAccess, refreshToken: cookieRefresh || undefined });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' },
      { status: 401 },
    );
  }

  let messages: GmailMessage[] = [];
  let refreshedAccessToken: string | null = null;
  let winner: { accessToken: string; refreshToken?: string } | null = null;
  let sawAuthFailure = false;
  let lastError = '';

  // Supabase 里的 token 可能是陈旧的(旧授权残留),cookie 里的是最近一次
  // 授权写入的——逐个候选试:直接拉 → 401 就刷新再拉 → 都不行换下一个。
  for (const cand of candidates) {
    try {
      // accessToken may be '' when only a refresh token survives — 401s into the refresh path
      if (!cand.accessToken) throw new Error('gmail_list_401');
      messages = await fetchMessages(cand.accessToken, 10, metadataOnly);
      winner = cand;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('401')) { lastError = msg || 'gmail_fetch_failed'; continue; }
      if (!cand.refreshToken) { sawAuthFailure = true; continue; }
      const newToken = await refreshToken(cand.refreshToken);
      if (!newToken) { sawAuthFailure = true; continue; }
      try {
        messages = await fetchMessages(newToken, 10, metadataOnly);
        refreshedAccessToken = newToken;
        winner = cand;
        break;
      } catch (retryErr) {
        lastError = retryErr instanceof Error ? retryErr.message : 'gmail_fetch_failed';
      }
    }
  }

  if (!winner) {
    // 403 = token 有效但没有 gmail scope(旧的日历授权借来的 token)——
    // 唯一出路是走 /api/portal/gmail/connect 重新同意(带双 scope + prompt=consent)
    if (lastError.includes('403')) {
      // API 未启用是管理台问题,重新授权解决不了——分开报
      const apiDisabled = lastError.includes('accessNotConfigured') || lastError.includes('SERVICE_DISABLED');
      return NextResponse.json(
        {
          ok: false,
          error: apiDisabled ? 'gmail_api_disabled' : 'insufficient_scope',
          detail: lastError,
          connectUrl: '/api/portal/gmail/connect',
        },
        { status: 403 },
      );
    }
    if (sawAuthFailure || !lastError) {
      return NextResponse.json(
        { ok: false, error: 'token_expired', connectUrl: '/api/portal/gmail/connect' },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: false, error: lastError }, { status: 500 });
  }

  // 成功后把可用 token 回写 Supabase(登录会话有效时才真正写入),
  // 治愈「Supabase 存着旧 token、cookie 里才是新授权」的循环。
  await saveIntegrationToken('gmail', {
    accessToken: refreshedAccessToken || winner.accessToken,
    refreshToken: winner.refreshToken,
  }, req);

  const shouldCreateSignals = includeBody && shouldAnalyze;
  let nodes = shouldCreateSignals ? await extractNodes(messages) : [];

  // Fallback: if AI extraction returned nothing (no Gemini key or all filtered),
  // create basic nodes directly from email metadata so LifeGraph always has data.
  if (includeBody && nodes.length === 0 && messages.length > 0) {
    nodes = messages.map((m) => ({
      type: 'event' as const,
      name: header(m, 'subject') || 'Gmail 邮件',
      source: 'email' as const,
      confidence: 0.7,
      rawInput: `来自 ${header(m, 'from') || '未知'}: ${m.snippet?.slice(0, 120) || ''}`,
      tags: ['邮件', 'Gmail'],
      attributes: {
        date: header(m, 'date'),
        from: header(m, 'from'),
        emailId: m.id,
      },
      relations: [] as Array<{ targetId: string; relation: string }>,
    }));
  }

  // Ensure all nodes have source: 'email' so LifeGraph can filter by source
  nodes = nodes.map((n) => ({ source: 'email' as const, ...n }));
  const signals = shouldCreateSignals
    ? messages.map((message) => createSignal(normalizeGmailToSignal({
        id: message.id,
        subject: header(message, 'subject') || 'Gmail message',
        from: header(message, 'from'),
        snippet: extractText(message).slice(0, 240) || message.snippet || '',
        occurredAt: parseHeaderDate(header(message, 'date')),
      })))
    : [];
  const cloudSignalWrite = signals.length
    ? await writeCloudSignalsForCurrentUser(signals)
    : { ok: true, writesCloud: false, savedCount: 0 };

  const response = NextResponse.json({
    ok: true,
    metadataOnly,
    includeBody,
    analyze: shouldAnalyze,
    bodyRead: includeBody,
    aiAnalysisPerformed: includeBody && shouldAnalyze,
    messages: metadataPreview(messages),
    nodes,
    signalIds: signals.map((signal) => signal.id),
    signalCount: signals.length,
    cloudSignalWrite,
    count: nodes.length,
    emailCount: messages.length,
  });

  // Persist refreshed access token as cookie so the next request doesn't need to re-refresh
  if (refreshedAccessToken) {
    const secure = process.env.NODE_ENV === 'production';
    response.cookies.set('nesio_gmail_access', refreshedAccessToken, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 3600,
    });
  }

  return response;
}
