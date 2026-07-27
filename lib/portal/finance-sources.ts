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
