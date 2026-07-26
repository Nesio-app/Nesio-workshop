/**
 * meal-plan-core — 做饭计划(周)的**纯确定性排菜核心**(无 import 数据/DOM,可 node 单测)。
 * 输入 = 已和库存匹配好的菜谱(RecipeMatch)+ 天数标签 + 快过期标准名集合。
 * 规则(确定性为主):防过期项优先排最近几天 → on-hand 能做的优先 → 其余标「需采购」;
 * 排不满的天标「餐厅(外食)」不进库存扣减。一周缺料 = Σ 计划里非常备缺料(去重)。
 * AI 补空/平衡口味是 Pro 的可选增强,不在此核心。
 */
import type { RecipeMatch } from './recipe-match';

export type PlanStatus = '库存够' | '需采购' | '餐厅';
export interface PlanDay {
  day: string;
  dishName: string | null;   // null = 外食
  status: PlanStatus;
  missing: string[];
  reason: string;            // '防过期先用' / '' / '外食'
}
export interface WeekPlan { days: PlanDay[]; missingAll: string[] }

/** 排一周:matches 已按库存匹配;dayLabels 逐天;soonNames = 快过期标准名集合。 */
export function planWeek<R extends { name: string }>(
  matches: ReadonlyArray<RecipeMatch<R>>, dayLabels: readonly string[], soonNames: ReadonlySet<string>,
): WeekPlan {
  const usesSoon = (m: RecipeMatch<R>) => m.have.some((n) => soonNames.has(n));
  const ranked = [...matches].sort((a, b) =>
    (Number(usesSoon(b)) - Number(usesSoon(a))) ||
    (Number(b.canCook) - Number(a.canCook)) ||
    (b.score - a.score) ||
    (a.missing.length - b.missing.length),
  );
  const used = new Set<string>();
  const days: PlanDay[] = [];
  const missingAll = new Set<string>();
  let i = 0;
  for (const day of dayLabels) {
    // 跳过重复菜名,一周不排两次同一道。
    while (ranked[i] && used.has(ranked[i].recipe.name)) i += 1;
    const m = ranked[i];
    if (!m) { days.push({ day, dishName: null, status: '餐厅', missing: [], reason: '外食' }); continue; }
    used.add(m.recipe.name); i += 1;
    if (!m.canCook) m.missing.forEach((x) => missingAll.add(x));
    days.push({
      day, dishName: m.recipe.name,
      status: m.canCook ? '库存够' : '需采购',
      missing: m.missing,
      reason: usesSoon(m) ? '防过期先用' : '',
    });
  }
  return { days, missingAll: [...missingAll] };
}
