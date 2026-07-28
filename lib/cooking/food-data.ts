/**
 * food-data — 大数据(菜谱)懒加载层。静态打包在 public/data/cooking,运行时 fetch + 内存缓存。
 * 营养/GI 也在同目录,留到 M2-e/健康页再接。
 */

export interface RecipeQuantity { amount: number; unit: string; item: string; }
export interface Recipe {
  name: string;
  category: string;
  image: string | null;
  ingredients: string[];       // 归一化前的配料名(展示/匹配都先过 normalize)
  ingredients_raw: string[];   // 带供应商/备注注解的原文
  steps: string[];
  quantities: RecipeQuantity[];// cooklikehoc=餐厅出餐量(展示克数前需缩放到家庭份);howtocook=每份家庭量
  source?: 'cooklikehoc' | 'howtocook';
  difficulty?: number;         // 1-5 星(howtocook 语料才有)
  calories?: number;           // 每份大卡预估(howtocook 语料才有)
}

let cache: Recipe[] | null = null;
let inflight: Promise<Recipe[]> | null = null;

/** 载入菜谱语料(336 老乡鸡 + 368 HowToCook 家常菜,scripts/import-howtocook.mjs 并入;缓存;失败抛错由调用方显式兜底)。 */
export async function loadRecipes(): Promise<Recipe[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch('/data/cooking/recipes.json', { cache: 'force-cache' })
      .then((res) => { if (!res.ok) throw new Error(`recipes_http_${res.status}`); return res.json(); })
      .then((data: { recipes?: Recipe[] }) => { cache = data.recipes ?? []; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** 菜谱配图 URL(中文文件名需编码);无图返回 ''。 */
export function recipeImageUrl(image: string | null): string {
  return image ? `/data/cooking/recipe-images/${encodeURIComponent(image)}` : '';
}
