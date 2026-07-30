/**
 * 卡片裁决存储 —— 「我知道了,别再说」的持久语义。
 *
 * 由来(真机反证):用户点「稍后 / 不要再出现 / 喜欢」,不管点哪个,卡第二天照旧回来。
 * 审计结论是学习环在 per-card 这一维**根本没有消费者**:
 *   · guidance-ranker 在线学习 2026-07-27 已退役(RANKER_LEARNING_ENABLED=false),不再订总线;
 *   · preference-store 只认可复用维度 {domain, card_type, alert_type, merchant},
 *     Today 发的是 dimension:'card' → 被丢弃;
 *   · feedback-log 对 today/card 直接 return(指望 DEC 富路径落事实),
 *     而非 DEC 卡(财务/域洞察)压根没登记 → 连事实都没落;
 *   · 唯一残留的记忆是 cooling-store 的 2~24 小时冷却。
 * 于是三个动作里只有「收起这张卡」是真的。
 *
 * 本模块补上缺的那一层:**用户的裁决要比数据活得久**。
 *   · 稍后    → 到期时间(默认 3 天)。时机问题,到期该回来,不看内容。
 *   · 不要再出现 → 按内容指纹永久静音。事实没变就永远闭嘴;数字变了算新消息,放行。
 *   · 太多了  → 连这一类一起静音 30 天(整类退让,而不是一张一张关)。
 *   · 喜欢    → 不影响出不出,交给 Preference 权重(card_type 维度)去排序。
 *
 * 纯函数 + localStorage,零 import(契约测试在 vm 壳里跑,lib 层不引别的模块)。
 * 任何静音都必须可反悔:readCardVerdicts / clearCardVerdict 供设置页列出与解除。
 */

const KEY = 'nesio-card-verdict-v1';

/** 稍后 = 3 天。比 24 小时冷却长(不然「稍后」和「今天不看」没区别),又不至于一去不回。 */
export const SNOOZE_DAYS = 3;
/** 太多了 = 整类静音 30 天。不做永久:题材可能过一阵又变得相关。 */
export const MUTE_TYPE_DAYS = 30;

export type CardVerdict = 'snooze' | 'mute' | 'mute_type' | 'useful';

export interface CardRef {
  cardId: string;
  cardType?: string;
  /** 内容指纹 —— 必须取 AI 改写**之前**的原文,否则每次改写都算「新事实」,静音永远对不上。 */
  factKey?: string;
}

interface VerdictEntry {
  v: CardVerdict;
  at: string;
  /** 指纹静音:内容还是这一份就闭嘴。 */
  fp?: string;
  /** 到期静音:ISO,过了就放行。 */
  until?: string;
}

interface VerdictState {
  cards: Record<string, VerdictEntry>;
  types: Record<string, VerdictEntry>;
}

const EMPTY: VerdictState = { cards: {}, types: {} };

function load(): VerdictState {
  if (typeof localStorage === 'undefined') return { cards: {}, types: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<VerdictState> | null;
    if (!raw || typeof raw !== 'object') return { cards: {}, types: {} };
    return {
      cards: raw.cards && typeof raw.cards === 'object' ? raw.cards : {},
      types: raw.types && typeof raw.types === 'object' ? raw.types : {},
    };
  } catch {
    return { cards: {}, types: {} };
  }
}

function save(st: VerdictState): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 静音丢了不该拖垮 UI */ }
}

/** 与 proactive-types 同一套 31-hash,两边指纹必须可互认。 */
export function fingerprint(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return String(h);
}

function plusDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** 记下一次裁决。useful 不写静音表(它只该影响排序,不该影响出不出)。 */
export function recordCardVerdict(ref: CardRef, verdict: CardVerdict, now: Date = new Date()): void {
  if (!ref.cardId || verdict === 'useful') return;
  const st = load();
  const at = now.toISOString();
  if (verdict === 'snooze') {
    st.cards[ref.cardId] = { v: 'snooze', at, until: plusDays(now, SNOOZE_DAYS) };
  } else {
    // mute / mute_type 都先把这张卡按指纹静音(没指纹就按 id 永久静音)
    st.cards[ref.cardId] = { v: 'mute', at, ...(ref.factKey ? { fp: ref.factKey } : {}) };
    if (verdict === 'mute_type' && ref.cardType) {
      st.types[ref.cardType] = { v: 'mute_type', at, until: plusDays(now, MUTE_TYPE_DAYS) };
    }
  }
  save(st);
}

export type SuppressionReason = 'snoozed' | 'muted' | 'type_muted';

export interface Suppression {
  reason: SuppressionReason;
  /** 到期静音才有;指纹静音是「事实变了才解」,没有时间。 */
  until?: string;
}

/** 这张卡现在该不该被压住?返回原因供 UI/调试解释,null = 可以出。 */
export function cardSuppression(ref: CardRef, now: Date = new Date()): Suppression | null {
  if (!ref.cardId) return null;
  const st = load();
  const t = ref.cardType ? st.types[ref.cardType] : undefined;
  if (t?.until && Date.parse(t.until) > now.getTime()) return { reason: 'type_muted', until: t.until };

  const c = st.cards[ref.cardId];
  if (!c) return null;
  if (c.v === 'snooze') {
    return c.until && Date.parse(c.until) > now.getTime() ? { reason: 'snoozed', until: c.until } : null;
  }
  // mute:带指纹就按「事实没变」判,没指纹就是永久
  if (!c.fp) return { reason: 'muted' };
  return ref.factKey && ref.factKey === c.fp ? { reason: 'muted' } : null;
}

export function isCardSuppressed(ref: CardRef, now: Date = new Date()): boolean {
  return cardSuppression(ref, now) !== null;
}

export interface VerdictListing {
  scope: 'card' | 'type';
  key: string;
  verdict: CardVerdict;
  at: string;
  until?: string;
}

/** 设置页「我静音了什么」:列出所有仍然生效的裁决(过期的不列,免得像是没解除)。 */
export function readCardVerdicts(now: Date = new Date()): VerdictListing[] {
  const st = load();
  const out: VerdictListing[] = [];
  for (const [key, e] of Object.entries(st.cards)) {
    if (e.until && Date.parse(e.until) <= now.getTime()) continue;
    out.push({ scope: 'card', key, verdict: e.v, at: e.at, ...(e.until ? { until: e.until } : {}) });
  }
  for (const [key, e] of Object.entries(st.types)) {
    if (e.until && Date.parse(e.until) <= now.getTime()) continue;
    out.push({ scope: 'type', key, verdict: e.v, at: e.at, ...(e.until ? { until: e.until } : {}) });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** 反悔:解除某一条静音。 */
export function clearCardVerdict(scope: 'card' | 'type', key: string): void {
  const st = load();
  const bag = scope === 'card' ? st.cards : st.types;
  if (!(key in bag)) return;
  delete bag[key];
  save(st);
}

/** 全部解除(隐私清除 / 「重新开始听建议」)。 */
export function resetCardVerdicts(): void {
  save({ ...EMPTY, cards: {}, types: {} });
}
