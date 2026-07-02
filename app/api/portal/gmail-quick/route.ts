/**
 * GET /api/portal/gmail-quick
 * HTTP adapter for the Email Signal Engine (lib/platform/email-signals).
 * Fetches Gmail metadata only (no body), classifies subjects with regex, no AI.
 * Designed for 20-min polling; extremely cheap.
 * Output: { ok, signals: EmailSignal[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIntegrationToken } from '@/lib/portal/integrations';
import { cookies } from 'next/headers';
import { buildEmailSignal, type EmailSignal } from '@/lib/platform/email-signals';

export const dynamic = 'force-dynamic';

// Re-export so TodayFeed.tsx can import EmailSignal from one place
export type { EmailSignal };

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function hasLabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  return Boolean(configured && provided === configured && req.headers.get('x-baohe-access-mode') === 'personal_lab');
}

// ── Gmail metadata fetch ──────────────────────────────────────────────────────

type GmailListItem = { id: string };
type GmailMeta = {
  id: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

function hdr(msg: GmailMeta, name: string): string {
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

async function fetchMetadata(accessToken: string): Promise<GmailMeta[]> {
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1';
  const listRes = await fetch(
    `${GMAIL}/users/me/messages?maxResults=20&q=newer_than:1d`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) throw new Error(`gmail_list_${listRes.status}`);
  const listData = await listRes.json() as { messages?: GmailListItem[] };
  const ids = (listData.messages || []).slice(0, 20);
  if (!ids.length) return [];

  const msgs = await Promise.all(ids.map(async ({ id }) => {
    const res = await fetch(
      `${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    return res.json() as Promise<GmailMeta>;
  }));
  return msgs.filter((m): m is GmailMeta => m !== null);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const cookieStore = cookies();
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
    cookieStore.get('baohe_auth_refresh')?.value ||
    cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (!hasSession && !hasLabAccess(req)) {
    return NextResponse.json({ ok: false, error: 'auth_required', signals: [] }, { status: 401 });
  }

  const tokens = await getIntegrationToken('gmail');
  if (!tokens) {
    return NextResponse.json({ ok: false, error: 'not_connected', signals: [] }, { status: 200 });
  }

  let messages: GmailMeta[];
  try {
    messages = await fetchMetadata(tokens.accessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('401') && tokens.refreshToken) {
      const newToken = await refreshToken(tokens.refreshToken);
      if (!newToken) return NextResponse.json({ ok: false, error: 'token_expired', signals: [] });
      try { messages = await fetchMetadata(newToken); }
      catch { return NextResponse.json({ ok: false, error: 'fetch_failed', signals: [] }); }
    } else {
      return NextResponse.json({ ok: false, error: msg || 'fetch_failed', signals: [] });
    }
  }

  const signals: EmailSignal[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    const subject = hdr(msg, 'subject');
    const from = hdr(msg, 'from');
    const date = hdr(msg, 'date');
    if (!subject) continue;

    const signal = buildEmailSignal(msg.id, subject, from, date);
    if (!signal || seen.has(signal.type)) continue;
    seen.add(signal.type);
    signals.push(signal);
  }

  signals.sort((a, b) => b.priority - a.priority);
  return NextResponse.json({ ok: true, signals });
}
