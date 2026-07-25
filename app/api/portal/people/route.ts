/**
 * GET /api/portal/people — 读取 Google 通讯录(免费最大化·Google 扩展授权 58b;人缘㊃ 加分组)。
 *
 * scope contacts.readonly 已在 58a 并入联合授权。拉联系人,映射成
 * { name, emails[], photo, birthday, groups[] },供邮件发件人身份富化(把 someone@x.com 变真名/头像)、
 * 「重要日子」(生日)、以及按 Google 联系人分组(家人/同事/自建组)分类管理。鉴权复用 resolveGmailAccessToken。
 *
 * 分组:personFields 加 memberships 拿到每人所属组的 resourceName,再 join contactGroups.list
 * 拿组的显示名。系统的「所有联系人/加星标」等泛组不算分类;识别系统 family 组 → 补「家人」标签
 * (跨语言稳,重点管理家庭成员)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PEOPLE = 'https://people.googleapis.com/v1';

interface Contact { name: string; emails: string[]; photo?: string; birthday?: string; groups?: string[] }

interface RawPerson {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number }; text?: string }>;
  memberships?: Array<{ contactGroupMembership?: { contactGroupResourceName?: string } }>;
}

// 系统泛组(不是分类):全部联系人/加星标/聊天/屏蔽 —— 不当分组标签。
const SKIP_GROUPS = new Set([
  'contactGroups/myContacts', 'contactGroups/all', 'contactGroups/starred',
  'contactGroups/chatBuddies', 'contactGroups/blocked',
]);
const FAMILY_GROUP = 'contactGroups/family';

function fmtBirthday(p: RawPerson): string | undefined {
  const b = p.birthdays?.[0]?.date;
  if (!b || !b.month || !b.day) return p.birthdays?.[0]?.text || undefined;
  const mm = String(b.month).padStart(2, '0');
  const dd = String(b.day).padStart(2, '0');
  return b.year ? `${b.year}-${mm}-${dd}` : `--${mm}-${dd}`; // 无年份用 --MM-DD(生日惯例)
}

export async function GET(req: NextRequest) {
  // 红线:读私密数据(Google 通讯录)必须过 guardAiRoute(验真会话 + 限流)。
  const guard = await guardAiRoute(req, 'people', { limit: 20 });
  if (guard) return guard;
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    // 组名映射:resourceName → 显示名(contactGroups.list;失败不致命,退化为无分组)
    const groupName = new Map<string, string>();
    try {
      const gRes = await fetch(`${PEOPLE}/contactGroups?pageSize=1000`, { headers });
      if (gRes.ok) {
        const groups = (await gRes.json() as { contactGroups?: Array<{ resourceName?: string; formattedName?: string; name?: string }> }).contactGroups || [];
        for (const g of groups) {
          if (g.resourceName && !SKIP_GROUPS.has(g.resourceName)) groupName.set(g.resourceName, (g.formattedName || g.name || '').trim());
        }
      }
    } catch { /* 组拉取失败 → 无分组,不影响联系人本体 */ }

    const url = `${PEOPLE}/people/me/connections?personFields=names,emailAddresses,photos,birthdays,memberships&pageSize=500&sortOrder=LAST_MODIFIED_DESCENDING`;
    const res = await fetch(url, { headers });
    if (!res.ok) return NextResponse.json({ ok: false, error: `people_${res.status}` }, { status: 502 });
    const conns = (await res.json() as { connections?: RawPerson[] }).connections || [];

    const contacts: Contact[] = [];
    for (const p of conns) {
      const name = p.names?.[0]?.displayName?.trim();
      const emails = (p.emailAddresses || []).map((e) => e.value?.trim()).filter((v): v is string => !!v);
      if (!name && !emails.length) continue; // 无名无邮箱的空条目丢弃
      // 头像取非默认(default=true 是 Google 的灰头像占位,不要)
      const photo = p.photos?.find((ph) => ph.url && !ph.default)?.url;

      const groupSet = new Set<string>();
      let isFamily = false;
      for (const m of p.memberships || []) {
        const rn = m.contactGroupMembership?.contactGroupResourceName;
        if (!rn || SKIP_GROUPS.has(rn)) continue;
        if (rn === FAMILY_GROUP) isFamily = true;
        const nm = groupName.get(rn);
        if (nm) groupSet.add(nm);
      }
      const groups = [...groupSet];
      // 系统 family 组跨语言可能叫 Family/家人/…;补一个规范「家人」标签,保证家庭识别不受账号语言影响
      if (isFamily && !groups.some((g) => /家人|家庭|family/i.test(g))) groups.push('家人');

      contacts.push({ name: name || emails[0], emails, photo, birthday: fmtBirthday(p), ...(groups.length ? { groups } : {}) });
    }
    return NextResponse.json({ ok: true, contacts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'people_unreachable' }, { status: 502 });
  }
}
