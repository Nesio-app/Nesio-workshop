/**
 * AI 判决层客户端编排 —— 设计定稿 2026-07-29;同日用户拍板**硬拆直接实弹**。
 *
 * 语义:打开 app 时把**未判过**的新信号打包送 /api/portal/guidance-judge(maybeRunJudgeBatch),
 * 判决落 ledger;出卡走 loadLiveJudgedCards(窗口重算+三门,同步免费)。8 层规则管线已物理拆除,
 * AI 挂了走结构化兜底(judgeNeedsFallback + fallback-cards,零分类)。
 *
 * 继承 llm-sweep-auto 的骨架:ledger 记账(每指纹这辈子最多送一次)+ 网络失败不记账可重试。
 * 与它的差异(设计升级):
 *   · 指纹 = hash(决策相关字段),不是节点 id —— 字段变了自动重判(llm-sweep 是终身一次)。
 *   · 跨批合并:请求带「当前活跃卡清单」,AI 可 mergeInto 归并(同一趟航班的日历+邮件不出两张)。
 *   · 口味 = 档案统计的事实(不喂权重数字 —— 权重系统已退役)。
 *   · 首次上线只回溯 BACKFILL_DAYS(30 天)内的信号,不灌巨批。
 *   · 每批 ≤ BATCH_MAX_SIGNALS,打开 app 都会再跑,超出的下批补上,不丢。
 *
 * 成本可观测:路由侧 completeText 自动 reportAiCall(真实 token+cost_usd 进 telemetry_events,
 * /admin「AI 调用与成本」按 route=guidance_judge 汇总);本地 ledger.stats 记批次/信号数供档案页显示。
 */
import {
  BACKFILL_DAYS,
  BATCH_MAX_SIGNALS,
  SIGNAL_FIELD_MAX,
  STRUCTURED_SOURCES,
  fingerprintSource,
  isCardInWindow,
  judgeFingerprint,
  type ActiveCardBrief,
  type DeclinedJudgment,
  type JudgeSignal,
  type JudgedCard,
} from '@/lib/platform/guidance-engine/ai-judge';
import { applyGuidanceGates, type GateCard } from '@/lib/platform/guidance-engine/guidance-gates';
import { archiveDeclined, archiveShownCard, archiveStats, wantedDeclinedTitles } from './card-archive';
import { isCardSuppressed } from './card-verdict';
import { logDropped } from './storage-health';
import type { CalendarEvent } from './types';
import type { EmailSignal } from '@/lib/platform/email-signals';
import type { DomainInsight } from './domain-insights';
import type { InventoryItem } from './inventory';

const LEDGER_KEY = 'nesio-guidance-judge-ledger-v1';
/** 同一批判决之间的最小间隔:打开 app 即判,但别在一次会话里反复打。 */
const MIN_RUN_INTERVAL_MS = 30 * 60_000;

interface StoredCard extends JudgedCard {
  judgedAt: string;
  /** 日历类卡的事件真实开始时刻(ms)—— 临近保底(<2h→sev3)用。 */
  eventStartMs?: number;
}

export interface JudgeStats {
  batches: number;
  judgedSignals: number;
  cardsMade: number;
  declinedCount: number;
  lastOkAt: string | null;
  lastError: string | null;
}

interface Ledger {
  /** 已送判的指纹(字段变了指纹变,自动算新信号)。 */
  judged: string[];
  cards: StoredCard[];
  lastRunAt: string | null;
  stats: JudgeStats;
}

const EMPTY_STATS: JudgeStats = { batches: 0, judgedSignals: 0, cardsMade: 0, declinedCount: 0, lastOkAt: null, lastError: null };
const EMPTY: Ledger = { judged: [], cards: [], lastRunAt: null, stats: EMPTY_STATS };

function readLedger(): Ledger {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return { ...EMPTY, stats: { ...EMPTY_STATS } };
    const p = JSON.parse(raw) as Partial<Ledger>;
    return {
      judged: Array.isArray(p.judged) ? p.judged : [],
      cards: Array.isArray(p.cards) ? p.cards : [],
      lastRunAt: typeof p.lastRunAt === 'string' ? p.lastRunAt : null,
      stats: { ...EMPTY_STATS, ...(p.stats && typeof p.stats === 'object' ? p.stats : {}) },
    };
  } catch {
    return { ...EMPTY, stats: { ...EMPTY_STATS } };
  }
}

