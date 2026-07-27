/**
 * period-ledger — 派生账本共享原语(Σ进 − Σ出 / 实际 vs 预算)。
 * 身体账本、旅行预算、家务零花钱进度条数学都走这里;单位可以是货币或克/kcal。
 */

export type LedgerUnit = 'currency' | 'kcal' | 'g' | 'count' | 'points' | string;

export interface LedgerLine {
  id: string;
  label: string;
  /** 正数=进/实际消耗侧,或「已花」 */
  actual: number;
  /** 预算/目标;0 表示无目标 */
  budget: number;
}

export interface PeriodLedger {
  periodKey: string; // YYYY-MM-DD | YYYY-MM | tripId…
  unit: LedgerUnit;
  currency?: string;
  lines: LedgerLine[];
  /** 总实际 / 总预算(可由 lines 汇总,也可显式覆盖) */
  actualTotal: number;
  budgetTotal: number;
}

export function sumLedgerLines(lines: LedgerLine[]): { actualTotal: number; budgetTotal: number } {
  let actualTotal = 0;
  let budgetTotal = 0;
  for (const l of lines) {
    actualTotal += Number(l.actual) || 0;
    budgetTotal += Number(l.budget) || 0;
  }
  return { actualTotal, budgetTotal };
}

export function buildPeriodLedger(input: {
  periodKey: string;
  unit: LedgerUnit;
  currency?: string;
  lines: LedgerLine[];
  actualTotal?: number;
  budgetTotal?: number;
}): PeriodLedger {
  const sums = sumLedgerLines(input.lines);
  return {
    periodKey: input.periodKey,
    unit: input.unit,
    currency: input.currency,
    lines: input.lines,
    actualTotal: input.actualTotal ?? sums.actualTotal,
    budgetTotal: input.budgetTotal ?? sums.budgetTotal,
  };
}

/** 0–100 进度;无预算时实际>0 → 100,否则 0。 */
export function ledgerProgressPct(actual: number, budget: number): number {
  if (!(budget > 0)) return actual > 0 ? 100 : 0;
  return Math.min(100, Math.round((actual / budget) * 100));
}

/** 预算 − 实际(可负=超支)。 */
export function ledgerRemaining(actual: number, budget: number): number {
  return Math.round((budget || 0) - (actual || 0));
}

/** 目标 − 实际(还差多少);超了为 0。 */
export function ledgerShortfall(actual: number, goal: number): number {
  return Math.max(0, Math.round((goal || 0) - (actual || 0)));
}
