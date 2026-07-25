/**
 * food-catalog — 焊点装配层:把 eat-well 食材字典接成「标准名集合 + 快速添加分组 + 归一化器」,
 * 并暴露菜系风格库。数据本地打包(去了 emoji/tailwind),同步内存可用。
 *
 * 标准名 = eat-well ingredients.json 的 items(308 项)——这是全系统 join 的 key。
 * normalizeIngredient 绑定这份标准名集合;recipes/成分表/GI/库存/购物都经它对齐同一个 key。
 */
import ingredientGroupsRaw from './data/ingredients.json';
import cuisinesRaw from './data/cuisines.json';
import { classifyIngredient, isStaple, type NormalizedIngredient } from './ingredient-normalize';

export interface IngredientGroup { id: string; name: string; items: string[]; }
/** 快速添加食材选择器用的 9 类分组(图标由 UI 用设计系统线性图标,不来自数据)。 */
export const INGREDIENT_GROUPS: IngredientGroup[] = ingredientGroupsRaw as IngredientGroup[];

/** 全系统 join key:标准食材名集合。 */
export const STANDARD_NAMES: Set<string> = new Set(INGREDIENT_GROUPS.flatMap((g) => g.items));

export interface Cuisine { id: string; name: string; specialty: string; prompt: string; }
/** AI 生成菜谱的风格库(15 菜系;prompt 为中文风格提示词,美国版需改写英文)。 */
export const CUISINES: Cuisine[] = cuisinesRaw as Cuisine[];

/** 归一化一个原始食材词到标准名(+ 是否常备)。全系统统一入口。 */
export function normalizeIngredient(raw: string): NormalizedIngredient {
  return classifyIngredient(raw, STANDARD_NAMES);
}

export { isStaple };
export type { NormalizedIngredient };
