/**
 * 连接器同步核心(纯数据层,无 UI)—— ConnectorsHub 的各「同步」按钮与
 * 记忆页下拉刷新共用同一实现,不留双实现。每个 run* 返回结构化结果,
 * UI 决定 toast/重试;失败都有明确 error(设计红线:异步动作必有可见失败态)。
 */
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

/* ---------- Plaid 银行流水(增量游标在服务端 cookie;本机 IDB 留最近 5000 笔) ---------- */

export interface PlaidSyncResult {
  ok: boolean;
  error?: string;                 // 'not_connected' | 'relink_required' | 其他
  fresh: number; total: number; accounts: number; pending: number; withLogo: number;
  // 投资拉取诊断(有投资账户但没数据时的可见失败态用)。
  investments?: { accounts: number; holdings: number; transactions: number; error?: string };
}

export async function runPlaidSync(): Promise<PlaidSyncResult> {
  const fail = (error: string): PlaidSyncResult => ({ ok: false, error, fresh: 0, total: 0, accounts: 0, pending: 0, withLogo: 0 });
  try {
    // 财务㉑:富化回填 —— 每设备一次全量重拉,按 id 覆盖补齐,之后回到增量
    let full = false;
    try { full = !localStorage.getItem('nesio-plaid-enrich-v1'); } catch { /* ignore */ }
    const res = await fetch(`/api/portal/plaid/transactions${full ? '?full=1' : ''}`);
    const data = await res.json() as {
      ok?: boolean; error?: string; pendingItems?: number; authoritative?: boolean;
      transactions?: Array<{ id: string; accountId?: string; date: string; name: string; amount: number; currency: string; category: string }>;
      removedIds?: string[]; accounts?: unknown[]; holdings?: unknown[];
      investments?: { accounts?: number; holdings?: number; transactions?: number; error?: string };
    };
    if (data.accounts?.length) {
      const { saveBankAccounts } = await import('@/lib/portal/bank-tx');
      // 财务⑧:账户全量拉齐(authoritative)时整体替换,让重复授权的旧账户退场
      saveBankAccounts(data.accounts as Array<{ id: string; name: string; currency: string }>, { replace: data.authoritative === true });
    }
    if (Array.isArray(data.holdings) && data.holdings.length) {
      const { saveHoldings } = await import('@/lib/portal/bank-tx');
      saveHoldings(data.holdings as never); // 财务㉗:持仓快照,非空才替换
    }
    if (!data.ok) return fail(data.error || 'unknown');
    // 增量合并:按 id upsert、删 removed、日期降序留最近 5000 笔
    const { loadBankTx, saveBankTx } = await import('@/lib/portal/bank-tx');
    type Tx = { id: string; accountId?: string; date: string; name: string; amount: number; currency: string; category: string };
    const existing: Tx[] = loadBankTx();
    const removed = new Set(data.removedIds || []);
    const byId = new Map<string, Tx>();
    for (const t of existing) if (!removed.has(t.id)) byId.set(t.id, t);
    let fresh = 0;
    for (const t of (data.transactions || [])) { if (!byId.has(t.id)) fresh++; byId.set(t.id, t); }
    const merged = [...byId.values()]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 5000);
    saveBankTx(merged);
    try { localStorage.setItem('nesio-bank-synced-at', new Date().toISOString()); } catch { /* quota */ }
    if (full) { try { localStorage.setItem('nesio-plaid-enrich-v1', '1'); } catch { /* quota */ } }
    const withLogo = merged.filter((t) => (t as { merchantLogo?: string }).merchantLogo).length;
    const inv = data.investments;
    return {
      ok: true, fresh, total: merged.length, accounts: data.accounts?.length || 0, pending: data.pendingItems || 0, withLogo,
      ...(inv ? { investments: { accounts: inv.accounts || 0, holdings: inv.holdings || 0, transactions: inv.transactions || 0, error: inv.error } } : {}),
    };
  } catch { return fail('network'); }
}

/* ---------- Flomo 笔记(全量翻页,按 slug 去重只进增量) ---------- */

export interface FlomoSyncResult { ok: boolean; fresh: number; error?: string }

