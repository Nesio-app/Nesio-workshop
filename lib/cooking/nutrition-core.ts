/**
 * nutrition-core — 营养**纯逻辑**(无 import,可 node 单测)。
 * 《中国食物成分表》查表 + 用量加法的确定性算术。坑按数据说明处理:
 *   - 值是字符串,`—`(未检)/`Tr`(微量)/空 → 当 0;其余 parseFloat,NaN → 0。
 *   - foodName 有「(代表值)/(说明)[别名]」变体 → 去括号取 base 便于匹配(匹配在 nutrition.ts)。
 * 全部标「估算」,不做假精确。
 */

export interface NutriPer100g { energyKCal: number; protein: number; fat: number; cho: number }
export interface NutriTotals { energyKCal: number; protein: number; fat: number; cho: number }

/** 解析成分表里的字符串值:—/Tr/空/非数 → 0;否则 parseFloat。 */
export function parseNutriValue(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).trim();
  if (s === '' || s === '—' || s === '-' || s === 'Tr' || s === 'tr') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** 去掉 foodName 里的 （…）(...)【…】[…] 注解/别名,取 base 名(用于匹配)。 */
export function stripFoodName(name: string): string {
  return (name || '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[（(【\[].*$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 用量加法:Σ(克/100 × 每100g各营养)。给 健康页/身体账本 求一餐营养用。 */
export function sumNutrition(entries: ReadonlyArray<{ grams: number; per100g: NutriPer100g }>): NutriTotals {
  const t: NutriTotals = { energyKCal: 0, protein: 0, fat: 0, cho: 0 };
  for (const e of entries) {
    const f = (e.grams || 0) / 100;
    t.energyKCal += (e.per100g.energyKCal || 0) * f;
    t.protein += (e.per100g.protein || 0) * f;
    t.fat += (e.per100g.fat || 0) * f;
    t.cho += (e.per100g.cho || 0) * f;
  }
  return { energyKCal: round1(t.energyKCal), protein: round1(t.protein), fat: round1(t.fat), cho: round1(t.cho) };
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