function writeLedger(l: Ledger): void {
  try {
    // judged 集合只增不减会无限膨胀:窗口早已过去的卡的指纹仍要留着防重判,
    // 但上限 2000,超了裁最老的(最坏情况 = 极老信号被重判一次,可接受)。
    const trimmed: Ledger = { ...l, judged: l.judged.slice(-2000), cards: l.cards.slice(-300) };
    localStorage.setItem(LEDGER_KEY, JSON.stringify(trimmed));
  } catch (err) {
    logDropped('guidance-judge.ledger', err);
  }
}

function localDayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 信号采集(结构化字段直取,零分类) ─────────────────────────────────────────

function hash31(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return String(h);
}

const DAY_MS = 86_400_000;

/**
 * 天气快照(portal cache 里的 WeatherSnapshot 宽形状)。
 * alert 是 NWS 官方告警**字符串**(fetchNWSAlert 已挑 Extreme/Severe 优先、截断 80 字)——
 * 取了一直没用过,现在喂给判决。
 */
export interface JudgeWeatherInput {
  temperatureC?: number | null;
  condition?: string;
  forecastNote?: string;
  tempMinC?: number | null;
  tempMaxC?: number | null;
  precipProb?: number | null;
  alert?: string | null;
}

/** Plaid 负债行(loadPlaidLiabilities)+ 调用方联表出的账户名。 */
export interface JudgeLiabilityInput {
  accountId: string;
  kind: string;
  dueDate: string; // YYYY-MM-DD
  minPayment?: number;
  statementBalance?: number;
  isOverdue?: boolean;
  accountName?: string;
}

/** 记忆节点(FocusNode 兼容形状)—— 只收有日期的(无日期的碎片噪音重,等档案数据再议)。 */
export interface JudgeMemoryInput {
  id: string;
  name: string;
  rawInput?: string;
  attributes?: Record<string, string | number | boolean | null>;
}

/** 其他产品面(DEC 深度发现/穿搭/跨区关联/特别日子…)统一折成 domain 信号,面不丢、判归 AI。 */
export interface JudgeExtraInput {
  id: string;
  domain: string;
  title: string;
  detail?: string;
}

export interface JudgeSignalInput {
  calendarEvents?: readonly CalendarEvent[];
  emailSignals?: readonly EmailSignal[];
  inventoryItems?: readonly InventoryItem[];
  domainInsights?: readonly DomainInsight[];
  weather?: JudgeWeatherInput | null;
  plaidLiabilities?: readonly JudgeLiabilityInput[];
  memoryNodes?: readonly JudgeMemoryInput[];
  extras?: readonly JudgeExtraInput[];
}

