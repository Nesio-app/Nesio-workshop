/**
 * finance-sources — 跨域支出聚合口。
 * 银行流水仍是权威;旅行小票 / 相机小票等并成 Expense 视图,不写进 bank-tx。
 * 家务零花钱(play money)故意不进这里。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { loadBankTx, type BankTx } from '@/lib/portal/bank-tx';

export type ExpenseSource = 'bank' | 'receipt' | 'travel' | 'tesla' | 'manual';

export interface Expense {
  id: string;
  amount: number;
  currency: string;
  /** YYYY-MM-DD */
  occurredAt: string;
  source: ExpenseSource;
  sourceRef?: string;
  category?: string;
  merchant?: string;
  note?: string;
  placeId?: string;
  /** false = 只记域内(如旅行预算),不计入财务月汇总 */
  includeInFinance: boolean;
  /** P1「+」记一笔:income = 收入(红包/现金收入…);缺省 = expense(老数据兼容)。 */
  kind?: 'expense' | 'income';
  /** P1 资金渠道:手动 cash 资产(finance-assets isChannel)的 id;Plaid 账户则用 accountId 语义。 */
  channelId?: string;
  /** P1 小票对账:已关联的银行流水 id —— 关联后本行降级为明细层,不再进月汇总(防双计)。 */
  linkedBankTxId?: string;
  /** P2 资产持有成本:关联的手动资产 id(税金/维修记到房/车名下,同时照常计入月支出)。 */
  assetId?: string;
  /** P2 持有成本类型(仅 assetId 存在时有意义)。 */
  assetCostKind?: 'tax' | 'repair' | 'insurance' | 'other';
  createdAt: string;
}

export const EXPENSES_KEY = 'nesio-expenses-v1';
export const EXPENSES_EVENT = 'nesio-expenses-updated';

