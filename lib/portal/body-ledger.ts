/**
 * body-ledger — 身体账本(美味 × 健康交集)。
 *
 * 模型:当日摄入(记一餐) vs 目标;训练抬高消耗/蛋白目标;
 * 缺口 ∩ 库存 ∩ 菜谱 → 补餐建议;血糖日事实 × 餐名 → 稳/飙模式(探索性,非诊断)。
 * 不建竖井:餐=记忆节点;血糖=Apple Health 导入;护肤=物品分类。
 */

import { getMeals, type Meal } from '@/lib/cooking/meals';
import { listPantry } from '@/lib/cooking/pantry';
import { normalizeIngredient } from '@/lib/cooking/food-catalog';
import { loadRecipes } from '@/lib/cooking/food-data';
import { matchRecipes } from '@/lib/cooking/recipe-match';
import type { DailyFact, GlucoseAnalysis, ActivityRings } from '@/lib/portal/providers/apple-health';
import { listInventoryItems, type InventoryItem } from '@/lib/portal/inventory';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { ledgerShortfall } from '@/lib/portal/period-ledger';

export type BodyGoalKind = 'muscle' | 'maintain' | 'cut';

export interface BodyLedgerGoals {
  goal: BodyGoalKind;
  proteinG: number;
  energyKCal: number;
  carbsG: number;
}

export interface DayIntake {
  date: string;
  meals: Meal[];
  protein: number;
  energyKCal: number;
  carbs: number;
  fat: number;
}

export interface DayLedger extends DayIntake {
  goals: BodyLedgerGoals;
  /** 训练带来的额外热量预算(展示用) */
  trainingBonusKCal: number;
  trainingMin: number;
  proteinGap: number;
  energyLeft: number;
  carbsLeft: number;
}

export interface DinnerSuggestion {
  name: string;
  canCook: boolean;
  missing: string[];
  tags: string[];
  score: number;
}

export interface FoodReactionRow {
  name: string;
  avgRise: number; // 显示单位与血糖一致时由调用方换算;内部用 mg/dL 升幅
  n: number;
  tone: 'spike' | 'stable';
}

const GOALS_KEY = 'nesio-body-ledger-goals-v1';

const DEFAULT_BY_GOAL: Record<BodyGoalKind, Omit<BodyLedgerGoals, 'goal'>> = {
  muscle: { proteinG: 120, energyKCal: 2000, carbsG: 220 },
  maintain: { proteinG: 90, energyKCal: 1800, carbsG: 200 },
  cut: { proteinG: 110, energyKCal: 1600, carbsG: 150 },
};

const PROTEIN_HINT = /鸡胸|鸡|蛋|豆腐|鱼|虾|牛肉|牛奶|酸奶|三文鱼|蛋白|瘦肉|salmon|chicken|egg|tofu|fish|shrimp|beef|protein/i;

export function todayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function goalLabel(goal: BodyGoalKind, zh: boolean): string {
  if (goal === 'muscle') return zh ? '增肌' : 'Muscle gain';
  if (goal === 'cut') return zh ? '减脂' : 'Cut';
  return zh ? '维持' : 'Maintain';
}

export function loadBodyLedgerGoals(): BodyLedgerGoals {
  if (typeof window === 'undefined') {
    return { goal: 'muscle', ...DEFAULT_BY_GOAL.muscle };
  }
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (!raw) return { goal: 'muscle', ...DEFAULT_BY_GOAL.muscle };
    const parsed = JSON.parse(raw) as Partial<BodyLedgerGoals>;
    const goal: BodyGoalKind =
      parsed.goal === 'cut' || parsed.goal === 'maintain' || parsed.goal === 'muscle'
        ? parsed.goal
        : 'muscle';
    const base = DEFAULT_BY_GOAL[goal];
    return {
      goal,
      proteinG: Number(parsed.proteinG) > 0 ? Number(parsed.proteinG) : base.proteinG,
      energyKCal: Number(parsed.energyKCal) > 0 ? Number(parsed.energyKCal) : base.energyKCal,
      carbsG: Number(parsed.carbsG) > 0 ? Number(parsed.carbsG) : base.carbsG,
    };
  } catch {
    return { goal: 'muscle', ...DEFAULT_BY_GOAL.muscle };
  }
}

