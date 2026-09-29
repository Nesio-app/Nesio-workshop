/**
 * 财务流水 CSV 导入 / 导出。
 *
 * 金额约定与 Plaid 一致:正数 = 流出(支出),负数 = 流入(收入/退款)。
 * 时间段导出只看 date 字段(YYYY-MM-DD)。
 */
import { parseCsv } from './inventory-import';
import { normalizeCategory } from './tx-category';
import {
  loadBankTx, saveBankTx, loadBankAccounts, mergeBankTxForSync, bankTxWriteAllowed,
  displayAccountName, loadAccountNames,
  type BankTx,
} from './bank-tx';

export const FINANCE_CSV_HEADERS = [
  'date', 'name', 'amount', 'currency', 'category', 'category_detail',
  'account_id', 'account_name', 'flow', 'id',
] as const;

export type FinanceCsvRow = {
  date: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  categoryDetail?: string;
  accountId?: string;
  accountName?: string;
  flow?: string;
  id?: string;
};

function esc(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function ymDay(d: string): string {
  return (d || '').slice(0, 10);
}

/** 按日期闭区间过滤(含两端);空串表示不限。 */
export function filterTxByDateRange(txs: readonly BankTx[], from: string, to: string): BankTx[] {
  const f = ymDay(from);
  const t = ymDay(to);
  return txs.filter((x) => {
    const d = ymDay(x.date);
    if (!d) return false;
    if (f && d < f) return false;
    if (t && d > t) return false;
    return true;
  });
}

export function bankTxToCsv(txs: readonly BankTx[], opts?: { from?: string; to?: string }): string {
  const names = loadAccountNames();
  const accounts = loadBankAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const list = filterTxByDateRange(txs, opts?.from || '', opts?.to || '')
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || Math.abs(b.amount) - Math.abs(a.amount));
  const lines = [FINANCE_CSV_HEADERS.join(',')];
  for (const x of list) {
    const acct = x.accountId ? byId.get(x.accountId) : undefined;
    const acctName = acct ? displayAccountName(acct, names) : '';
    lines.push([
      esc(ymDay(x.date)),
      esc(x.name || ''),
      String(x.amount),
      esc((x.currency || 'USD').toUpperCase()),
      esc(x.category || ''),
      esc(x.categoryDetail || ''),
      esc(x.accountId || ''),
      esc(acctName),
      '', // flow 由导入端忽略;导出占位便于人读
      esc(x.id || ''),
    ].join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

const HEADER_ALIASES: Record<string, keyof FinanceCsvRow | 'flow'> = {
  date: 'date', 日期: 'date', 交易日: 'date', '交易日期': 'date',
  name: 'name', 商户: 'name', 描述: 'name', description: 'name', merchant: 'name',
  amount: 'amount', 金额: 'amount',
  currency: 'currency', 币种: 'currency', ccy: 'currency',
  category: 'category', 分类: 'category',
  category_detail: 'categoryDetail', categorydetail: 'categoryDetail', 细分类: 'categoryDetail', detail: 'categoryDetail',
  account_id: 'accountId', accountid: 'accountId', 账户id: 'accountId',
  account_name: 'accountName', accountname: 'accountName', 账户: 'accountName', 账户名: 'accountName',
  flow: 'flow', 流向: 'flow',
  id: 'id',
};

function mapHeader(h: string): keyof FinanceCsvRow | 'flow' | null {
  const k = h.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[k] || HEADER_ALIASES[h.trim()] || null;
}

export interface FinanceCsvImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

function resolveAccountId(accountId: string | undefined, accountName: string | undefined): string | null {
  const accounts = loadBankAccounts();
  if (accountId && accounts.some((a) => a.id === accountId)) return accountId;
  const names = loadAccountNames();
  const want = (accountName || '').trim().toLowerCase();
  if (want) {
    const hit = accounts.find((a) => {
      const n = displayAccountName(a, names).toLowerCase();
      const raw = (a.name || '').toLowerCase();
      return n === want || raw === want || n.includes(want) || want.includes(n);
    });
    if (hit) return hit.id;
  }
  // 兜底:唯一存款户 / 唯一账户
  const deps = accounts.filter((a) => (a.type || '').toLowerCase() === 'depository');
  if (deps.length === 1) return deps[0].id;
  if (accounts.length === 1) return accounts[0].id;
  return null;
}

/** 解析 CSV 文本 → 候选流水(不写盘)。 */
export function parseFinanceCsv(text: string): { rows: FinanceCsvRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length < 2) {
    errors.push('文件为空或只有表头');
    return { rows: [], errors };
  }
  const headers = table[0].map((h) => mapHeader(h));
  if (!headers.includes('date') || !headers.includes('amount') || !headers.includes('name')) {
    errors.push('表头需至少含 date / name / amount(或中文「日期/商户/金额」)');
    return { rows: [], errors };
  }
  const rows: FinanceCsvRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const get = (key: keyof FinanceCsvRow | 'flow') => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? (cells[idx] || '').trim() : '';
    };
    const dateRaw = get('date');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
      ? dateRaw
      : (Number.isFinite(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString().slice(0, 10) : '');
    const amount = Number(String(get('amount')).replace(/[$,]/g, ''));
    const name = get('name');
    if (!date || !name || !Number.isFinite(amount) || amount === 0) {
      errors.push(`第 ${i + 1} 行跳过:日期/名称/金额无效`);
      continue;
    }
    rows.push({
      date,
      name,
      amount,
      currency: (get('currency') || 'USD').toUpperCase(),
      category: get('category'),
      categoryDetail: get('categoryDetail') || undefined,
      accountId: get('accountId') || undefined,
      accountName: get('accountName') || undefined,
      flow: get('flow') || undefined,
      id: get('id') || undefined,
    });
  }
  return { rows, errors: errors.slice(0, 8) };
}

/** 把解析结果写入本机流水(按 id 去重合并;无 id 则新建 mtx-…)。 */
export function importFinanceCsv(text: string): FinanceCsvImportResult {
  const { rows, errors } = parseFinanceCsv(text);
  const result: FinanceCsvImportResult = { imported: 0, skipped: 0, errors: [...errors] };
  if (!rows.length) {
    if (!result.errors.length) result.errors.push('没有可导入的行');
    return result;
  }
  const existing = loadBankTx();
  const byId = new Map(existing.map((t) => [t.id, t]));
  const incoming: BankTx[] = [];
  for (const r of rows) {
    const accountId = resolveAccountId(r.accountId, r.accountName);
    if (!accountId) {
      result.skipped += 1;
      if (result.errors.length < 8) {
        result.errors.push(`${r.date} ${r.name}:找不到账户「${r.accountName || r.accountId || '?'}」`);
      }
      continue;
    }
    let signed = r.amount;
    const flow = (r.flow || '').toLowerCase();
    if (flow === 'income' && signed > 0) signed = -signed;
    if (flow === 'expense' && signed < 0) signed = -signed;
    const id = (r.id && !r.id.startsWith('mtx-import-')) ? r.id : `mtx-import-${r.date}-${Math.abs(signed)}-${(r.name || '').slice(0, 24)}`;
    const tx: BankTx = {
      id,
      date: r.date,
      name: r.name,
      amount: signed,
      currency: r.currency || 'USD',
      category: normalizeCategory(r.category || (signed < 0 ? 'INCOME' : 'OTHER')),
      ...(r.categoryDetail ? { categoryDetail: r.categoryDetail } : {}),
      accountId,
    };
    if (byId.has(id)) {
      // 覆盖同 id(更新)
      byId.set(id, { ...byId.get(id)!, ...tx });
    } else {
      incoming.push(tx);
    }
    result.imported += 1;
  }
  const base = [...byId.values()];
  const { merged } = mergeBankTxForSync(base, incoming, []);
  if (!bankTxWriteAllowed(existing.length, merged.length)) {
    result.errors.push('写入被保险丝拦住(疑似清空)——导入未保存');
    result.imported = 0;
    return result;
  }
  saveBankTx(merged);
  return result;
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
