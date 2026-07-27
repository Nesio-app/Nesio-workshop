/**
 * generated-recipes — AI 生成菜谱本机缓存(不进静态 recipes.json)。
 * 想做清单 / 详情可按名找回步骤。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import type { Recipe } from '@/lib/cooking/food-data';

const KEY = 'nesio-generated-recipes-v1';
export const GENERATED_RECIPES_EVENT = 'nesio-generated-recipes-updated';

const store = createBlobStore<Recipe[]>({
  key: KEY,
  updateEvent: GENERATED_RECIPES_EVENT,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function loadGeneratedRecipes(): Recipe[] {
  const raw = store.load();
  return Array.isArray(raw) ? raw : [];
}

export function saveGeneratedRecipe(recipe: Recipe): Recipe {
  const list = loadGeneratedRecipes().filter((r) => r.name !== recipe.name);
  list.unshift(recipe);
  store.save(list.slice(0, 40));
  return recipe;
}

export function findGeneratedRecipe(name: string): Recipe | null {
  const list = loadGeneratedRecipes();
  return list.find((r) => r.name === name)
    ?? list.find((r) => r.name.includes(name) || name.includes(r.name))
    ?? null;
}