/** 原始数据 → JudgeSignal[]。只挑决策相关字段,长文本截断(为上下文质量)。 */
export function collectJudgeSignals(input: JudgeSignalInput, now: Date = new Date()): JudgeSignal[] {
  const signals: JudgeSignal[] = [];
  const backfillFloor = now.getTime() - BACKFILL_DAYS * DAY_MS;
  const horizon = now.getTime() + 14 * DAY_MS;

  // 当天日程是时间线的地盘(用户拍板 2026-07-29):过了 0 点的当日事件只在时间线显示,
  // 判决层只收**明天 0 点以后**的 —— 一天以上的才按 AI 规则进引导卡。
  const tomorrow0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  for (const e of input.calendarEvents || []) {
    const startMs = Date.parse(e.start);
    if (Number.isNaN(startMs) || startMs < tomorrow0 || startMs > horizon) continue;
    const fields = {
      title: e.title.slice(0, 200),
      start: e.start,
      end: e.end ?? null,
      location: e.location?.slice(0, 200) ?? null,
      description: e.description?.slice(0, SIGNAL_FIELD_MAX) ?? null,
    };
    signals.push({ fingerprint: judgeFingerprint('calendar', e.id, fields), source: 'calendar', fields, anchorId: e.id });
  }

  for (const s of input.emailSignals || []) {
    const dateMs = Date.parse(s.date);
    if (!Number.isNaN(dateMs) && dateMs < backfillFloor) continue;
    const fields = {
      subject: s.subject.slice(0, 300),
      from: s.from.slice(0, 120),
      date: s.date,
    };
    signals.push({ fingerprint: judgeFingerprint('email', s.id, fields), source: 'email', fields, anchorId: s.id });
  }

  // Plaid 负债:还款日在 [过去7天(逾期仍要说), +14天] 窗口内的才进批。
  // 月度循环天然自续:下个账期 dueDate 变 → 新指纹 → 重判,无需额外逻辑。
  for (const liab of input.plaidLiabilities || []) {
    const dueMs = Date.parse(`${liab.dueDate}T00:00:00`);
    if (Number.isNaN(dueMs) || dueMs < now.getTime() - 7 * DAY_MS || dueMs > horizon) continue;
    const fields = {
      account: (liab.accountName || liab.accountId).slice(0, 80),
      dueDate: liab.dueDate,
      minPayment: liab.minPayment ?? null,
      balance: liab.statementBalance ?? null,
      kind: liab.kind,
      overdue: liab.isOverdue ?? null,
    };
    signals.push({ fingerprint: judgeFingerprint('plaid', liab.accountId, fields), source: 'plaid', fields });
  }

  // 物品效期窗 30 天(药/化妆品/食品一视同仁 —— 用效期字段说话,不分类)。
  for (const item of input.inventoryItems || []) {
    if (!item.expiry) continue;
    const expMs = Date.parse(`${item.expiry}T00:00:00`);
    if (Number.isNaN(expMs) || expMs < now.getTime() - DAY_MS || expMs > now.getTime() + 30 * DAY_MS) continue;
    const fields = { name: item.name.slice(0, 120), expiry: item.expiry, location: item.location?.slice(0, 80) ?? null };
    signals.push({ fingerprint: judgeFingerprint('inventory', item.id, fields), source: 'inventory', fields, anchorId: item.id });
  }

  for (const d of input.domainInsights || []) {
    // DomainInsight 无稳定 id:域+标题的 hash 即身份(标题变 = 新判定 = 新信号,正确)。
    const id = `${d.domain}-${hash31(d.title)}`;
    const fields = { domain: d.domain, kind: d.severity, stat: d.title.slice(0, 200), detail: d.detail.slice(0, 400) };
    signals.push({ fingerprint: judgeFingerprint('domain', id, fields), source: 'domain', fields });
  }

  // 记忆节点:只收带日期的。窗放到 180 天 —— 护照/签证/保修这类长周期续期必须早进判决
  // (AI 会给合适的 showFrom 提前量;14 天窗会把「2027 年到期的护照」拦到只剩两周才说,太晚)。
  for (const n of input.memoryNodes || []) {
    const a = n.attributes || {};
    const date = String(a.date ?? a.dueDate ?? a.eventDate ?? a.expiry ?? '');
    if (!date) continue;
    const dateMs = Date.parse(date);
    if (Number.isNaN(dateMs) || dateMs < now.getTime() - DAY_MS || dateMs > now.getTime() + 180 * DAY_MS) continue;
    const fields = { title: n.name.slice(0, 200), date, detail: (n.rawInput || '').slice(0, 400) };
    signals.push({ fingerprint: judgeFingerprint('memory', n.id, fields), source: 'memory', fields, anchorId: n.id });
  }

  // 其他产品面折成 domain 信号(DEC/穿搭/跨区/特别日子…):面不丢,出不出交给判决。
  for (const ex of input.extras || []) {
    const fields = { domain: ex.domain, kind: 'extra', stat: ex.title.slice(0, 200), detail: (ex.detail || '').slice(0, 400) };
    signals.push({ fingerprint: judgeFingerprint('domain', `${ex.domain}-${ex.id}`, fields), source: 'domain', fields });
  }

  // 天气走 domain 源(结构化 —— 官方告警配得上 severity ≥2;日常冷暖 AI 自己掂量)。
  const w = input.weather;
  if (w) {
    if (w.alert) {
      const fields = { domain: 'weather', kind: 'alert', stat: String(w.alert).slice(0, 200), detail: '' };
      signals.push({
        fingerprint: judgeFingerprint('domain', `weather-alert-${hash31(fields.stat)}`, fields),
        source: 'domain', fields,
      });
    }
    if (w.temperatureC != null) {
      // 每天一条日常天气;温度取整防指纹抖动(小数变化不该触发重判)。
      const day = localDayISO(now);
      const fields = {
        domain: 'weather', kind: 'daily',
        stat: `${day} ${Math.round(w.tempMinC ?? w.temperatureC)}~${Math.round(w.tempMaxC ?? w.temperatureC)}°C ${w.condition ?? ''}${w.precipProb != null ? ` 降水${Math.round(w.precipProb)}%` : ''}`.trim(),
        detail: String(w.forecastNote ?? '').slice(0, 200),
      };
      signals.push({ fingerprint: judgeFingerprint('domain', `weather-${day}`, fields), source: 'domain', fields });
    }
  }

  return signals;
}