export function saveBodyLedgerGoals(next: BodyLedgerGoals): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(next));
    return true;
  } catch {
    reportStorageDropped();
    return false;
  }
}

export function setBodyGoalKind(goal: BodyGoalKind): BodyLedgerGoals {
  const next = { goal, ...DEFAULT_BY_GOAL[goal] };
  saveBodyLedgerGoals(next);
  return next;
}

export function mealsOnDay(date: string, all = getMeals()): Meal[] {
  return all.filter((m) => m.occurredAt === date);
}

export function sumMeals(meals: Meal[]): Omit<DayIntake, 'date' | 'meals'> {
  return meals.reduce(
    (acc, m) => ({
      protein: acc.protein + (m.protein || 0),
      energyKCal: acc.energyKCal + (m.energyKCal || 0),
      carbs: acc.carbs + (m.cho || 0),
      fat: acc.fat + (m.fat || 0),
    }),
    { protein: 0, energyKCal: 0, carbs: 0, fat: 0 },
  );
}

export function dayIntake(date: string, all = getMeals()): DayIntake {
  const meals = mealsOnDay(date, all);
  return { date, meals, ...sumMeals(meals) };
}

/** 训练抬目标:活动三环锻炼分钟 ≥30 → 蛋白 +10、热量预算 +400(与稿一致)。 */
export function trainingAdjust(
  goals: BodyLedgerGoals,
  rings?: ActivityRings | null,
): { goals: BodyLedgerGoals; trainingMin: number; trainingBonusKCal: number } {
  const trainingMin = rings && rings.date === todayYmd() ? Math.round(rings.exercise || 0) : 0;
  if (trainingMin < 30) {
    return { goals, trainingMin, trainingBonusKCal: 0 };
  }
  return {
    trainingMin,
    trainingBonusKCal: 400,
    goals: {
      ...goals,
      proteinG: goals.proteinG + 10,
      energyKCal: goals.energyKCal + 400,
    },
  };
}

export function buildDayLedger(
  date = todayYmd(),
  opts?: { rings?: ActivityRings | null; goals?: BodyLedgerGoals; meals?: Meal[] },
): DayLedger {
  const baseGoals = opts?.goals ?? loadBodyLedgerGoals();
  const { goals, trainingMin, trainingBonusKCal } = trainingAdjust(baseGoals, opts?.rings);
  const intake = dayIntake(date, opts?.meals ?? getMeals());
  return {
    ...intake,
    goals,
    trainingMin,
    trainingBonusKCal,
    proteinGap: ledgerShortfall(intake.protein, goals.proteinG),
    energyLeft: Math.round(goals.energyKCal - intake.energyKCal),
    carbsLeft: Math.round(goals.carbsG - intake.carbs),
  };
}

/** 缺口提示文案(warm-coach,非诊断)。 */
export function ledgerPrompt(ledger: DayLedger, zh: boolean): string | null {
  if (ledger.meals.length === 0 && ledger.proteinGap <= 0) {
    return zh
      ? '今天还没记一餐 —— 吃完在「美味」里记一下,账本就会亮起来。'
      : 'No meals logged today — log one in Cooking and the ledger lights up.';
  }
  if (ledger.proteinGap >= 20) {
    return zh
      ? `蛋白还差约 ${ledger.proteinGap}g · 热量预算还剩 ${Math.max(0, ledger.energyLeft)} kcal —— 可从冰箱补一餐。`
      : `About ${ledger.proteinGap}g protein short · ${Math.max(0, ledger.energyLeft)} kcal left — refill from the fridge.`;
  }
  if (ledger.energyLeft < -200) {
    return zh
      ? '今天热量已经超预算一点 —— 先喝杯水,下一餐轻轻收一点就好。'
      : 'A bit over the calorie budget — a glass of water, then ease the next meal.';
  }
  if (ledger.proteinGap > 0) {
    return zh
      ? `蛋白还差 ${ledger.proteinGap}g,轻轻补一口就好。`
      : `${ledger.proteinGap}g protein still open — a light top-up is enough.`;
  }
  return zh ? '今天的账大致平了 —— 身体会记得。' : 'Today’s ledger is roughly balanced.';
}

