/**
 * statement-reconcile — 把「解析出的 statement」和「账本里已有的流水」接起来(L3-b 的确定性层)。
 *
 * UI 只负责选文件、显示、点确认;这一层负责所有会算错的事,所以它是纯函数、能被真跑。
 *
 * ⚠️⚠️ **符号约定在这里对齐,这是整条链上最容易静默出错的一处。**
 *
 *   BankTx.amount   —— Plaid 约定:**支出为正**(FinanceTab:`a >= 0 ? '-' : '+'`)
 *   CandidateTx.amount —— 本仓解析器:**支出为负**(和会计直觉一致)
 *
 * 两边直接比的话:一笔 $91.69 的消费在银行侧是 +91.69、在解析侧是 −91.69,
 * 金额相等判定(分分不差)永远不成立 → 每一行都会被报成「银行有我没有」+
 * 「我有银行没有」,对账台上凭空出现两倍的未达账项,而且看起来都很真。
 * 更糟的一种:真的退款(银行侧 −)会和消费(解析侧 −)配上,「已对账」打在错的一对上。
 *
 * 所以**只有这一个函数**做翻号(`bankTxToItems`),别处一律用统一后的
 * 「流出为负」。契约里有一条直接钉住这件事。
 */

import type { AmountItem, MatchResult, ReconcileResult, Diagnosis } from './ledger-reconcile';
import { reconcileAssertion, matchStatementRows, diagnoseDelta } from './ledger-reconcile';
import type { CandidateTx, StatementHeader } from './statement-parse';

/** 只声明这里用得到的字段 —— 不把整个 BankTx 类型图拖进来。 */
export interface BankTxLike {
  id: string;
  date: string;
  name?: string;
  /** ⚠️ Plaid 约定:**支出为正**。 */
  amount: number;
}

/**
 * 银行流水 → 统一口径(流出为负)。**全仓唯一的翻号点。**
 * 见文件头:漏了这一下,对账台会凭空多出两倍的未达账项。
 */
export function bankTxToItems(txs: readonly BankTxLike[]): AmountItem[] {
  return txs.map((t) => ({
    id: t.id,
    occurredAt: (t.date || '').slice(0, 10),
    amount: -t.amount,
    ...(t.name ? { merchant: t.name } : {}),
  }));
}

/** 解析出的候选行 → 统一口径。它本来就是流出为负,所以**不翻号**。 */
export function candidatesToItems(rows: readonly CandidateTx[]): AmountItem[] {
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt,
    amount: r.amount,
    ...(r.description ? { merchant: r.description } : {}),
  }));
}

// ── 幂等:同一份单子接受两次不许翻倍 ────────────────────────────────────────

export const STATEMENT_SOURCE_PREFIX = 'statement:';

/**
 * 一条候选行落库时的来源标记。
 *
 * 这是**幂等键** —— 同一个文件重新解析、再点一次「接受」,已经进过账的行不该再进一次。
 * 连接器那边正是因为没有这个键,每点一次同步就整批重灌(见 connector-idempotency 契约)。
 * 对账更严重:重复的是钱。
 *
 * `fileKey` 由调用方给(文件名 + 大小 + 期间,或文件哈希),要求同一份文件恒定。
 */
export function statementSourceRef(fileKey: string, rowId: string): string {
  return `${STATEMENT_SOURCE_PREFIX}${fileKey}:${rowId}`;
}

/** 从已有账目里挑出「这份单子已经进过账的行 id」。 */
export function importedRowIds(
  existing: ReadonlyArray<{ sourceRef?: string }>,
  fileKey: string,
): Set<string> {
  const prefix = `${STATEMENT_SOURCE_PREFIX}${fileKey}:`;
  const out = new Set<string>();
  for (const e of existing) {
    if (typeof e.sourceRef === 'string' && e.sourceRef.startsWith(prefix)) {
      out.add(e.sourceRef.slice(prefix.length));
    }
  }
  return out;
}

// ── 一次对账 ────────────────────────────────────────────────────────────────