// ── 影子判决 ─────────────────────────────────────────────────────────────────

/** 影子卡当时会被哪些门拦 —— 进档案,让「如果实弹它出不出」可查。 */
function gatesForShadowCard(card: JudgedCard, now: Date): string[] {
  const gateCard: GateCard = {
    fingerprints: card.fingerprints,
    group: card.group,
    severity: card.severity,
    showFrom: card.showFrom,
    showUntil: card.showUntil,
    hasStructuredSource: card.fingerprints.some((fp) => {
      const src = fingerprintSource(fp);
      return src !== null && STRUCTURED_SOURCES.has(src);
    }),
  };
  const { blocked } = applyGuidanceGates([gateCard], {
    localDayISO: localDayISO(now),
    nowMs: now.getTime(),
    isMuted: (c) =>
      isCardSuppressed({ cardId: c.fingerprints[0], cardType: c.group, factKey: c.fingerprints[0] }, now),
    dismissedToday: new Set(),
    budget: 99, // 单卡评估不做配额判断(配额是全局性质,实弹期才有意义)
  });
  return blocked.map((b) => b.gate);
}

function signalTitle(s: JudgeSignal): string {
  const f = s.fields;
  return String(f.title ?? f.subject ?? f.name ?? f.stat ?? f.account ?? s.fingerprint).slice(0, 40);
}

export interface ShadowRunResult {
  status: 'ran' | 'skipped' | 'failed';
  sent?: number;
  cards?: number;
  declined?: number;
  note?: string;
}

/**
 * 判决一批(实弹:结果进 ledger,loadLiveJudgedCards 从这里出卡)。fire-and-forget。
 * 失败不记账 —— 信号保留,下次打开重试;错误落 stats.lastError,渲染层据此亮兜底(失败不许静默)。
 */
