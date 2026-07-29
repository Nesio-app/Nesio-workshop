/**
 * 连接器同步核心(纯数据层,无 UI)—— ConnectorsHub 的各「同步」按钮与
 * 记忆页下拉刷新共用同一实现,不留双实现。每个 run* 返回结构化结果,
 * UI 决定 toast/重试;失败都有明确 error(设计红线:异步动作必有可见失败态)。
 */
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { stripMarkdownInline } from '@/lib/portal/node-display';

/* ---------- Plaid 银行流水(增量游标在服务端 cookie;本机 IDB 留最近 5000 笔) ---------- */

export interface PlaidSyncResult {
  ok: boolean;
  error?: string;                 // 'not_connected' | 'relink_required' | 其他
  fresh: number; total: number; accounts: number; pending: number; withLogo: number;
  // 需要 update-mode 修复的 token 下标(服务端 cookie 数组位置)—— UI 据此给「修复」入口,
  // 修复既有连接不烧 Plaid 名额。
  relinkIndexes?: number[];
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
      relinkIndexes?: number[];
      investments?: { accounts?: number; holdings?: number; transactions?: number; error?: string };
    };
    const bank = await import('@/lib/portal/bank-tx');
    // P0 数据安全①:IDB 水合完成才动存储 —— 水合前 load()=[] 会把整库流水写空且游标已推进。
    await bank.bankDataReady();
    // 失败早退提到一切写入之前(逻辑审计 #10):失败响应不该动本机任何存储。
    if (!data.ok) { bank.saveBankSyncStatus({ ok: false, error: data.error || 'unknown' }); return fail(data.error || 'unknown'); }
    if (data.accounts?.length) {
      // 财务⑧:账户全量拉齐(authoritative)时整体替换,让重复授权的旧账户退场。
      // 权威快照先落地,随后按**新账户表**读 existing —— 孤儿在本次 merge 就退场
      // (逻辑审计 #10:旧顺序下孤儿要等下个周期,且兜底会无限复活死数据)。
      bank.saveBankAccounts(data.accounts as Array<{ id: string; name: string; currency: string }>, { replace: data.authoritative === true });
    }
    if (Array.isArray(data.holdings) && data.holdings.length) {
      bank.saveHoldings(data.holdings as never); // 财务㉗:持仓快照,非空才替换
    }
    // P2 尾巴:Plaid 官方定期流(订阅页并集展示)。字段缺席 = 本次拉取失败,保留上次好数据;
    // 字段存在(含空数组)= 真实结果,照存(全取消也是事实)。
    if (Array.isArray((data as { recurringStreams?: unknown[] }).recurringStreams)) {
      bank.savePlaidRecurring((data as { recurringStreams: never[] }).recurringStreams);
    }
    // Guidance 全 AI 化 Step 4 前置:Plaid 负债(信用卡还款日/最低还款)。语义与 recurring 同:
    // 字段缺席 = 本次拉取失败保留旧数据;字段存在(含空)= 真实结果照存。
    if (Array.isArray((data as { liabilities?: unknown[] }).liabilities)) {
      bank.savePlaidLiabilities((data as { liabilities: never[] }).liabilities);
    }
    const rawExisting = bank.loadBankTxRaw();
    const filteredExisting = bank.loadBankTx();
    // 兜底仅限「账户表为空」(水合可疑/首次):账户表非空时孤儿过滤是有依据的,不复活死数据。
    const existing = filteredExisting.length === 0 && rawExisting.length > 0 && bank.loadBankAccounts().length === 0
      ? rawExisting : filteredExisting;
    // 增量合并(纯核心,可单测):按 id upsert、删 removed、日期降序留最近 5000 笔
    const { merged, fresh } = bank.mergeBankTxForSync(existing, data.transactions || [], data.removedIds || []);
    // P0 数据安全③:疑似清空保险丝 —— 已有可观数据、合并结果却为空 → 拒写并显式报错。
    if (!bank.bankTxWriteAllowed(rawExisting.length, merged.length)) {
      bank.saveBankSyncStatus({ ok: false, error: 'local_write_guard' });
      // 逻辑审计 #2:游标已在服务端推进,本批交易若不补救即永久丢失 ——
      // 清全量标记让下次同步走 full=1 重拉(该标记本是一次性,这里是唯一的找回入口)。
      try { localStorage.removeItem('nesio-plaid-enrich-v1'); } catch { /* ignore */ }
      return fail('local_write_guard');
    }
    bank.saveBankTx(merged);
    bank.saveBankSyncStatus({ ok: true });
    // P1:同步成功落一条当日净值/投资快照(按日 upsert 幂等)——「今天 +$860」的数据源。
    try {
      const { recordNetWorthSnapshot } = await import('@/lib/portal/finance-assets');
      recordNetWorthSnapshot();
    } catch { /* 快照失败不影响同步结果 */ }
    try { localStorage.setItem('nesio-bank-synced-at', new Date().toISOString()); } catch { /* quota */ }
    if (full) { try { localStorage.setItem('nesio-plaid-enrich-v1', '1'); } catch { /* quota */ } }
    const withLogo = merged.filter((t) => (t as { merchantLogo?: string }).merchantLogo).length;
    const inv = data.investments;
    return {
      ok: true, fresh, total: merged.length, accounts: data.accounts?.length || 0, pending: data.pendingItems || 0, withLogo,
      ...(data.relinkIndexes?.length ? { relinkIndexes: data.relinkIndexes } : {}),
      ...(inv ? { investments: { accounts: inv.accounts || 0, holdings: inv.holdings || 0, transactions: inv.transactions || 0, error: inv.error } } : {}),
    };
  } catch {
    // 同上:fetch 可能已成功且游标已推进,解析/写入异常也要解锁 full 重拉,别把这批交易永久丢掉。
    try { localStorage.removeItem('nesio-plaid-enrich-v1'); } catch { /* ignore */ }
    return fail('network');
  }
}