export type RowState =
  /** 银行有、账本没有 → 可以补录。 */
  | 'new'
  /** 已经配上账本里的一笔 —— 默认不重复录入。 */
  | 'matched'
  /** 这份单子之前已经接受过这一行(幂等键命中)。 */
  | 'imported';

export interface ReviewRow {
  candidate: CandidateTx;
  state: RowState;
  /** state==='matched' 时,配上的那条账本流水 id。 */
  matchedId?: string;
  /** 配上的两条差了几天(0 = 同日)。给 UI 显示,让人判断该不该信。 */
  dayGap?: number;
}

export interface StatementReview {
  rows: ReviewRow[];
  match: MatchResult;
  /** 断言对账结果;抽不到期初/期末时为 null(没有断言就没有差额可言)。 */
  reconcile: ReconcileResult | null;
  diagnosis: Diagnosis | null;
  /** 默认勾选的行 —— 只有 new,不含 matched/imported。 */
  defaultSelected: string[];
}

/**
 * 把解析结果、账本流水、已导入记录合成一份可以直接渲染的复核清单。
 *
 * 默认只勾 `new`:
 *   · `matched` 不勾 —— 勾了就是把银行已经有的那笔又记一遍,月支出直接翻倍;
 *   · `imported` 不勾 —— 那是上一次已经接受过的,重复的是钱。
 * 人当然可以手动改,但**默认值必须站在「不重复记账」这一边**。
 */
export function reviewStatement(input: {
  rows: readonly CandidateTx[];
  header: StatementHeader;
  bankTx: readonly BankTxLike[];
  /** 已有账目(用来查幂等键),只需要 sourceRef 字段。 */
  existing?: ReadonlyArray<{ sourceRef?: string }>;
  fileKey: string;
  /** 原始行文本,给差额诊断用(「这一行金额读错了」要回原文找别的数)。 */
  rawById?: Readonly<Record<string, string>>;
}): StatementReview {
  const items = candidatesToItems(input.rows);
  const ledger = bankTxToItems(input.bankTx);
  const match = matchStatementRows(items, ledger);

  const matchedById = new Map(match.matched.map((p) => [p.statement.id, p]));
  const imported = importedRowIds(input.existing ?? [], input.fileKey);

  const rows: ReviewRow[] = input.rows.map((c) => {
    if (imported.has(c.id)) return { candidate: c, state: 'imported' };
    const pair = matchedById.get(c.id);
    if (pair) return { candidate: c, state: 'matched', matchedId: pair.ledger.id, dayGap: pair.dayGap };
    return { candidate: c, state: 'new' };
  });

  // 有期初 + 期末才谈得上「差多少」。没有就不报差额 —— 编一个出来只会误导。
  let reconcile: ReconcileResult | null = null;
  let diagnosis: Diagnosis | null = null;
  const { openingBalance, closingBalance, periodStart, periodEnd } = input.header;
  if (openingBalance !== undefined && closingBalance !== undefined && periodStart && periodEnd) {
    reconcile = reconcileAssertion(items, {
      kind: 'balance', periodStart, periodEnd, openingBalance, expected: closingBalance,
    });
    diagnosis = diagnoseDelta(reconcile, match, input.rawById ?? {});
  }

  return {
    rows, match, reconcile, diagnosis,
    defaultSelected: rows.filter((r) => r.state === 'new').map((r) => r.candidate.id),
  };
}

/**
 * 一行候选 → 写进账本要的入参。**方向在这里翻回账本口径**(amount 恒正,方向由 kind 表达)。
 *
 * 注意这是第二个符号转换点,和 `bankTxToItems` 成对:
 * 统一口径(流出为负) → 账本口径(金额恒正 + kind)。写错的话收入会被记成支出。
 */
export function candidateToEntry(c: CandidateTx, fileKey: string): {
  amount: number; kind: 'expense' | 'income'; date: string; note: string; sourceRef: string;
} {
  return {
    amount: Math.abs(c.amount),
    kind: c.amount < 0 ? 'expense' : 'income',
    date: c.occurredAt,
    note: c.description || '',
    sourceRef: statementSourceRef(fileKey, c.id),
  };
}