export async function runFlomoSync(): Promise<FlomoSyncResult> {
  try {
    const res = await fetch('/api/portal/flomo?limit=5000');
    const data = await res.json() as { ok?: boolean; memos?: Array<{ content: string; created_at: string; tags: string[]; slug?: string }>; error?: string };
    if (!data.ok) return { ok: false, fresh: 0, error: data.error || 'not_configured' };
    const { getLifeGraph } = await import('@/lib/portal/life-graph');
    const existingSlugs = new Set(getLifeGraph().map((n) => n.attributes?.flomoSlug as string).filter(Boolean));
    const fresh = (data.memos || []).filter((m) => !existingSlugs.has(m.slug || ''));
    // 全量导入:首次整库入,之后只进增量;写失败由 storage-health 弹可见提示
    for (const m of fresh) {
      ingestLifeNode({
        type: 'preference',
        name: m.content.replace(/<[^>]+>/g, '').slice(0, 40),
        attributes: { source: 'Flomo', created: m.created_at, flomoSlug: m.slug || '' },
        relations: [],
        tags: ['Flomo', ...(m.tags || [])],
        confidence: 0.9,
        rawInput: m.content.replace(/<[^>]+>/g, '').slice(0, 200),
        source: 'manual',
      });
    }
    if (fresh.length) window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
    return { ok: true, fresh: fresh.length };
  } catch { return { ok: false, fresh: 0, error: 'network' }; }
}

/* ---------- 日历(本地表整体替换 + 近 60 天事件进记忆;时间变了会更新) ---------- */

export interface CalendarSyncResult { ok: boolean; count: number; added: number; error?: string }

/** 近 60 天窗口的日历事件进记忆;已存在(同 calendarId)但开始时间变了 → 原位更新(时区修复后自愈老数据)。 */
export async function saveCalendarEventsToMemory(events: Array<Record<string, unknown>>): Promise<number> {
  const { getLifeGraph, updateLifeNode } = await import('@/lib/portal/life-graph');
  const now = Date.now();
  const windowEnd = now + 60 * 86_400_000;
  const byCalId = new Map(
    getLifeGraph().filter((n) => n.source === 'calendar' && n.attributes.calendarId)
      .map((n) => [n.attributes.calendarId as string, n] as const),
  );
  let added = 0;
  for (const evAny of events) {
    const start = evAny.start as string | undefined;
    const title = evAny.title as string | undefined;
    if (!start || !title) continue;
    const t = new Date(start).getTime();
    if (t < now - 86_400_000 || t > windowEnd) continue;
    const calId = (evAny.id as string) || `${title}-${start}`;
    const existing = byCalId.get(calId);
    if (existing) {
      // 时间/标题有变 → 更新(TZID 修复后,老的错时区节点在下次同步自愈)
      if (existing.attributes.start !== start || existing.name !== title) {
        updateLifeNode(existing.id, {
          name: title,
          attributes: { ...existing.attributes, start, ...(evAny.end ? { end: evAny.end as string } : {}) },
        });
      }
      continue;
    }
    ingestLifeNode({
      name: title,
      type: 'event',
      source: 'calendar',
      confidence: 1,
      rawInput: title,
      tags: [(evAny.calendarName as string) || '日历'].filter(Boolean),
      attributes: {
        start,
        ...(evAny.end ? { end: evAny.end as string } : {}),
        ...(evAny.url ? { url: evAny.url as string } : {}),
        ...(evAny.location ? { location: evAny.location as string } : {}),
        ...(evAny.description ? { note: (evAny.description as string).slice(0, 300) } : {}),
        calendarId: calId,
        calendarName: (evAny.calendarName as string) || '',
      },
      relations: [],
    });
    added++;
  }
  return added;
}

export async function runCalendarSync(): Promise<CalendarSyncResult> {
  try {
    const res = await fetch('/api/portal/calendar');
    const data = await res.json() as { ok?: boolean; events?: Array<Record<string, unknown>>; error?: string; message?: string };
    if (!data.ok || !data.events) return { ok: false, count: 0, added: 0, error: data.message || data.error || 'no_events' };
    const { saveCalendarToLocal } = await import('@/lib/portal/calendar-local-store');
    saveCalendarToLocal(data.events as Parameters<typeof saveCalendarToLocal>[0]);
    const added = await saveCalendarEventsToMemory(data.events);
    window.dispatchEvent(new CustomEvent('nesio-calendar-updated'));
    return { ok: true, count: data.events.length, added };
  } catch { return { ok: false, count: 0, added: 0, error: 'network' }; }
}

/* ---------- Gmail(增量 after: 游标;5 分钟自节流,force 绕过) ---------- */

