/**
 * recipe-match — 正向匹配**纯核心**(无数据 import,可 node 单测)。
 * 「手上能做什么」= 库存 ∩ 菜谱;缺料 = 配料 − 库存 − 常备。
 *
 * 焊点用法:菜谱配料词、库存名都先过 normalize(上层传入,绑定标准名集合)对齐同一个 key,
 * 再做集合运算。**常备(调料/水/高汤)不计入缺料**——否则每道菜都「缺盐」。
 * 纯集合算术,确定性、可对账,不引 ML。
 */
import type { NormalizedIngredient } from './ingredient-normalize';

export interface RecipeLike { ingredients: string[]; }

export interface RecipeMatch<R> {
  recipe: R;
  have: string[];     // 库存里有的(归一化标准名,去重,非常备)
  missing: string[];  // 缺的(非常备)
  staples: string[];  // 常备(不计缺,单列供展示)
  score: number;      // have /(have+missing);全是常备时算 1
  canCook: boolean;   // 无缺料
}

type Normalizer = (raw: string) => NormalizedIngredient;

/** 单菜匹配:pantry = 库存食材归一化后的标准名集合。 */
export function matchRecipe<R extends RecipeLike>(recipe: R, pantry: Set<string>, normalize: Normalizer): RecipeMatch<R> {
  const have = new Set<string>();
  const missing = new Set<string>();
  const staples = new Set<string>();
  for (const raw of recipe.ingredients || []) {
    const n = normalize(raw);
    if (!n.name) continue;
    if (n.isStaple) { staples.add(n.name); continue; }
    if (pantry.has(n.name)) have.add(n.name);
    else missing.add(n.name);
  }
  const core = have.size + missing.size;
  const score = core === 0 ? 1 : have.size / core;
  return {
    recipe,
    have: [...have], missing: [...missing], staples: [...staples],
    score, canCook: missing.size === 0,
  };
}

/**
 * 全库匹配 + 排序:能做的优先 → 命中率高的优先 → 缺得少的优先 → 有库存料多的优先。
 * onlyWithPantry=true 时,至少命中 1 样非常备库存料才收(否则「全缺」的菜没意义)。
 */
export function matchRecipes<R extends RecipeLike>(
  recipes: readonly R[], pantry: Set<string>, normalize: Normalizer,
  opts: { onlyWithPantry?: boolean } = {},
): RecipeMatch<R>[] {
  const out: RecipeMatch<R>[] = [];
  for (const r of recipes) {
    const m = matchRecipe(r, pantry, normalize);
    if (opts.onlyWithPantry && m.have.length === 0) continue;
    out.push(m);
  }
  out.sort((a, b) =>
    (Number(b.canCook) - Number(a.canCook)) ||
    (b.score - a.score) ||
    (a.missing.length - b.missing.length) ||
    (b.have.length - a.have.length),
  );
  return out;
}