/* ---------- Flomo 笔记(全量翻页,按 slug 去重只进增量) ---------- */

export interface FlomoSyncResult { ok: boolean; fresh: number; error?: string; remaining?: number }

// 闪退根因:ingestLifeNode 每条都 loadAll+saveAll 整图 + 发云请求;旧代码在一个同步 for
// 里灌**上千条** flomo 笔记 → O(n²) 写盘 + 主线程长时间阻塞 → iOS 直接杀标签(用户「点同步闪退」)。
// 双保险:① 单次最多灌 FLOMO_INGEST_CAP 条(其余下次同步继续,按 slug 去重天然增量);
//        ② 分块 + 每块之间让出事件循环,主线程不再被长时间独占。
const FLOMO_INGEST_CAP = 250;
const FLOMO_INGEST_CHUNK = 20;

export async function runFlomoSync(): Promise<FlomoSyncResult> {
  try {
    // limit 从 5000 收到 800:5000 = 服务端翻 25 页,拉取本身就慢/易超时;800 足够覆盖增量,
    // 首灌超量的部分靠多点几次同步逐步消化(去重保证不重复)。
    const res = await fetch('/api/portal/flomo?limit=800');
    const data = await res.json() as { ok?: boolean; memos?: Array<{ content: string; created_at: string; tags: string[]; slug?: string }>; error?: string };
    if (!data.ok) return { ok: false, fresh: 0, error: data.error || 'not_configured' };
    const { getLifeGraph } = await import('@/lib/portal/life-graph');
    const existingSlugs = new Set(getLifeGraph().map((n) => n.attributes?.flomoSlug as string).filter(Boolean));
    const fresh = (data.memos || []).filter((m) => !existingSlugs.has(m.slug || ''));
    const batch = fresh.slice(0, FLOMO_INGEST_CAP); // memos 已按新→旧;先灌最新一批
    let imported = 0;
    for (let i = 0; i < batch.length; i += FLOMO_INGEST_CHUNK) {
      for (const m of batch.slice(i, i + FLOMO_INGEST_CHUNK)) {
        // 先剥 markdown 再截断(QA:标题曾是 `![](https://flomoapp.com/favicon.i` 这种半截图片语法)
        const plain = stripMarkdownInline(m.content.replace(/<[^>]+>/g, ' '));
        ingestLifeNode({
          type: 'preference',
          name: plain.slice(0, 40),
          attributes: { source: 'Flomo', created: m.created_at, flomoSlug: m.slug || '' },
          relations: [],
          tags: ['Flomo', ...(m.tags || [])],
          confidence: 0.9,
          rawInput: plain.slice(0, 200),
          source: 'manual',
        });
        imported++;
      }
      // 让出事件循环:主线程喘口气,避免长时间独占被系统判「无响应」杀掉。
      if (i + FLOMO_INGEST_CHUNK < batch.length) await new Promise((r) => setTimeout(r, 0));
    }
    if (imported) window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
    return { ok: true, fresh: imported, remaining: Math.max(0, fresh.length - imported) };
  } catch { return { ok: false, fresh: 0, error: 'network' }; }
}

