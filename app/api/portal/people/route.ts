/**
 * GET /api/portal/people — 读取 Google 通讯录(免费最大化·Google 扩展授权 58b)。
 *
 * scope contacts.readonly 已在 58a 并入联合授权。拉联系人,映射成
 * { name, emails[], photo, birthday },供邮件发件人身份富化(把 someone@x.com 变真名/头像)
 * 和「重要日子」(生日)。鉴权复用 resolveGmailAccessToken。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PEOPLE = 'https://people.googleapis.com/v1';

interface Contact { name: string; emails: string[]; photo?: string; birthday?: string }

interface RawPerson {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number }; text?: string }>;
}

function fmtBirthday(p: RawPerson): string | undefined {
  const b = p.birthdays?.[0]?.date;
  if (!b || !b.month || !b.day) return p.birthdays?.[0]?.text || undefined;
  const mm = String(b.month).padStart(2, '0');
  const dd = String(b.day).padStart(2, '0');
  return b.year ? `${b.year}-${mm}-${dd}` : `--${mm}-${dd}`; // 无年份用 --MM-DD(生日惯例)
}

export async function GET(req: NextRequest) {
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });
  }
  try {
    const url = `${PEOPLE}/people/me/connections?personFields=names,emailAddresses,photos,birthdays&pageSize=500&sortOrder=LAST_MODIFIED_DESCENDING`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return NextResponse.json({ ok: false, error: `people_${res.status}` }, { status: 502 });
    const conns = (await res.json() as { connections?: RawPerson[] }).connections || [];

    const contacts: Contact[] = [];
    for (const p of conns) {
      const name = p.names?.[0]?.displayName?.trim();
      const emails = (p.emailAddresses || []).map((e) => e.value?.trim()).filter((v): v is string => !!v);
      if (!name && !emails.length) continue; // 无名无邮箱的空条目丢弃
      // 头像取非默认(default=true 是 Google 的灰头像占位,不要)
      const photo = p.photos?.find((ph) => ph.url && !ph.default)?.url;
      contacts.push({ name: name || emails[0], emails, photo, birthday: fmtBirthday(p) });
    }
    return NextResponse.json({ ok: true, contacts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'people_unreachable' }, { status: 502 });
  }
}
