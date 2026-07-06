/**
 * POST /api/portal/gmail/send
 * Sends an email as the logged-in user via their Gmail OAuth token (gmail.send).
 * Every send is user-initiated: the client posts the exact To / Subject / Body
 * the user typed and clicked "发送" on. When `emailId` is supplied the reply is
 * threaded onto the original conversation (In-Reply-To / References / threadId).
 *
 * Body: { to, subject, body, emailId? }
 * Returns: { ok, id, threadId } | { ok:false, error, connectUrl? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveGmailAccessToken, hasNesioSession } from '@/lib/portal/gmail-access';
import { isRateLimited } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

type Headers = Array<{ name: string; value: string }>;

function headerOf(headers: Headers | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

/** RFC 2047 encoded-word so non-ASCII subjects (中文) survive transit. */
function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fetchThreadingHeaders(accessToken: string, emailId: string): Promise<{
  threadId?: string; messageId?: string; references?: string; subject?: string;
}> {
  try {
    const res = await fetch(
      `${GMAIL_API}/users/me/messages/${emailId}?format=metadata`
        + '&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return {};
    const data = await res.json() as { threadId?: string; payload?: { headers?: Headers } };
    const headers = data.payload?.headers;
    return {
      threadId: data.threadId,
      messageId: headerOf(headers, 'Message-ID'),
      references: headerOf(headers, 'References'),
      subject: headerOf(headers, 'Subject'),
    };
  } catch { return {}; }
}

export async function POST(req: NextRequest) {
  if (!(await hasNesioSession())) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  // 已登录用户也不能无节流批量发信。
  if (isRateLimited(req, 'gmail-send', { limit: 20 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited', retryAfterMs: 30_000 }, { status: 429 });
  }

  let payload: { to?: string; subject?: string; body?: string; emailId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const to = (payload.to || '').trim();
  const body = (payload.body || '').trim();
  let subject = (payload.subject || '').trim();
  const emailId = (payload.emailId || '').trim();

  if (!to || !to.includes('@')) {
    return NextResponse.json({ ok: false, error: 'invalid_recipient' }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 });
  }

  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' },
      { status: 401 },
    );
  }

  // Threading: pull the original's Message-ID / References / Subject when replying.
  let threadId: string | undefined;
  let inReplyTo = '';
  let references = '';
  if (emailId) {
    const th = await fetchThreadingHeaders(accessToken, emailId);
    threadId = th.threadId;
    if (th.messageId) {
      inReplyTo = th.messageId;
      references = [th.references, th.messageId].filter(Boolean).join(' ');
    }
    if (!subject && th.subject) {
      subject = /^re:/i.test(th.subject) ? th.subject : `Re: ${th.subject}`;
    }
  }

  const lines = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject || '(no subject)')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  // base64 body, CRLF-wrapped at 76 chars per MIME
  const encodedBody = Buffer.from(body, 'utf-8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const mime = `${lines.join('\r\n')}\r\n\r\n${encodedBody}`;
  const raw = toBase64Url(mime);

  const sendRes = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });

  if (!sendRes.ok) {
    let detail = '';
    try {
      const errBody = await sendRes.json() as { error?: { message?: string; status?: string } };
      detail = errBody.error?.message || errBody.error?.status || '';
    } catch { /* non-JSON */ }
    // 403 on a valid token = missing gmail.send scope → user must re-consent.
    if (sendRes.status === 403) {
      return NextResponse.json(
        { ok: false, error: 'insufficient_scope', detail, connectUrl: '/api/portal/gmail/connect' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'send_failed', detail, status: sendRes.status },
      { status: 502 },
    );
  }

  const sent = await sendRes.json() as { id?: string; threadId?: string };
  return NextResponse.json(
    { ok: true, id: sent.id, threadId: sent.threadId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