/* ---------- 日历(本地表整体替换 + 近 60 天事件进记忆;时间变了会更新) ---------- */

export interface CalendarSyncResult { ok: boolean; count: number; added: number; error?: string }

/** 近 60 天窗口的日历事件进记忆;已存在(同 calendarId)但开始时间变了 → 原位更新(时区修复后自愈老数据)。 */
export async function saveCalendarEventsToMemory(events: Array<Record<string, unknown>>): Promise<number> {
  const { getLifeGraph, updateLifeNode, deleteLifeNode } = await import('@/lib/portal/life-graph');
  const now = Date.now();
  const windowEnd = now + 60 * 86_400_000;

  // 批次 43:calendarId 机制之前入库的老日历节点没这个字段,byCalId 永远认不出
  // 它们 → 每次同步都再灌一遍(「廿七」×2 的根因)。两步自愈:
  // ① 已有的重复(同名+同 start 的 calendar 节点)保最早删其余;
  // ② 幸存的老节点(无 calendarId)按 名字|start 认亲,同步时补上 calendarId 原位更新。
  const calNodes = getLifeGraph().filter((n) => n.source === 'calendar');
  const byNameStart = new Map<string, (typeof calNodes)[number]>();
  for (const n of [...calNodes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
    const key = `${n.name}|${typeof n.attributes.start === 'string' ? n.attributes.start : ''}`;
    const first = byNameStart.get(key);
    if (!first) { byNameStart.set(key, n); continue; }
    deleteLifeNode(n.id);
  }
  const byCalId = new Map(
    [...byNameStart.values()].filter((n) => n.attributes.calendarId)
      .map((n) => [n.attributes.calendarId as string, n] as const),
  );
  let added = 0;
  // 本次同步已落过的 calendarId 与 名字|start —— 去重表建于循环之前,新建的节点不在里面
  const seenThisRun = new Set<string>();
  for (const evAny of events) {
    const start = evAny.start as string | undefined;
    const title = evAny.title as string | undefined;
    if (!start || !title) continue;
    const t = new Date(start).getTime();
    if (t < now - 86_400_000 || t > windowEnd) continue;
    const calId = (evAny.id as string) || `${title}-${start}`;
    const existing = byCalId.get(calId) || byNameStart.get(`${title}|${start}`);
    if (existing && !existing.attributes.calendarId) {
      // 老节点认亲:补 calendarId,下次同步走正常 upsert
      updateLifeNode(existing.id, { attributes: { ...existing.attributes, calendarId: calId } });
      existing.attributes = { ...existing.attributes, calendarId: calId };
    }
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
    // ⚠️ 本次循环内也要防重:同一次同步里两条同名同时间的事件(订阅了同一个会议的
    // 多个日历时很常见)会各建一个节点 —— 因为去重表是循环开始前建的、建完节点又不回填。
    // 症状:每次同步灌一批重复,下次同步开头的自愈再删掉,日历项计数在 51/39 之间来回跳。
    // 先占位再 ingest,保证「同一批里同一场会只落一个」。
    const dupKey = `${title}|${start}`;
    if (seenThisRun.has(calId) || seenThisRun.has(dupKey)) continue;
    seenThisRun.add(calId);
    seenThisRun.add(dupKey);
    ingestLifeNode({
      name: title,
      type: 'event',
      source: 'calendar',
      confidence: 1,
      rawInput: title,
      tags: [(evAny.calendarName as string) || '日历'].filter(Boolean),
      attributes: {
        start,
        ...(evAny.allDay ? { allDay: true } : {}),
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

// 邮件「网络错误」回归根因:同步阻塞在服务端 analyze=true 的云 LLM 抽取上,
// 35 封全文喂一个大 prompt,延迟一波动就冲破 60s 函数上限 → 平台 504 → 前端报「网络错误」。
// 修法(两段式):① 阻塞段用 analyze=false —— 服务端走**本地正则抽取**(金额/到货/单号/待办),
// 快且稳,几秒内必返回,同步不再超时;② 云 AI 抽取转**后台非阻塞富化**,拿到就原位 upsert
// 升级节点(emailId 幂等),超时/失败无声,不影响这次同步已成功。增量小批时富化基本都能成。
let gmailEnrichInFlight = false;
export async function enrichGmailInBackground(afterTs: number): Promise<void> {
  if (gmailEnrichInFlight) return;
  gmailEnrichInFlight = true;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 58_000); // 58s < 服务端 60s:拿干净 abort,不等平台 504
    let res: Response;
    try {
      res = await fetch(`/api/portal/gmail?includeBody=true&analyze=true&returnBodies=false${afterTs ? `&afterTs=${afterTs}` : ''}`, { signal: ctrl.signal });
    } finally { clearTimeout(to); }
    let data: { ok?: boolean; nodes?: Array<Record<string, unknown>> } | null = null;
    try { data = JSON.parse(await res.text()); } catch { /* 网关/超时页 */ }
    if (data?.ok && data.nodes?.length) {
      data.nodes.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as Parameters<typeof ingestLifeNode>[0]));
      window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    }
  } catch { /* 富化 best-effort:失败无声,同步已成功 */ }
  finally { gmailEnrichInFlight = false; }
}

export async function runGmailSync(opts?: { force?: boolean }): Promise<GmailSyncResult> {
  try {
    const lastSync = parseInt(localStorage.getItem(GMAIL_SYNC_KEY) || '0', 10);
    if (!opts?.force && Date.now() - lastSync < 5 * 60_000) return { ok: true, read: 0, extracted: 0, throttled: true };
    localStorage.setItem(GMAIL_SYNC_KEY, String(Date.now()));
    // 增量游标回退 5 分钟防边界漏件;重复由 emailId upsert 幂等吸收
    const afterTs = lastSync > 0 ? Math.floor(lastSync / 1000) - 300 : 0;
    // 阻塞段:analyze=false → 本地抽取,快且稳(不再卡在云 AI 上超时)
    const res = await fetch(`/api/portal/gmail?includeBody=true&analyze=false${afterTs ? `&afterTs=${afterTs}` : ''}`);
    // 平台超时(504)回非 JSON —— 直接 res.json() 会炸进 catch 被误报成 network,
    // 状态码如实带出才能在同步详情里看到真病因。
    type GmailPayload = { ok?: boolean; nodes?: Array<Record<string, unknown>>; error?: string; emailCount?: number; emailBodies?: Record<string, string> };
    let data: GmailPayload | null = null;
    try { data = JSON.parse(await res.text()) as GmailPayload; } catch { /* 网关/超时页 */ }
    if (!data) return { ok: false, read: 0, extracted: 0, error: `http_${res.status}` };
    if (!data.ok) return { ok: false, read: 0, extracted: 0, error: data.error || 'unknown' };
    // 邮件全文存本机 IndexedDB(隐私红线:不进云同步的节点 attributes)。失败不拦同步。
    if (data.emailBodies && Object.keys(data.emailBodies).length) {
      const bodies = data.emailBodies;
      void import('../local-email-body').then(({ putEmailBodies }) => putEmailBodies(bodies)).catch(() => {});
      // 里程碑 B:并入本机全文检索索引,刚同步的邮件立即可被搜索/RAG 命中。
      void import('../email-fulltext-index').then(({ indexEmailBodies }) => indexEmailBodies(bodies)).catch(() => {});
    }
    const nodes = data.nodes || [];
    if (nodes.length) {
      nodes.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as Parameters<typeof ingestLifeNode>[0]));
      window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    }
    // 云 AI 抽取转后台富化:同步已成功返回,富化拿到更好的语义节点就原位升级(失败无声)。
    void enrichGmailInBackground(afterTs);
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
        ingestLifeNode({ type: 'person', name: name || email, source: 'system', confidence: 0.9, attributes: { ...attrs, epistemic: 'observation', generator: 'connector:google-people' }, relations: [], tags });
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
  out.push({ id: 'gmail', ok: mail.ok, detail: mail.ok ? [`邮件读 ${mail.read} 封,提取 ${mail.extracted} 条`, `Mail read ${mail.read}, extracted ${mail.extracted}`] : [`邮件未同步(${mail.error || '未连接或出错'})`, `Mail not synced (${mail.error || 'error'})`] });
  out.push({ id: 'flomo', ok: flomo.ok, detail: flomo.ok ? [`Flomo 新增 ${flomo.fresh} 条`, `Flomo +${flomo.fresh}`] : ['Flomo 未配置', 'Flomo not configured'] });
  out.push({ id: 'plaid', ok: plaid.ok, detail: plaid.ok ? [`银行新增 ${plaid.fresh} 笔(共 ${plaid.total})`, `Bank +${plaid.fresh} (${plaid.total} total)`] : ['银行未连接', 'Bank not linked'] });
  out.push({ id: 'people', ok: people.ok, detail: people.ok ? [`联系人导入 ${people.imported}、更新 ${people.updated}${(people.deduped ?? 0) > 0 ? `、清理重复 ${people.deduped}` : ''}(库中 ${people.total ?? '?'} 人)`, `Contacts +${people.imported}, updated ${people.updated}${(people.deduped ?? 0) > 0 ? `, deduped ${people.deduped}` : ''} (${people.total ?? '?'} total)`] : ['通讯录未同步(未连接 Google)', 'Contacts not synced'] });
  return out;
}

// 开机/登录自动拉新:此前顶层只自动同步「云端你自己的数据」(记忆/学习态/备份),
// 但**外部连接器的新内容**(日历/邮件/flomo/银行/通讯录)要手动点同步才拉 —— 用户希望
// 开机就自动拉一次。这里做节流包装:每 30 分钟至多自动跑一次(手动同步不受限);未连接的
// 源各自静默早退,不产生无谓请求。best-effort:失败无声,不阻塞渲染。
const CONNECTOR_AUTOSYNC_KEY = 'nesio-connectors-autosync-at-v1';
const CONNECTOR_AUTOSYNC_MIN_INTERVAL_MS = 30 * 60_000;

export async function autoSyncConnectorsOnBoot(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const last = parseInt(localStorage.getItem(CONNECTOR_AUTOSYNC_KEY) || '0', 10);
    if (Date.now() - last < CONNECTOR_AUTOSYNC_MIN_INTERVAL_MS) return;
    localStorage.setItem(CONNECTOR_AUTOSYNC_KEY, String(Date.now()));
    await syncAllConnectors(); // 各源内部对未连接/未配置静默早退
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
  } catch { /* best-effort:失败无声 */ }
}
