/**
 * finance-sources — 跨域支出聚合口。
 * 银行流水仍是权威;旅行小票 / 相机小票等并成 Expense 视图,不写进 bank-tx。
 * 家务零花钱(play money)故意不进这里。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { dominantCurrency, loadBankTx, type BankTx } from '@/lib/portal/bank-tx';
const localDayKey = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 本地日键(vm 测试壳 stub require,lib 层内联不 import)

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

/** P0 修(逻辑审计 #1):手动/小票默认币种必须与银行主币种同源 —— 写死 '¥' 会让 USD 用户的
 *  每一笔手动账被 KPI 聚合当「异币种」静默排除。无银行数据时回退 ¥(纯手动中文用户)。 */
export function defaultFinanceCurrency(): string {
  try {
    const c = dominantCurrency(loadBankTx());
    return c || '¥';
  } catch { return '¥'; }
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
        currency: input.currency || list[idx].currency || defaultFinanceCurrency(),
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
    currency: input.currency || defaultFinanceCurrency(),
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
    currency: input.currency || defaultFinanceCurrency(),
    occurredAt: input.date || localDayKey(),
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
  // P2 修(逻辑审计 #3d):同一笔银行流水只能挂一张小票 —— 双关联会让两笔真实支出都退出 KPI
  if (bankTxId && list.some((e) => e.id !== expenseId && e.linkedBankTxId === bankTxId)) return false;
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
    currency: input.currency || defaultFinanceCurrency(),
    occurredAt: (input.date || localDayKey()).slice(0, 10),
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
  let bankIdCache: Set<string> | null = null;
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
      if (financeOnly && e.linkedBankTxId) {
        // P2 修(逻辑审计 #3e):关联的流水可能已消失(removedIds/5000 截断/孤儿过滤)——
        // 只在流水仍存在时才排除,否则自愈回落为普通域内行,这笔钱不再两边同时消失。
        if (bankIdCache == null) bankIdCache = new Set(loadBankTx().map((t) => t.id));
        if (bankIdCache.has(e.linkedBankTxId)) continue;
      }
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
  let count = 0;
  for (const e of rows) {
    if (e.kind === 'income') continue; // P0 修:手动收入(红包/工资)不是支出,不进「小票/旅行」合计
    total += e.amount;
    count += 1;
    bySource[e.source] = (bySource[e.source] || 0) + e.amount;
  }
  return { total, count, bySource };
}

/** 测试/诊断:清空域内支出(不动银行)。 */
export function clearDomainExpensesForTests(): void {
  saveDomainExpenses([]);
}