const store = createBlobStore<Expense[]>({
  key: EXPENSES_KEY,
  updateEvent: EXPENSES_EVENT,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadDomainExpenses(): Expense[] {
  const raw = store.load();
  return Array.isArray(raw) ? raw : [];
}

export function saveDomainExpenses(list: Expense[]): void {
  store.save(list);
}

export function addExpense(input: Omit<Expense, 'id' | 'createdAt'> & { id?: string }): Expense {
  const list = loadDomainExpenses();
  // sourceRef 幂等：同来源指纹则 upsert，避免相机/行程重复入账
  if (input.sourceRef) {
    const idx = list.findIndex((e) => e.source === input.source && e.sourceRef === input.sourceRef);
    if (idx >= 0) {
      const updated: Expense = {
        ...list[idx],
        ...input,
        id: list[idx].id,
        createdAt: list[idx].createdAt,
        includeInFinance: input.includeInFinance !== false,
        currency: input.currency || list[idx].currency || '¥',
      };
      list[idx] = updated;
      saveDomainExpenses(list);
      return updated;
    }
  }
  const row: Expense = {
    ...input,
    id: input.id || uid('exp'),
    createdAt: new Date().toISOString(),
    includeInFinance: input.includeInFinance !== false,
    currency: input.currency || '¥',
  };
  list.unshift(row);
  saveDomainExpenses(list.slice(0, 2000));
  return row;
}

/** P1「+」记一笔:手动收支(spec 写了却一直没接 UI 的手工写入门)。amount 恒正,方向由 kind 表达。 */
export function addManualEntry(input: {
  amount: number; kind: 'expense' | 'income';
  date?: string; category?: string; note?: string; channelId?: string; currency?: string;
  assetId?: string; assetCostKind?: 'tax' | 'repair' | 'insurance' | 'other';
}): Expense | null {
  if (!(input.amount > 0)) return null;
  return addExpense({
    amount: input.amount,
    kind: input.kind,
    currency: input.currency || '¥',
    occurredAt: input.date || new Date().toISOString().slice(0, 10),
    source: 'manual',
    ...(input.category ? { category: input.category } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.assetId ? { assetId: input.assetId, assetCostKind: input.assetCostKind || 'other' } : {}),
    includeInFinance: true,
  });
}

/** P1 小票对账:关联/解除银行流水(关联后 financeOnly 聚合自动排除,防双计)。 */
export function linkExpenseToBankTx(expenseId: string, bankTxId: string | null): boolean {
  const list = loadDomainExpenses();
  const idx = list.findIndex((e) => e.id === expenseId);
  if (idx < 0) return false;
  if (bankTxId) list[idx] = { ...list[idx], linkedBankTxId: bankTxId };
  else { const { linkedBankTxId: _drop, ...rest } = list[idx]; list[idx] = rest as Expense; }
  saveDomainExpenses(list);
  return true;
}

/** 小票多行 → 一笔合计支出(默认记入财务)。 */
export function addReceiptExpense(input: {
  lines: { name: string; price?: number }[];
  date?: string;
  currency?: string;
  merchant?: string;
  source?: 'receipt' | 'travel';
  sourceRef?: string;
  includeInFinance?: boolean;
  placeId?: string;
  note?: string;
}): Expense | null {
  const amount = input.lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
  if (!(amount > 0)) return null;
  const names = input.lines.map((l) => l.name).filter(Boolean).slice(0, 4).join('、');
  return addExpense({
    amount,
    currency: input.currency || '¥',
    occurredAt: (input.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    source: input.source || 'receipt',
    sourceRef: input.sourceRef,
    merchant: input.merchant,
    note: input.note || names,
    placeId: input.placeId,
    category: '购物',
    includeInFinance: input.includeInFinance !== false,
  });
}

function bankToExpense(tx: BankTx): Expense | null {
  const amount = Number(tx.amount);
  // Plaid:正数 = 花出去
  if (!(amount > 0)) return null;
  return {
    id: `bank:${tx.id}`,
    amount,
    currency: tx.currency || 'USD',
    occurredAt: (tx.date || '').slice(0, 10),
    source: 'bank',
    sourceRef: tx.id,
    category: tx.category || undefined,
    merchant: tx.name,
    note: tx.name,
    includeInFinance: true,
    createdAt: tx.authorizedDate || tx.date || new Date().toISOString(),
  };
}

function ymOf(d: string): string {
  return (d || '').slice(0, 7);
}

/**
 * 某月支出视图:银行 ∪ 域内小票/旅行。
 * Tesla 已由 FinanceTab 并进 bank 显示层,此处不另计,避免双计。
 */
export function listExpenses(
  ym: string,
  opts?: { includeBank?: boolean; includeDomain?: boolean; financeOnly?: boolean },
): Expense[] {
  const includeBank = opts?.includeBank !== false;
  const includeDomain = opts?.includeDomain !== false;
  const financeOnly = opts?.financeOnly !== false;
  const out: Expense[] = [];

  if (includeBank) {
    for (const tx of loadBankTx()) {
      if (ymOf(tx.date) !== ym) continue;
      const e = bankToExpense(tx);
      if (e) out.push(e);
    }
  }

  if (includeDomain) {
    for (const e of loadDomainExpenses()) {
      if (ymOf(e.occurredAt) !== ym) continue;
      if (financeOnly && !e.includeInFinance) continue;
      if (financeOnly && e.linkedBankTxId) continue; // P1:已关联银行流水 → 明细层,KPI 以银行为准(防双计)
      out.push(e);
    }
  }

  out.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  return out;
}

/** 域内(非银行)支出合计——FinanceTab 旁条用。 */
export function domainExpenseTotal(ym: string): { total: number; count: number; bySource: Record<string, number> } {
  const rows = listExpenses(ym, { includeBank: false, includeDomain: true, financeOnly: true });
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const e of rows) {
    total += e.amount;
    bySource[e.source] = (bySource[e.source] || 0) + e.amount;
  }
  return { total, count: rows.length, bySource };
}

/** 测试/诊断:清空域内支出(不动银行)。 */
export function clearDomainExpensesForTests(): void {
  saveDomainExpenses([]);
}
