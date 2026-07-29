/**
 * 预算(财务㉒,Rocket Money 形态、warm-coach 语气)。
 *
 * 预算 = 总额 + 分类月预算(PFC 枚举键),存本机;「按你的习惯生成」用 L1 分类基线
 * (近 6 完整月 median)起草,用户可改。进度口径:分类 = 本月该类支出合计;
 * 总 = 本月净支出(与 KPI 同口径)。超支不用红,琥珀提醒即可(红仅真实风险)。
 */
import { reportStorageDropped } from './storage-health';
import {
  summarizeMonth, effectiveCategory, txFlow, loadFlowRules, expenseMerchants, availableMonths, ymOf,
  type BankTx,
} from './bank-tx';
import { categoryBaseline } from './finance-features';
import { COMMON_EXPENSE_CATEGORIES } from './tx-category';

export interface BudgetConfig {
  total?: number;                     // 月总预算(可选;不设则用分类合计)
  categories: Record<string, number>; // PFC → 月预算
}

const BUDGET_KEY = 'nesio-fin-budget-v1';

export function loadBudget(): BudgetConfig {
  if (typeof window === 'undefined') return { categories: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(BUDGET_KEY) || 'null') as BudgetConfig | null;
    if (raw && typeof raw === 'object' && raw.categories && typeof raw.categories === 'object') return raw;
  } catch { /* fallthrough */ }
  return { categories: {} };
}

export function saveBudget(b: BudgetConfig): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify(b)); } catch { reportStorageDropped(); }
}

/** 有没有可用预算(至少一个分类或总额)。 */
export function hasBudget(b: BudgetConfig): boolean {
  return (b.total ?? 0) > 0 || Object.values(b.categories).some((v) => v > 0);
}

/** 向上取整到 $10(预算是目标不是审计,整数更好记)。 */
const roundBudget = (v: number) => Math.max(10, Math.ceil(v / 10) * 10);

/**
 * 按个人基线起草预算:数据中出现过的支出类 ∪ 常用类,取近 6 完整月 median(≥3 月才起草);
 * 总额 = 分类合计。一条基线都没有(历史太短)返回 null,不硬编。
 */
export function suggestBudget(txs: BankTx[], now: Date = new Date()): BudgetConfig | null {
  const rules = loadFlowRules();
  const evidence = expenseMerchants(txs);
  const cats = new Set<string>(COMMON_EXPENSE_CATEGORIES);
  for (const t of txs) {
    if (txFlow(t, rules, evidence) === 'expense') {
      const c = effectiveCategory(t);
      if (c) cats.add(c);
    }
  }
  const categories: Record<string, number> = {};
  for (const c of cats) {
    const b = categoryBaseline(txs, c, now);
    if (b && b.median > 0) categories[c] = roundBudget(b.median);
  }
  if (!Object.keys(categories).length) return null;
  const total = roundBudget(Object.values(categories).reduce((s, v) => s + v, 0));
  return { total, categories };
}

export interface CategoryBudgetProgress {
  category: string;
  budget: number;
  spent: number;
  ratio: number; // spent/budget(>1 = 超出)
}

export interface BudgetProgress {
  total: { budget: number; spent: number; left: number; ratio: number } | null;
  perCategory: CategoryBudgetProgress[];
  otherSpent: number; // 财务㉖:未设预算的分类本月支出合计(Everything Else)
}

/** 某月预算进度。总口径 = 净支出(与 KPI 一致);分类口径 = 该类支出合计。 */
export function budgetProgress(txs: BankTx[], ym: string, budget: BudgetConfig, opts?: { domainNet?: number }): BudgetProgress {
  const rules = loadFlowRules();
  const evidence = expenseMerchants(txs);
  const spentByCat = new Map<string, number>();
  for (const t of txs) {
    if ((t.date || '').slice(0, 7) !== ym) continue;
    if (txFlow(t, rules, evidence) !== 'expense') continue;
    const c = effectiveCategory(t) || 'OTHER';
    spentByCat.set(c, (spentByCat.get(c) || 0) + Math.abs(t.amount));
  }
  const perCategory: CategoryBudgetProgress[] = Object.entries(budget.categories)
    .filter(([, v]) => v > 0)
    .map(([category, b]) => {
      const spent = Math.round((spentByCat.get(category) || 0) * 100) / 100;
      return { category, budget: b, spent, ratio: Math.round((spent / b) * 100) / 100 };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const totalBudget = budget.total ?? Object.values(budget.categories).reduce((s, v) => s + v, 0);
  const total = totalBudget > 0
    ? (() => {
        const spent = summarizeMonth(txs, ym).net + (opts?.domainNet ?? 0); // 口径统一:与 KPI 同含域内(小票/手动)支出
        return { budget: totalBudget, spent, left: Math.round((totalBudget - spent) * 100) / 100, ratio: Math.round((spent / totalBudget) * 100) / 100 };
      })()
    : null;
  // 财务㉖:Everything Else —— 没设预算的分类合计,超支往往藏在这里
  const budgeted = new Set(Object.keys(budget.categories).filter((c) => budget.categories[c] > 0));
  let otherSpent = 0;
  for (const [c, v] of spentByCat) if (!budgeted.has(c)) otherSpent += v;
  return { total, perCategory, otherSpent: Math.round(otherSpent * 100) / 100 };
}

/** 当前月(数据里最新月优先落在当前日历月时)——预算页默认锚点。 */
export function budgetMonth(txs: BankTx[], now: Date = new Date()): string {
  const cur = ymOf(now);
  const av = availableMonths(txs);
  return av.includes(cur) ? cur : (av[0] ?? cur);
}
