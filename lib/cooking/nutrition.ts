/**
 * nutrition — 营养查表 I/O 层。懒加载《中国食物成分表》(public/data/cooking/nutrition.json),
 * 建「去括号 base 名 + [别名]」索引,查表时经焊点 normalizeIngredient 对齐,优先「(代表值)」变体。
 * 部分食材名字对不齐(鸡胸肉↔鸡胸脯肉 等)→ 查不到就不显示,标「估算/部分」,不做假精确。
 */
import { normalizeIngredient } from './food-catalog';
import { parseNutriValue, stripFoodName, type NutriPer100g } from './nutrition-core';

interface RawFood { foodName: string; energyKCal: string; protein: string; fat: string; CHO: string }
export interface FoodNutrition extends NutriPer100g { foodName: string }

let index: Map<string, RawFood[]> | null = null;
let inflight: Promise<Map<string, RawFood[]>> | null = null;

function push(m: Map<string, RawFood[]>, k: string, f: RawFood) {
  if (!k) return;
  const a = m.get(k);
  if (a) a.push(f); else m.set(k, [f]);
}

async function buildIndex(): Promise<Map<string, RawFood[]>> {
  if (index) return index;
  if (!inflight) {
    inflight = fetch('/data/cooking/nutrition.json', { cache: 'force-cache' })
      .then((r) => { if (!r.ok) throw new Error(`nutrition_http_${r.status}`); return r.json(); })
      .then((data: { foods?: RawFood[] }) => {
        const m = new Map<string, RawFood[]>();
        for (const f of data.foods ?? []) {
          push(m, stripFoodName(f.foodName), f);
          const alias = f.foodName.match(/[[【]([^\]】]+)[\]】]/);   // [别名] 也作键(如 [西红柿]→番茄)
          if (alias) push(m, stripFoodName(alias[1]), f);
        }
        index = m;
        return m;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function pick(foods: RawFood[]): RawFood {
  return foods.find((f) => f.foodName.includes('代表值')) ?? foods[0];
}
function toNutri(f: RawFood): FoodNutrition {
  return { foodName: f.foodName, energyKCal: parseNutriValue(f.energyKCal), protein: parseNutriValue(f.protein), fat: parseNutriValue(f.fat), cho: parseNutriValue(f.CHO) };
}

/** 查一个食材的每100g营养(先归一化;去括号 base 精确匹配;优先代表值)。查不到返回 null。 */
export async function lookupNutrition(name: string): Promise<FoodNutrition | null> {
  const m = await buildIndex();
  const std = normalizeIngredient(name).name || name;
  const foods = m.get(stripFoodName(std)) ?? m.get(stripFoodName(name));
  return foods ? toNutri(pick(foods)) : null;
}

/** 一道菜的主料(非常备、去重)每100g营养 —— 匹配到的返回,标「估算」。 */
export async function recipeMainNutrition(ingredients: readonly string[]): Promise<FoodNutrition[]> {
  const m = await buildIndex();
  const out: FoodNutrition[] = [];
  const seen = new Set<string>();
  for (const raw of ingredients) {
    const n = normalizeIngredient(raw);
    if (!n.name || n.isStaple || seen.has(n.name)) continue;
    seen.add(n.name);
    const foods = m.get(stripFoodName(n.name));
    if (foods) out.push(toNutri(pick(foods)));
  }
  return out;
}
