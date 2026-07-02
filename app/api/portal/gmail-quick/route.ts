/**
 * GET /api/portal/gmail-quick
 * Lightweight email signal scan — metadata only, no body read, no AI.
 * Classifies subject lines with regex to detect actionable signals.
 * Designed to run every 20-30 min in the foreground; extremely cheap.
 * Output: { ok, signals: EmailSignal[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIntegrationToken } from '@/lib/portal/integrations';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export interface EmailSignal {
  id: string;
  type: string;   // 'flight' | 'hotel' | 'package' | 'appointment' | 'deadline' | 'bill' | 'reminder'
  subject: string;
  from: string;
  date: string;
  icon: string;
  cardTitle: string;
  cardBody: string;
  priority: number;
}

// ── Signal classification rules ──────────────────────────────────────────────

const SIGNAL_RULES: Array<{
  type: string;
  icon: string;
  priority: number;
  subjectRe: RegExp;
  fromRe?: RegExp;
  makeCard: (subject: string, from: string) => { title: string; body: string };
}> = [
  {
    type: 'flight',
    icon: '✈️',
    priority: 9,
    subjectRe: /机票|航班|flight|booking.?confirm|itinerary|e-ticket|电子客票|出行/i,
    makeCard: (subject) => ({
      title: '机票已确认',
      body: `"${subject.slice(0, 28)}" — 记得提前2小时到机场，核对证件。`,
    }),
  },
  {
    type: 'hotel',
    icon: '🏨',
    priority: 8,
    subjectRe: /酒店|hotel|check.?in|reservation.?confirm|住宿|民宿/i,
    makeCard: (subject) => ({
      title: '住宿已预订',
      body: `"${subject.slice(0, 28)}" — 出发前确认入住时间和地址。`,
    }),
  },
  {
    type: 'package',
    icon: '📦',
    priority: 7,
    subjectRe: /快递|包裹|delivery|package|shipped|order shipped|物流|派送|到件|签收/i,
    makeCard: (subject) => ({
      title: '有快递待签收',
      body: `"${subject.slice(0, 28)}" — 注意查收或安排代收。`,
    }),
  },
  {
    type: 'appointment',
    icon: '📅',
    priority: 9,
    subjectRe: /预约|appointment|你的预约|挂号|复诊|interview.?confirm|面试|约好|会面/i,
    makeCard: (subject) => ({
      title: '预约/面试提醒',
      body: `"${subject.slice(0, 28)}" — 提前确认时间和地点，备好材料。`,
    }),
  },
  {
    type: 'deadline',
    icon: '⏰',
    priority: 8,
    subjectRe: /due|截止|deadline|过期|expires|last.?day|最后一天|逾期|还款/i,
    makeCard: (subject) => ({
      title: '有截止日期提醒',
      body: `"${subject.slice(0, 28)}" — 检查是否需要今天处理。`,
    }),
  },
  {
    type: 'bill',
    icon: '💳',
    priority: 7,
    subjectRe: /账单|invoice|payment due|bill|缴费|扣款|还信用卡|月租|续费/i,
    makeCard: (subject) => ({
      title: '账单/扣款提醒',
      body: `"${subject.slice(0, 28)}" — 确认余额是否充足。`,
    }),
  },
  {
    type: 'verification',
    icon: '🔑',
    priority: 6,
    subjectRe: /验证码|verification code|confirm your email|邮箱验证|二次验证/i,
    makeCard: () => ({
      title: '验证码邮件',
      body: '收到验证邮件，需要的话及时处理（验证码通常有效期短）。',
    }),
  },
  {
    type: 'reminder',
    icon: '🔔',
    priority: 6,
    subjectRe: /reminder|提醒|don.?t forget|别忘了|温馨提示/i,
    makeCard: (subject) => ({
      title: '邮件提醒',
      body: `"${subject.slice(0, 28)}" — 查看详情确认是否需要操作。`,
    }),
  },
];

function classifySubject(subject: string, from: string): typeof SIGNAL_RULES[number] | null {
  for (const rule of SIGNAL_RULES) {
    if (rule.subjectRe.test(subject)) {
      if (rule.fromRe && !rule.fromRe.test(from)) continue;
      return rule;
    }
  }
  return null;
}

// ── Gmail metadata fetch ─────────────────────────────────────────────────────

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function hasLabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  return Boolean(configured && provided === configured && req.headers.get('x-baohe-access-mode') === 'personal_lab');
}

type GmailListItem = { id: string };
type GmailMeta = {
  id: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
  snippet?: string;
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

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Auth gate: session cookie OR stage5 secret
  const cookieStore = cookies();
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
    cookieStore.get('baohe_auth_refresh')?.value ||
    cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (!hasSession && !hasLabAccess(req)) {
    return NextResponse.json({ ok: false, error: 'auth_required', signals: [] }, { status: 401 });
  }

  let tokens = await getIntegrationToken('gmail');
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
  const seen = new Set<string>(); // deduplicate by signal type (show max 1 per type)

  for (const msg of messages) {
    const subject = hdr(msg, 'subject');
    const from = hdr(msg, 'from');
    const date = hdr(msg, 'date');
    if (!subject) continue;

    const rule = classifySubject(subject, from);
    if (!rule || seen.has(rule.type)) continue;
    seen.add(rule.type);

    const { title, body } = rule.makeCard(subject, from);
    signals.push({
      id: `${rule.type}-${msg.id}`,
      type: rule.type,
      subject,
      from,
      date,
      icon: rule.icon,
      cardTitle: title,
      cardBody: body,
      priority: rule.priority,
    });
  }

  // Sort by priority desc
  signals.sort((a, b) => b.priority - a.priority);

  return NextResponse.json({ ok: true, signals });
}
