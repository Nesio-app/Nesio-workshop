/**
 * recipe-generate — AI 生成菜谱的提示词与钳制(对标 eat-well / 食见)。
 * 输出钳成 food-data.Recipe 形状,可进 matchRecipe / RecipeBody。
 */

import type { Recipe } from '@/lib/cooking/food-data';
import type { Cuisine } from '@/lib/cooking/food-catalog';

export interface GeneratedRecipePayload {
  name?: unknown;
  ingredients?: unknown;
  steps?: unknown;
  cookingTime?: unknown;
  difficulty?: unknown;
  tips?: unknown;
  category?: unknown;
}

/** 把模型 JSON 钳成 Recipe;失败返回 null。 */
export function clampGeneratedRecipe(raw: unknown, cuisineName: string, fallbackIngredients: string[]): Recipe | null {
  const obj = (raw && typeof raw === 'object') ? raw as GeneratedRecipePayload : null;
  if (!obj) return null;
  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 40) : '';
  if (!name) return null;

  const ingredients: string[] = [];
  if (Array.isArray(obj.ingredients)) {
    for (const x of obj.ingredients) {
      const s = typeof x === 'string' ? x.trim().slice(0, 40) : '';
      if (s && !ingredients.includes(s)) ingredients.push(s);
      if (ingredients.length >= 24) break;
    }
  }
  if (!ingredients.length) ingredients.push(...fallbackIngredients.slice(0, 12));

  const steps: string[] = [];
  if (Array.isArray(obj.steps)) {
    for (const s of obj.steps) {
      if (typeof s === 'string') {
        const t = s.trim().slice(0, 240);
        if (t) steps.push(t);
      } else if (s && typeof s === 'object') {
        const d = (s as { description?: unknown }).description;
        const time = (s as { time?: unknown }).time;
        const temp = (s as { temperature?: unknown }).temperature;
        const desc = typeof d === 'string' ? d.trim() : '';
        if (!desc) continue;
        const bits = [
          desc,
          typeof time === 'number' ? `（约 ${time} 分钟）` : '',
          typeof temp === 'string' && temp.trim() ? ` · ${temp.trim()}` : '',
        ];
        steps.push(bits.join('').slice(0, 280));
      }
      if (steps.length >= 16) break;
    }
  }
  if (!steps.length) return null;

  const tips: string[] = [];
  if (Array.isArray(obj.tips)) {
    for (const t of obj.tips) {
      const s = typeof t === 'string' ? t.trim().slice(0, 120) : '';
      if (s) tips.push(s);
      if (tips.length >= 4) break;
    }
  }
  if (tips.length) {
    steps.push(`小贴士：${tips.join('；')}`);
  }

  const cookMin = Number(obj.cookingTime);
  const category = typeof obj.category === 'string' && obj.category.trim()
    ? obj.category.trim().slice(0, 24)
    : cuisineName;

  return {
    name,
    category,
    image: null,
    ingredients,
    ingredients_raw: ingredients.map((i) => i),
    steps,
    quantities: ingredients.map((item) => ({ amount: 0, unit: '', item })),
  };
}

export function buildRecipeGeneratePrompt(input: {
  cuisine: Cuisine;
  ingredients: string[];
  customPrompt?: string;
  locale?: string;
}): string {
  const isEn = (input.locale || 'zh').toLowerCase().startsWith('en');
  const list = input.ingredients.slice(0, 20).join(isEn ? ', ' : '、');
  const custom = (input.customPrompt || '').trim().slice(0, 200);

  if (isEn) {
    return `${input.cuisine.prompt}

User ingredients: ${list}
${custom ? `Special request: ${custom}\n` : ''}
Return ONLY JSON (no markdown):
{"name":"dish name in Chinese or English","ingredients":["..."],"steps":[{"step":1,"description":"...","time":5,"temperature":"medium"}],"cookingTime":30,"difficulty":"easy|medium|hard","tips":["..."],"category":"${input.cuisine.name}"}`;
  }

  return `${input.cuisine.prompt}

用户提供的食材：${list}
${custom ? `用户的特殊要求：${custom}\n` : ''}
请严格按下列 JSON 返回(不要 markdown、不要其它文字)：
{"name":"菜品名称","ingredients":["食材1"],"steps":[{"step":1,"description":"步骤描述","time":5,"temperature":"中火"}],"cookingTime":30,"difficulty":"easy|medium|hard","tips":["技巧"],"category":"${input.cuisine.name}"}`;
}
