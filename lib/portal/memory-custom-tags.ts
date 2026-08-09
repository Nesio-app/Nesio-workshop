/**
 * memory-custom-tags — 记忆页用户自定义标签注册表(2026-08-08)。
 *
 * 默认 8 个标签 + 用户自建,合并后供 MemoryTab 筛选与 MemoryNodeDetail 切换。
 * 全本机 durable,换端应一致。
 */

import { reportStorageDropped } from './storage-health';

export const MEMORY_CUSTOM_TAGS_KEY = 'nesio-memory-custom-tags-v1';
export const MEMORY_CUSTOM_TAGS_EVENT = 'nesio-memory-custom-tags-updated';

/** 内置默认标签(与用户最初点名的 8 个一致)。 */
export const DEFAULT_MEMORY_CUSTOM_TAGS = [
  '财务', '物品', '衣橱', '美食', '健康', '人物', '心情', '阅读',
] as const;

let cache: string[] | null = null;

function invalidateCache(): void {
  cache = null;
}

function mergeTags(userTags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...DEFAULT_MEMORY_CUSTOM_TAGS, ...userTags]) {
    const trimmed = String(t || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function readUserTagsRaw(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY_CUSTOM_TAGS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 合并默认 + 用户注册表,去重保序。 */
export function loadCustomMemoryTags(): string[] {
  if (typeof window === 'undefined') return [...DEFAULT_MEMORY_CUSTOM_TAGS];
  if (cache) return cache;
  cache = mergeTags(readUserTagsRaw());
  return cache;
}

function persistUserTags(userTags: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MEMORY_CUSTOM_TAGS_KEY, JSON.stringify(userTags));
  } catch {
    reportStorageDropped();
    return;
  }
  invalidateCache();
  window.dispatchEvent(new CustomEvent(MEMORY_CUSTOM_TAGS_EVENT));
}

/** 用户额外注册的标签(不含默认 8 个,用于持久化)。 */
export function loadUserMemoryTags(): string[] {
  const defaults = new Set<string>(DEFAULT_MEMORY_CUSTOM_TAGS);
  return readUserTagsRaw().filter((t) => !defaults.has(t));
}

export function isCustomMemoryTag(tag: string): boolean {
  const t = String(tag || '').trim();
  if (!t) return false;
  return loadCustomMemoryTags().includes(t);
}

/** 新建标签进注册表;已存在则 no-op。 */
export function addCustomMemoryTag(tag: string): string | null {
  const trimmed = String(tag || '').trim();
  if (!trimmed) return null;
  const merged = loadCustomMemoryTags();
  if (merged.includes(trimmed)) return trimmed;
  const defaults = new Set<string>(DEFAULT_MEMORY_CUSTOM_TAGS);
  const userOnly = readUserTagsRaw().filter((t) => !defaults.has(t));
  if (!defaults.has(trimmed)) userOnly.push(trimmed);
  persistUserTags(userOnly);
  return trimmed;
}

/** 从注册表移除用户自建标签(默认 8 个不可删)。 */
export function removeCustomMemoryTag(tag: string): boolean {
  const trimmed = String(tag || '').trim();
  if (!trimmed || (DEFAULT_MEMORY_CUSTOM_TAGS as readonly string[]).includes(trimmed)) return false;
  const defaults = new Set<string>(DEFAULT_MEMORY_CUSTOM_TAGS);
  const next = readUserTagsRaw().filter((t) => t !== trimmed && !defaults.has(t));
  if (next.length === readUserTagsRaw().filter((t) => !defaults.has(t)).length) return false;
  persistUserTags(next);
  return true;
}
