/**
 * 承诺门 —— AI 判决之后、出卡之前的三道确定性门(设计定稿 2026-07-29,Step 2)。
 *
 * 规则在这里从「判断内容」退到「执行承诺」。AI 对这三条不知情、无权:
 *   ① 静音门:你说过别再说的,永不再说(按源指纹);整类静音 30 天(按分组)。
 *   ② 当日 dismiss:点「知道了」= 本地日键静默到明天(cooling 的全部合法遗产,自适应冷却已废)。
 *   ③ 配额门:定序截断 —— severity 降序 → showUntil 近者先 → 结构化来源优先。
 *      severity 3 豁免配额(承诺管噪音,不管安全;3 必须有结构化证据,滥用被 ai-judge 解析层封顶)。
 *
 * 另含两条本地钳制(窗口重算的一部分,不算规则层还魂):
 *   · 窗口命中:showFrom ≤ 今天 ≤ showUntil(本地日键 —— UTC 日键的坑刚清过 26 处)。
 *   · 临近保底:事件开始 <2h → severity 保底 3(判决锁定后 severity 不随临近升级的唯一补丁)。
 *
 * 零 import、全注入:契约测试在 vm 壳里跑,静音判定由调用方适配 card-verdict 后注入。
 */

export interface GateCard {
  /** 首指纹 = 卡的身份。 */
  fingerprints: string[];
  group: string;
  severity: 0 | 1 | 2 | 3;
  showFrom: string; // YYYY-MM-DD
  showUntil: string; // YYYY-MM-DD
  /** 结构化来源(calendar/plaid/inventory/domain)至少占一个指纹。定序用。 */
  hasStructuredSource: boolean;
  /** 事件真实开始时刻(ms),日历类才有;临近保底用。 */
  eventStartMs?: number;
}

export type GateName = 'window' | 'silence' | 'dismissed' | 'quota';

export interface GateContext {
  /** 本地日键 YYYY-MM-DD。 */
  localDayISO: string;
  nowMs: number;
  /** 静音判定(调用方用 card-verdict 适配注入):这张卡被用户静音了吗。 */
  isMuted: (card: GateCard) => boolean;
  /** 今天已点掉的卡(首指纹集合,按本地日键存)。 */
  dismissedToday: ReadonlySet<string>;
  /** severity ≤2 的配额(沿用现有 day/evening 逻辑,不在这里硬编码)。 */
  budget: number;
}

export interface GateResult<T extends GateCard> {
  shown: T[];
  /** 被拦的卡与拦它的门 —— 进档案,让「为什么没出」可查。 */
  blocked: Array<{ card: T; gate: GateName }>;
}

const TWO_HOURS_MS = 2 * 3_600_000;

/** 临近保底:开始 <2h 且还没开始完(给 30 分钟宽限)→ severity 保底 3。 */
export function proximityFloor<T extends GateCard>(card: T, nowMs: number): T {
  if (
    card.eventStartMs !== undefined &&
    card.eventStartMs - nowMs < TWO_HOURS_MS &&
    card.eventStartMs + 30 * 60_000 > nowMs &&
    card.severity < 3
  ) {
    return { ...card, severity: 3 };
  }
  return card;
}

export function isInWindow(card: Pick<GateCard, 'showFrom' | 'showUntil'>, localDayISO: string): boolean {
  return card.showFrom <= localDayISO && localDayISO <= card.showUntil;
}

/**
 * 三门 + 两钳制,一次过。顺序即语义:
 * 窗口(不在窗口不算被拦,是还没到/已过去)→ 临近保底 → 静音 → 当日 dismiss → 配额。
 */
export function applyGuidanceGates<T extends GateCard>(cards: readonly T[], ctx: GateContext): GateResult<T> {
  const blocked: Array<{ card: T; gate: GateName }> = [];
  const inWindow: T[] = [];

  for (const raw of cards) {
    if (!isInWindow(raw, ctx.localDayISO)) {
      blocked.push({ card: raw, gate: 'window' });
      continue;
    }
    const card = proximityFloor(raw, ctx.nowMs);
    if (ctx.isMuted(card)) {
      blocked.push({ card, gate: 'silence' });
      continue;
    }
    if (card.fingerprints[0] && ctx.dismissedToday.has(card.fingerprints[0])) {
      blocked.push({ card, gate: 'dismissed' });
      continue;
    }
    inWindow.push(card);
  }

  // 配额:定序截断。severity 3 豁免(但计入当日总数概念上;这里直接放行)。
  const ordered = [...inWindow].sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity;
    if (a.showUntil !== b.showUntil) return a.showUntil < b.showUntil ? -1 : 1;
    if (a.hasStructuredSource !== b.hasStructuredSource) return a.hasStructuredSource ? -1 : 1;
    return 0;
  });

  const shown: T[] = [];
  let used = 0;
  for (const card of ordered) {
    if (card.severity === 3) {
      shown.push(card); // 豁免:登机口不能被「今天已出一张」截掉
      continue;
    }
    if (used >= ctx.budget) {
      blocked.push({ card, gate: 'quota' });
      continue;
    }
    shown.push(card);
    used += 1;
  }

  return { shown, blocked };
}