/**
 * 目标 ∩ 库存 ∩ 缺白 → 补餐建议。
 * 优先能做、名字偏蛋白、缺料少。
 */
export async function suggestDinnerForGap(
  proteinGap: number,
  limit = 3,
): Promise<{ suggestions: DinnerSuggestion[]; error?: string }> {
  try {
    const recipes = await loadRecipes();
    const pantry = new Set(
      listPantry().map((i) => normalizeIngredient(i.name).name).filter(Boolean),
    );
    const matches = matchRecipes(recipes, pantry, normalizeIngredient, { onlyWithPantry: true });
    const scored = matches.map((m) => {
      const proteinish = PROTEIN_HINT.test(m.recipe.name) || m.recipe.ingredients.some((ing) => PROTEIN_HINT.test(ing));
      let score = m.score * 10 + (m.canCook ? 5 : 0) - m.missing.length * 0.8;
      if (proteinish) score += 4;
      if (proteinGap >= 25 && proteinish) score += 3;
      const tags: string[] = [];
      if (m.canCook) tags.push('库存有');
      if (proteinish) tags.push('偏蛋白');
      if (m.missing.length === 1) tags.push('只差 1 样');
      return {
        name: m.recipe.name,
        canCook: m.canCook,
        missing: m.missing,
        tags,
        score,
      } satisfies DinnerSuggestion;
    });
    scored.sort((a, b) => b.score - a.score);
    return { suggestions: scored.slice(0, limit) };
  } catch (err) {
    return {
      suggestions: [],
      error: err instanceof Error ? err.message : 'suggest_failed',
    };
  }
}

/** 餐名 × 同日血糖日振幅 → 稳/飙探索排序(mg/dL)。N 小则诚实标样本。 */
export function rankFoodReactions(
  meals: Meal[],
  daily: DailyFact[] | undefined,
  opts?: { minN?: number; limit?: number },
): FoodReactionRow[] {
  const minN = opts?.minN ?? 2;
  const limit = opts?.limit ?? 8;
  if (!daily?.length || !meals.length) return [];
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const acc = new Map<string, { sum: number; n: number }>();
  for (const meal of meals) {
    const fact = byDate.get(meal.occurredAt);
    if (!fact || fact.glucoseMax == null || fact.glucoseAvg == null) continue;
    const rise = fact.glucoseMax - fact.glucoseAvg;
    if (!Number.isFinite(rise)) continue;
    for (const item of meal.items) {
      const name = (item.name || '').trim();
      if (!name || name.length < 2) continue;
      const cur = acc.get(name) || { sum: 0, n: 0 };
      cur.sum += rise;
      cur.n += 1;
      acc.set(name, cur);
    }
  }
  const rows: FoodReactionRow[] = [];
  for (const [name, { sum, n }] of acc) {
    if (n < minN) continue;
    const avgRise = sum / n;
    rows.push({
      name,
      avgRise,
      n,
      tone: avgRise >= 40 ? 'spike' : 'stable', // ~2.2 mmol/L 振幅作「偏飙」探索线
    });
  }
  rows.sort((a, b) => b.avgRise - a.avgRise);
  return rows.slice(0, limit);
}

export function mgDlToDisplay(mg: number, unit: GlucoseAnalysis['unit']): number {
  return unit === 'mmol/L' ? Math.round((mg / 18) * 10) / 10 : Math.round(mg);
}

/** 护肤/美容护理:物品分类「护肤」或标签含护肤/美妆。 */
export function listBeautyCareItems(): InventoryItem[] {
  return listInventoryItems().filter((i) => {
    const cat = (i.category || '').trim();
    if (cat === '护肤' || /护肤|美妆|美容|skincare|beauty/i.test(cat)) return true;
    return (i.tags || []).some((t) => /护肤|美妆|美容|skincare|beauty/i.test(t));
  });
}

/** 给概览用的快捷入口 id。 */
export type BodyLedgerSection = 'today' | 'postmeal' | 'reaction' | 'care';