export interface GmailSyncResult { ok: boolean; read: number; extracted: number; error?: string; throttled?: boolean }

const GMAIL_SYNC_KEY = 'nesio-gmail-last-sync';

export async function runGmailSync(opts?: { force?: boolean }): Promise<GmailSyncResult> {
  try {
    const lastSync = parseInt(localStorage.getItem(GMAIL_SYNC_KEY) || '0', 10);
    if (!opts?.force && Date.now() - lastSync < 5 * 60_000) return { ok: true, read: 0, extracted: 0, throttled: true };
    localStorage.setItem(GMAIL_SYNC_KEY, String(Date.now()));
    // 增量游标回退 5 分钟防边界漏件;重复由 emailId upsert 幂等吸收
    const afterTs = lastSync > 0 ? Math.floor(lastSync / 1000) - 300 : 0;
    const res = await fetch(`/api/portal/gmail?includeBody=true&analyze=true${afterTs ? `&afterTs=${afterTs}` : ''}`);
    const data = await res.json() as { ok?: boolean; nodes?: Array<Record<string, unknown>>; error?: string; emailCount?: number };
    if (!data.ok) return { ok: false, read: 0, extracted: 0, error: data.error || 'unknown' };
    const nodes = data.nodes || [];
    if (nodes.length) {
      nodes.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as Parameters<typeof ingestLifeNode>[0]));
      window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    }
    return { ok: true, read: data.emailCount ?? 0, extracted: nodes.length };
  } catch { return { ok: false, read: 0, extracted: 0, error: 'network' }; }
}

/* ---------- 全源同步(记忆页下拉刷新) ---------- */

export interface SyncAllOutcome { id: 'calendar' | 'gmail' | 'flomo' | 'plaid' | 'people'; ok: boolean; detail: [string, string] }

/** 依次同步所有已接入源;每源一行结果(未配置/未连接也如实报,不静默)。 */
/* ---------- Google 通讯录(People API)→ person 节点(人缘管理底料) ---------- */

export interface PeopleSyncResult { ok: boolean; error?: string; imported: number; updated: number; deduped?: number; total?: number }

/** 拉 Google 通讯录,灌成 life-graph person 节点(按邮箱/名字去重,已存在则补富化字段)。
 *  关系 tab 读 person 节点即可显示;attributes 里带 email/photo/birthday 供人缘管理。 */
export async function runPeopleSync(): Promise<PeopleSyncResult> {
  // 批次 36:并发互斥 —— 开屏自动同步和手动同步同时跑时,两边都在写入前
  // 构建了空的去重索引 → 各导一份(用户实锤 127×3=381)。在飞就复用同一承诺。
  if (peopleSyncInFlight) return peopleSyncInFlight;
  peopleSyncInFlight = (async () => {
  try {
    const res = await fetch('/api/portal/people');
    if (res.status === 401) return { ok: false, error: 'not_connected', imported: 0, updated: 0 };
    const data = await res.json().catch(() => null) as { ok?: boolean; contacts?: Array<{ name?: string; emails?: string[]; photo?: string; birthday?: string; groups?: string[] }> } | null;
    if (!res.ok || !data?.ok) return { ok: false, error: 'people', imported: 0, updated: 0 };
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const { getLifeGraph, addLifeNode, updateLifeNode } = await import('@/lib/portal/life-graph');

    // 既有 person 节点按邮箱/名字建索引,去重(带上 tags 以便分组标签合并)
    type Idx = { id: string; attributes: Record<string, string | number | boolean | null>; tags?: string[] };
    const byEmail = new Map<string, Idx>();
    const byName = new Map<string, Idx>();
    for (const n of getLifeGraph()) {
      if (n.type !== 'person') continue;
      const rec: Idx = { id: n.id, attributes: n.attributes, tags: n.tags };
      const email = typeof n.attributes?.email === 'string' ? n.attributes.email.toLowerCase() : '';
      if (email) byEmail.set(email, rec);
      if (n.name) byName.set(n.name.toLowerCase(), rec);
    }

    let imported = 0; let updated = 0;
    for (const c of contacts) {
      const name = (c.name || '').trim();
      const email = (c.emails?.[0] || '').toLowerCase();
      if (!name && !email) continue;
      const attrs: Record<string, string | number | boolean | null> = { contactSource: 'google' };
      if (email) attrs.email = email;
      if (c.photo) attrs.photo = c.photo;
      if (c.birthday) attrs.birthday = c.birthday;
      // 分组名进 tags(去重),关系 tab 据此按组筛选、置顶家庭
      const groups = Array.isArray(c.groups) ? c.groups.filter((g): g is string => typeof g === 'string' && !!g) : [];
      const tags = Array.from(new Set(['联系人', ...groups]));
      const existing = (email && byEmail.get(email)) || byName.get(name.toLowerCase());
      if (existing) {
        const mergedTags = Array.from(new Set([...(existing.tags || []), ...tags]));
        updateLifeNode(existing.id, { attributes: { ...existing.attributes, ...attrs }, tags: mergedTags });
        updated++;
      } else {
        addLifeNode({ type: 'person', name: name || email, source: 'system', confidence: 0.9, attributes: attrs, relations: [], tags });
        imported++;
      }
    }
    // 自愈:历史并发导入留下的重复联系人(同邮箱或同名 + contactSource),保最早删其余
    const removed = await dedupeImportedContacts();
    const totalNow = getLifeGraph().filter((n) => n.type === 'person' && n.attributes?.contactSource).length;
    return { ok: true, imported, updated, deduped: removed, total: totalNow };
  } catch { return { ok: false, error: 'network', imported: 0, updated: 0 }; }
  })();
  try { return await peopleSyncInFlight; } finally { peopleSyncInFlight = null; }
}