export async function maybeRunJudgeBatch(
  input: JudgeSignalInput | (() => JudgeSignalInput),
  opts: { now?: Date; uiLocale?: string; force?: boolean } = {},
): Promise<ShadowRunResult> {
  if (typeof window === 'undefined') return { status: 'skipped', note: 'ssr' };
  const now = opts.now ?? new Date();
  const ledger = readLedger();
  if (!opts.force && ledger.lastRunAt && now.getTime() - Date.parse(ledger.lastRunAt) < MIN_RUN_INTERVAL_MS) {
    return { status: 'skipped', note: 'interval' };
  }

  const judged = new Set(ledger.judged);
  // 取数是惰性的:interval 闸先挡,免得每次渲染都跑一遍 gatherDomainInsights/listInventoryItems。
  const resolved = typeof input === 'function' ? input() : input;
  const collected = collectJudgeSignals(resolved, now);
  // 长周期催办:卡的窗口走完了、但源信号还活着(护照还没到期/账单还没过)→ 摘出重判。
  // AI 按新的时间距离给新窗 —— 提前 90 天说一次、30 天再说、7 天再说,自然形成阶梯。
  // 被静音的不受影响:重判产出同指纹卡,静音门照拦(承诺①不被绕过)。
  const today = localDayISO(now);
  const expiredFps = new Set(ledger.cards.filter((c) => c.showUntil < today).flatMap((c) => c.fingerprints));
  const fresh = collected.filter((s) => !judged.has(s.fingerprint) || expiredFps.has(s.fingerprint));
  if (fresh.length === 0) {
    writeLedger({ ...ledger, lastRunAt: now.toISOString() });
    return { status: 'skipped', note: 'no-new-signals' };
  }
  const batch = fresh.slice(0, BATCH_MAX_SIGNALS);

  // 邮件正文:本机 IDB 全文(里程碑 A)喂给判决 —— 指纹只认白名单字段,
  // 附加正文不改指纹(静音/去重稳定)。取不到就只有 subject/from,照常判。
  try {
    const { getEmailBody } = await import('./local-email-body');
    await Promise.all(
      batch
        .filter((s) => s.source === 'email' && s.anchorId)
        .map(async (s) => {
          const body = await getEmailBody(s.anchorId!);
          if (body) s.fields = { ...s.fields, body: body.slice(0, SIGNAL_FIELD_MAX) };
        }),
    );
  } catch { /* 正文是增强不是前提 */ }

  const activeCards: ActiveCardBrief[] = ledger.cards
    .filter((c) => isCardInWindow(c, localDayISO(now)))
    .map((c) => ({ fingerprint: c.fingerprints[0], title: c.title, group: c.group }));

  // 口味 = 档案事实:分组有用/太多计数 + 用户点名的漏报(「该提醒我」调低同类门槛)。
  const taste = { groupCounts: archiveStats().groupCounts, wantedTitles: wantedDeclinedTitles() };

  try {
    const res = await fetch('/api/portal/guidance-judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signals: batch,
        activeCards,
        taste,
        todayISO: localDayISO(now),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        uiLocale: opts.uiLocale,
      }),
    });
    const data = res.ok ? await res.json() : null;
    if (!data?.ok) {
      const note = data?.error || `route ${res.status}`;
      writeLedger({ ...ledger, stats: { ...ledger.stats, lastError: String(note) } });
      return { status: 'failed', note: String(note) };
    }

    const cards: JudgedCard[] = Array.isArray(data.cards) ? data.cards : [];
    const declined: DeclinedJudgment[] = Array.isArray(data.declined) ? data.declined : [];
    const judgedAt = now.toISOString();

    // 归并:mergeInto 指向已有活跃卡 → 追加指纹与证据,不改文案、不解封、不复活(设计定稿语义)。
    const startByFp = new Map(
      batch
        .filter((s) => s.source === 'calendar' && typeof s.fields.start === 'string')
        .map((s) => [s.fingerprint, Date.parse(String(s.fields.start))]),
    );
    const nextCards = [...ledger.cards];
    const freshCards: StoredCard[] = [];
    for (const card of cards) {
      const host = card.mergeInto ? nextCards.find((c) => c.fingerprints[0] === card.mergeInto) : undefined;
      if (host) {
        host.fingerprints = Array.from(new Set([...host.fingerprints, ...card.fingerprints]));
        host.evidence = Array.from(new Set([...host.evidence, ...card.evidence])).slice(0, 8);
      } else {
        const starts = card.fingerprints.map((fp) => startByFp.get(fp)).filter((v): v is number => v != null && !Number.isNaN(v));
        freshCards.push({ ...card, judgedAt, ...(starts.length ? { eventStartMs: Math.min(...starts) } : {}) });
      }
    }
    nextCards.push(...freshCards);

    // 入档:说了的(影子 lane,附「当时会被哪些门拦」)+ 没说的。
    for (const card of freshCards) {
      archiveShownCard(
        {
          id: card.fingerprints[0],
          lane: 'ai',
          group: card.group,
          title: card.title,
          body: card.body,
          whyNow: card.whyNow,
          evidence: card.evidence,
          severity: card.severity,
          showFrom: card.showFrom,
          showUntil: card.showUntil,
          fingerprints: card.fingerprints,
          gates: gatesForShadowCard(card, now),
        },
        now,
      );
    }
    const titleByFp = new Map(batch.map((s) => [s.fingerprint, signalTitle(s)]));
    archiveDeclined(
      declined.map((d) => ({
        id: d.fingerprint,
        lane: 'ai' as const,
        title: titleByFp.get(d.fingerprint) ?? d.fingerprint,
        reason: d.reason,
      })),
      now,
    );

    writeLedger({
      judged: Array.from(new Set([...ledger.judged, ...batch.map((s) => s.fingerprint)])),
      cards: nextCards,
      lastRunAt: now.toISOString(),
      stats: {
        batches: ledger.stats.batches + 1,
        judgedSignals: ledger.stats.judgedSignals + batch.length,
        cardsMade: ledger.stats.cardsMade + freshCards.length,
        declinedCount: ledger.stats.declinedCount + declined.length,
        lastOkAt: now.toISOString(),
        lastError: null,
      },
    });
    return { status: 'ran', sent: batch.length, cards: freshCards.length, declined: declined.length };
  } catch (err) {
    logDropped('guidance-judge.shadow', err);
    const ledgerNow = readLedger();
    writeLedger({ ...ledgerNow, stats: { ...ledgerNow.stats, lastError: 'network' } });
    return { status: 'failed', note: 'network' };
  }
}

