/**
 * ledger-entry — 账目分录的确定性核心(L1)。
 *
 * 设计依据见 docs/design/finance-ledger-plan.md。三件事在这里定死,UI 只是它的表现:
 *
 * ① **源字段 / 人字段分层。** Plaid 会反复重同步,人写的东西永不被覆盖。
 *    这不是新发明 —— ingest-node.ts:120 那条血泪注释(云 AI 富化把本地抽取的字段
 *    整块抹掉,导致「所有邮件都是今天」)就是没分层的后果。这里把它形式化成名单 + 函数,
 *    而不是靠每处 upsert 自觉。
 *
 * ② **三档冻结**(行业调研结论:QuickBooks / Xero / Beancount / YNAB 的共识不是
 *    「不可改」,而是「改可以,但必须留痕、且对账状态要跟着变」):
 *      未对账 → 源字段可改,留变更历史
 *      已对账 → 改源字段必须先解除对账(Xero 的 unreconcile),并告知会让哪期差多少
 *      已锁定 → 只能冲正(已出报表/已报税,原分录一个字不动)
 *
 * ③ **作废优先于删除**(QuickBooks 的 void vs delete):金额归零效果、记录保留、
 *    原值留在变更历史里。Plaid 说 removed 的(银行撤销的 pending)也走作废 ——
 *    物理删会让用户发现「昨天看到的一笔今天没了」且查不出为什么。
 *
 * 全部是纯函数,不碰存储、不碰 React —— 这样它能被真跑、能被反证。
 * 落库形态是 LifeNode(attributes 只收标量,所以变更历史序列化成 JSON 字符串)。
 */

/** 一条分录的属性面(LifeNode.attributes 的子集,值都是标量)。 */
export type LedgerAttrs = Record<string, string | number | boolean | null | undefined>;

export type LedgerFreezeTier = 'open' | 'reconciled' | 'locked';

/**
 * 源字段:代表**外部事实**(银行怎么说 / 你首次录入时怎么说)。按档冻结。
 * 同步可以补写,但不许被人字段的写入顺手带偏。
 */
export const LEDGER_SOURCE_FIELDS = [
  'amount', 'currency', 'occurredAt', 'merchant', 'accountId',
  'direction', 'ledgerSource', 'externalId',
] as const;

/**
 * 人字段:代表**你的判断**。同步**永不覆盖**,任何档都可改。
 * 注意 reconState 也在这里 —— 对账状态是人的动作结果,不该被一次重同步抹掉。
 *
 * ⚠️ `lockedPeriod` 也在人字段里,意思是**锁定可以被你自己解开**(会计里的
 * 「重开期间」)。这是有意的:单用户产品里没有第二个人来批准,把锁做成谁都打不开
 * 只会逼人删了重记 —— 那才真的丢审计线索。代价是「已锁定」不是硬墙,所以解锁
 * 必须留痕(走 editLedgerField 就会自动记一笔),UI 上也要说清「这会重开 X 月」。
 */
export const LEDGER_HUMAN_FIELDS = [
  'category', 'note', 'txFlow', 'reconState', 'lockedPeriod', 'voided', 'voidReason',
] as const;

const SOURCE_SET: ReadonlySet<string> = new Set(LEDGER_SOURCE_FIELDS);
const HUMAN_SET: ReadonlySet<string> = new Set(LEDGER_HUMAN_FIELDS);

export const isLedgerSourceField = (f: string): boolean => SOURCE_SET.has(f);
export const isLedgerHumanField = (f: string): boolean => HUMAN_SET.has(f);

/**
 * 这条分录现在处在哪一档。
 * locked 优先于 reconciled —— 锁定是更强的约束(已报出去的数字不能再动)。
 */
export function ledgerFreezeTier(attrs: LedgerAttrs): LedgerFreezeTier {
  if (attrs.lockedPeriod) return 'locked';
  if (attrs.reconState === 'reconciled') return 'reconciled';
  return 'open';
}

export interface EditVerdict {
  allowed: boolean;
  /** 为什么不行 / 需要先做什么。给 UI 直接用,不让它自己编文案。 */
  reason?: 'needs_unreconcile' | 'locked_use_reversal' | 'unknown_field';
  /** 解除对账后就能改(UI 据此给「先解除对账」而不是硬拒)。 */
  unreconcileUnlocks?: boolean;
}

