/**
 * 实体解析(数据审计 #4:记忆是「半图」不是知识图谱 —— 关系 targetId 是名字字符串,
 * 同一实体跨记录不收敛,无别名归一)。这里提供两件事:
 *   ① 规范化 normalizeEntityKey —— 同一写法收敛(全角/半角、大小写、首尾引号、内部空白)。
 *   ② 用户可维护的别名表 —— 把「妈妈 / 母亲 / 妈」「Linda / linda@x.com」这类指向同一人的
 *      不同写法归并到一个规范键。
 * 供 buildRelationships 等**读时派生**用(把散落的提及收敛成一个联系人)。全本机、不上传。
 */

const ALIAS_KEY = 'nesio-entity-aliases-v1';
export const ENTITY_ALIASES_EVENT = 'nesio-entity-aliases-updated';

/**
 * 规范化实体键:NFKC(全角→半角、兼容字符归一)→ 去首尾引号/书名号 → 折叠内部空白 → 去首尾
 * 空白 → 小写。用于「同一写法收敛」(不含别名跳转)。
 */
export function normalizeEntityKey(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFKC').trim();
  s = s.replace(/^["'“”‘’「」『』《》]+/, '').replace(/["'“”‘’「」『』《》]+$/, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s.toLowerCase();
}

/** 别名表:aliasKey → canonicalKey(多对一)。 */
export function loadEntityAliases(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const v = JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch { return {}; }
}

/**
 * 解析到规范键:先规范化,再顺别名表跳到规范键(带环/深度保护)。无别名配置时 = 纯规范化,
 * 行为与旧的 `.trim().toLowerCase()` 一致(对 ASCII 名字/邮箱不变)。
 * 传入 aliases 复用(buildRelationships 一趟只加载一次,避免 O(n) 次 localStorage 读)。
 */
export function resolveEntityKey(raw: string, aliases: Record<string, string> = loadEntityAliases()): string {
  let key = normalizeEntityKey(raw);
  const seen = new Set<string>();
  while (aliases[key] && !seen.has(key)) { seen.add(key); key = aliases[key]; }
  return key;
}

/** 记「aliasRaw 与 canonicalRaw 是同一个人」。目标也解析到其规范键,避免形成别名链。 */
export function mergeEntity(aliasRaw: string, canonicalRaw: string): void {
  if (typeof window === 'undefined') return;
  const alias = normalizeEntityKey(aliasRaw);
  const canonical = resolveEntityKey(canonicalRaw);
  if (!alias || !canonical || alias === canonical) return;
  const map = loadEntityAliases();
  map[alias] = canonical;
  // 原本指向 alias 的别名改指 canonical(断链保护:合并 B→C 后,旧的 A→B 也顺延成 A→C)
  for (const k of Object.keys(map)) if (map[k] === alias) map[k] = canonical;
  try { localStorage.setItem(ALIAS_KEY, JSON.stringify(map)); } catch { /* 满了忽略,归并只是优化 */ }
  window.dispatchEvent(new CustomEvent(ENTITY_ALIASES_EVENT));
}

/** 撤销某个别名归并(把 aliasRaw 拆回独立实体)。 */
export function unmergeEntity(aliasRaw: string): void {
  if (typeof window === 'undefined') return;
  const alias = normalizeEntityKey(aliasRaw);
  const map = loadEntityAliases();
  if (!(alias in map)) return;
  delete map[alias];
  try { localStorage.setItem(ALIAS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(ENTITY_ALIASES_EVENT));
}