/** 档案页显示判决运行状态(批次/信号数/最近错误)。 */
export function readJudgeStats(): JudgeStats & { lastRunAt: string | null } {
  const l = readLedger();
  return { ...l.stats, lastRunAt: l.lastRunAt };
}

// ── 实弹(Step 4 硬切,2026-07-29 用户拍板):judged 卡就是 Today 的出卡源 ──────

const DISMISS_KEY = 'nesio-judge-dismissed-v1';

/** 「知道了」= 本地日键静默到明天(cooling 的全部合法遗产,自适应冷却已拆)。 */
export function dismissJudgedCard(fp: string, now: Date = new Date()): void {
  if (typeof window === 'undefined' || !fp) return;
  try {
    const day = localDayISO(now);
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null') as { day?: string; fps?: string[] } | null;
    const fps = raw?.day === day && Array.isArray(raw.fps) ? raw.fps : [];
    if (!fps.includes(fp)) fps.push(fp);
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ day, fps }));
  } catch (err) {
    logDropped('guidance-judge.dismiss', err);
  }
}

function readDismissedToday(now: Date): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null') as { day?: string; fps?: string[] } | null;
    return raw?.day === localDayISO(now) && Array.isArray(raw.fps) ? new Set(raw.fps) : new Set();
  } catch {
    return new Set();
  }
}

export interface LiveJudgedCard extends StoredCard {
  hasStructuredSource: boolean;
}

/**
 * 出卡(同步、免费、每次渲染可跑):ledger 里窗口命中的卡过三门(静音/当日dismiss/配额+sev3豁免)
 * + 临近保底。budget 是 severity ≤2 的配额,由调用方按 day/evening 逻辑给。
 */
export function loadLiveJudgedCards(now: Date = new Date(), budget = 3): LiveJudgedCard[] {
  const ledger = readLedger();
  const candidates: LiveJudgedCard[] = ledger.cards.map((c) => ({
    ...c,
    hasStructuredSource: c.fingerprints.some((fp) => {
      const src = fingerprintSource(fp);
      return src !== null && STRUCTURED_SOURCES.has(src);
    }),
  }));
  const { shown } = applyGuidanceGates(candidates, {
    localDayISO: localDayISO(now),
    nowMs: now.getTime(),
    isMuted: (c) => isCardSuppressed({ cardId: c.fingerprints[0], cardType: c.group, factKey: c.fingerprints[0] }, now),
    dismissedToday: readDismissedToday(now),
    budget,
  });
  // 实弹上屏也入档(times 累计):档案是唯一监测面,出一次记一次。
  return shown;
}

/**
 * AI 健康态:从未成功过、或最近一次失败且当前没有任何窗口内判决 → 走兜底。
 * 兜底是承诺 ④:AI 挂了仍出确定性的那几条,且必须**可见地**说明这是兜底(不许静默降级)。
 */
export function judgeNeedsFallback(now: Date = new Date()): boolean {
  const l = readLedger();
  const anyLive = l.cards.some((c) => isCardInWindow(c, localDayISO(now)));
  if (anyLive) return false;
  return l.stats.lastOkAt === null || l.stats.lastError !== null;
}

/**
 * 「该提醒我」的另一半:把该指纹从已判集合里摘掉 → 下次打开重判,
 * 且届时 prompt 里带着「用户点名该提醒」的事实 —— 反馈闭环的执行端,不只是记个数。
 */
export function requeueFingerprint(fp: string): void {
  if (typeof window === 'undefined' || !fp) return;
  const l = readLedger();
  if (!l.judged.includes(fp)) return;
  writeLedger({ ...l, judged: l.judged.filter((j) => j !== fp), lastRunAt: null });
}

/** 隐私清除。 */
export function resetJudgeLedger(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(LEDGER_KEY); } catch { /* 无害 */ }
}