/**
 * 能不能改这个字段。**人字段任何档都能改** —— 分类/备注/关联是你的判断,
 * 跟对账无关;把它们一起冻住只会让人无法整理自己的账。
 */
export function canEditLedgerField(attrs: LedgerAttrs, field: string): EditVerdict {
  if (isLedgerHumanField(field)) return { allowed: true };
  if (!isLedgerSourceField(field)) return { allowed: false, reason: 'unknown_field' };
  const tier = ledgerFreezeTier(attrs);
  if (tier === 'locked') return { allowed: false, reason: 'locked_use_reversal' };
  if (tier === 'reconciled') {
    return { allowed: false, reason: 'needs_unreconcile', unreconcileUnlocks: true };
  }
  return { allowed: true };
}

// ── 变更历史 ────────────────────────────────────────────────────────────────
// attributes 只收标量,所以整条历史序列化进一个 JSON 字符串字段。
// 这是 Xero 的 Reconciliation History 那个位置的东西:改了什么、原值、何时。

export interface LedgerChange {
  at: string;
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
  /** 'edit' | 'void' | 'unreconcile' | 'reconcile' */
  kind: string;
}

export const LEDGER_CHANGELOG_ATTR = 'changeLog';
/** 变更历史上限:超了丢**最旧**的。审计价值集中在近期,而无上限会把节点撑爆。 */
export const LEDGER_CHANGELOG_MAX = 50;

export function readChangeLog(attrs: LedgerAttrs): LedgerChange[] {
  const raw = attrs[LEDGER_CHANGELOG_ATTR];
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as LedgerChange[]) : [];
  } catch { return []; }
}

export function appendChangeLog(attrs: LedgerAttrs, change: LedgerChange): string {
  const next = [...readChangeLog(attrs), change].slice(-LEDGER_CHANGELOG_MAX);
  return JSON.stringify(next);
}

/**
 * 改一个字段 → 返回要写进 attributes 的 patch(含变更历史)。
 * 不允许改时返回 null —— 调用方据 canEditLedgerField 的 verdict 给提示,不许静默吞掉。
 */
export function editLedgerField(
  attrs: LedgerAttrs,
  field: string,
  to: string | number | boolean | null,
  at: string,
): LedgerAttrs | null {
  if (!canEditLedgerField(attrs, field).allowed) return null;
  const from = (attrs[field] ?? null) as string | number | boolean | null;
  if (from === to) return {}; // 没变就不记一笔,免得历史被无意义的重复写噪音淹掉
  return {
    [field]: to,
    [LEDGER_CHANGELOG_ATTR]: appendChangeLog(attrs, { at, field, from, to, kind: 'edit' }),
  };
}

/**
 * 解除对账:把状态退回未对账并留痕。**不动任何源字段** ——
 * 解除对账本身不是修改,它只是让后续修改成为可能(Xero 的 unreconcile 语义)。
 */
export function unreconcileLedger(attrs: LedgerAttrs, at: string): LedgerAttrs | null {
  if (ledgerFreezeTier(attrs) === 'locked') return null; // 锁定期只能冲正
  if (attrs.reconState !== 'reconciled') return {};      // 本来就没对账,幂等
  return {
    reconState: 'open',
    [LEDGER_CHANGELOG_ATTR]: appendChangeLog(attrs, {
      at, field: 'reconState', from: 'reconciled', to: 'open', kind: 'unreconcile',
    }),
  };
}

/**
 * 作废(void):记录保留、原值留在历史里、聚合时跳过。**任何档都允许** ——
 * 已锁定期间发现一笔根本不存在的交易,也必须能作废;它不改任何源字段,
 * 因此不违反「锁定期原分录一个字不动」(金额/日期原样留着,只是不再计入)。
 */
export function voidLedgerEntry(attrs: LedgerAttrs, reason: string, at: string): LedgerAttrs {
  if (attrs.voided === true) return {}; // 幂等:重复作废不再记一笔
  return {
    voided: true,
    voidReason: reason,
    [LEDGER_CHANGELOG_ATTR]: appendChangeLog(attrs, {
      at, field: 'voided', from: false, to: true, kind: 'void',
    }),
  };
}