let peopleSyncInFlight: Promise<{ ok: boolean; error?: string; imported: number; updated: number; deduped?: number; total?: number }> | null = null;

/** 清理重复导入的联系人:同 email(或无 email 时同名)的 contactSource person 只留最早一个。 */
export async function dedupeImportedContacts(): Promise<number> {
  const { getLifeGraph, deleteLifeNode } = await import('@/lib/portal/life-graph');
  const seen = new Map<string, string>(); // key → keeper id
  let removed = 0;
  const persons = getLifeGraph()
    .filter((n) => n.type === 'person' && n.attributes?.contactSource)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const n of persons) {
    const email = typeof n.attributes?.email === 'string' ? n.attributes.email.toLowerCase() : '';
    const key = email || `name:${(n.name || '').toLowerCase()}`;
    if (!key || key === 'name:') continue;
    if (seen.has(key)) { if (deleteLifeNode(n.id)) removed++; }
    else seen.set(key, n.id);
  }
  return removed;
}

export async function syncAllConnectors(): Promise<SyncAllOutcome[]> {
  const out: SyncAllOutcome[] = [];
  const [cal, mail, flomo, plaid, people] = await Promise.all([
    runCalendarSync(), runGmailSync({ force: true }), runFlomoSync(), runPlaidSync(), runPeopleSync(),
  ]);
  out.push({ id: 'calendar', ok: cal.ok, detail: cal.ok ? [`日历 ${cal.count} 条(新进记忆 ${cal.added})`, `Calendar ${cal.count} (${cal.added} new)`] : ['日历未同步(未连接或出错)', 'Calendar not synced'] });
  out.push({ id: 'gmail', ok: mail.ok, detail: mail.ok ? [`邮件读 ${mail.read} 封,提取 ${mail.extracted} 条`, `Mail read ${mail.read}, extracted ${mail.extracted}`] : ['邮件未同步(未连接或出错)', 'Mail not synced'] });
  out.push({ id: 'flomo', ok: flomo.ok, detail: flomo.ok ? [`Flomo 新增 ${flomo.fresh} 条`, `Flomo +${flomo.fresh}`] : ['Flomo 未配置', 'Flomo not configured'] });
  out.push({ id: 'plaid', ok: plaid.ok, detail: plaid.ok ? [`银行新增 ${plaid.fresh} 笔(共 ${plaid.total})`, `Bank +${plaid.fresh} (${plaid.total} total)`] : ['银行未连接', 'Bank not linked'] });
  out.push({ id: 'people', ok: people.ok, detail: people.ok ? [`联系人导入 ${people.imported}、更新 ${people.updated}${(people.deduped ?? 0) > 0 ? `、清理重复 ${people.deduped}` : ''}(库中 ${people.total ?? '?'} 人)`, `Contacts +${people.imported}, updated ${people.updated}${(people.deduped ?? 0) > 0 ? `, deduped ${people.deduped}` : ''} (${people.total ?? '?'} total)`] : ['通讯录未同步(未连接 Google)', 'Contacts not synced'] });
  return out;
}