// ── 同步合并:源字段可更新,人字段永不覆盖 ──────────────────────────────────

/**
 * Plaid/statement 重同步时怎么合。这是整层里最容易写错、也最贵的一条:
 * 一次「顺手整块替换」就会把用户的分类/备注/关联全部抹掉。
 *
 * 规则:
 *   · 源字段:incoming 有值就更新(银行是权威),并按档留变更历史;
 *   · 人字段:**一律保留本地**,incoming 里的同名字段直接忽略;
 *   · 已锁定的分录:源字段也不动 —— 已报出去的数字不许被一次重同步改掉,
 *     差异应当走对账复核(见 finance-ledger-plan.md 的下游复核提示)。
 */
export function mergeSyncedLedger(
  existing: LedgerAttrs,
  incoming: LedgerAttrs,
  at: string,
): { patch: LedgerAttrs; changedFields: string[]; skippedLocked: boolean } {
  const locked = ledgerFreezeTier(existing) === 'locked';
  const patch: LedgerAttrs = {};
  const changedFields: string[] = [];
  // 只有「本来会改、被锁挡下」才算跳过。不这么算的话,锁定期里一次什么都没变的
  // 重同步也会报 skippedLocked=true,UI 就会挂一条「银行的新数字没写进来」的
  // 假警报 —— 而实际上银行根本没给新数字。
  let skippedLocked = false;
  let log = existing[LEDGER_CHANGELOG_ATTR];

  for (const [field, value] of Object.entries(incoming)) {
    // ⚠️ 真正拦住人字段的是**下面那行白名单**(人字段不在源字段名单里,自然进不来)。
    // 这一行是双保险:万一哪天有人把一个其实属于「人的判断」的字段误加进源字段名单,
    // 它还能兜住。自查时反证过 —— 单独去掉这一行行为不变,所以别把它当唯一防线;
    // 要验「人字段不被覆盖」,得去动白名单那行(去掉它,契约 ⑥c 立刻转红)。
    if (isLedgerHumanField(field)) continue;
    if (!isLedgerSourceField(field)) continue;        // 名单外的一律不动(未知字段不猜)
    if (value === undefined || value === null) continue;
    if (existing[field] === value) continue;
    if (locked) { skippedLocked = true; continue; }   // 锁定期:源字段也不动

    const from = (existing[field] ?? null) as string | number | boolean | null;
    patch[field] = value;
    changedFields.push(field);
    log = appendChangeLog({ ...existing, [LEDGER_CHANGELOG_ATTR]: log }, {
      at, field, from, to: value as string | number | boolean | null, kind: 'edit',
    });
  }
  if (changedFields.length) patch[LEDGER_CHANGELOG_ATTR] = log as string;
  return { patch, changedFields, skippedLocked };
}

// ── 净额:算出来,不存 ───────────────────────────────────────────────────────

export interface RefundLike { amount: number; voided?: boolean }

/**
 * 一笔支出的**实际花费** = 原额 − Σ(已关联、未作废的退款)。
 *
 * 为什么不存净额:退款可能有多笔、可能只退一部分、可能跨月(5 月买 6 月退)。
 * 存净额的话跨月那笔会让 5 月的数字在 6 月悄悄变化 —— 那正是 QA #21
 * 「财务数据跳变」那一类病。**存事实,算净额。**
 *
 * 作废的分录本身净额为 0(它不该再计入任何聚合)。
 */
export function netLedgerAmount(
  entry: { amount: number; voided?: boolean },
  refunds: readonly RefundLike[] = [],
): number {
  if (entry.voided === true) return 0;
  const refunded = refunds
    .filter((r) => r.voided !== true)
    .reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
  const net = Math.abs(Number(entry.amount) || 0) - refunded;
  // 退款超过原额(多退/错关联)时不许出现负的「花费」—— 钳到 0 并由对账去暴露差异,
  // 比让一个负数悄悄流进月度合计要诚实。
  return net > 0 ? Math.round(net * 100) / 100 : 0;
}
