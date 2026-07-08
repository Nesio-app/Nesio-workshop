/**
 * Notion 折叠映射（N-3）——「一本书 = 一条记忆，划线/笔记折进书里」。
 *
 * 用 N-2 的 classifyDatabase 结果,把 parent-child 子表的行按 relation 折叠进对应
 * hub/父行,产出一批「父记忆」(IngestNodeInput 形状):
 *   - hub/log/plain/kanban 的每一行 → 一条父记忆(经列去留的语义列进 attributes)
 *   - parent-child 子表的行 → 折进它 relation 指向的父记忆(成 attributes 里的折叠列表)
 *   - calendar-dim / dimension 整表丢;被判 drop 的列丢
 *
 * 幂等/镜像:每条父记忆带 notionPageId=父行 id(ingestLifeNode 据此 upsert);
 * 折叠列表每次同步从当前子行整体重建 —— 删掉一条划线,下次同步父记忆自动少一条(自愈)。
 */
import { classifyDatabase, type NotionSourceSchema, type SourceClassification } from './notion-classify';
import { notionPropText, type NotionProp } from './notion-map';

export interface NotionPageRow {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

export interface FoldedMemory {
  type: 'preference' | 'event';
  name: string;
  source: 'manual';
  confidence: number;
  rawInput: string;
  tags: string[];
  attributes: Record<string, string>;
  relations: never[];
}

const MAX_FOLD_PER_KEY = 40;  // 每条父记忆每类子表最多折进多少条
const FOLD_LINE_MAX = 160;    // 每条子摘要长度上限
const RESERVED_ATTR = new Set(['source', 'notionPageId', 'database', 'url', 'notionLastEdited', 'start']);

/** 折叠映射主函数(纯)。classification 缺省用 classifyDatabase(sources)。 */
export function foldSourcesToMemories(
  sources: NotionSourceSchema[],
  rowsBySourceId: Record<string, NotionPageRow[]>,
  classification: SourceClassification[] = classifyDatabase(sources),
): FoldedMemory[] {
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const keptCols = new Map<string, Set<string>>(
    classification.map((c) => [c.id, new Set(c.columns.filter((col) => col.keep).map((col) => col.name))]),
  );

  // 1) 父记忆:非丢弃、非子表的源,每行一条。key = 该行 page id。
  const parents = new Map<string, FoldedMemory>();
  for (const c of classification) {
    if (c.drop || c.role === 'parent-child') continue;
    const src = srcById.get(c.id);
    if (!src) continue;
    const kept = keptCols.get(c.id) ?? new Set<string>();
    for (const row of rowsBySourceId[c.id] || []) {
      const props = row.properties || {};
      let name = '';
      let dateVal = '';
      const attrs: Record<string, string> = { source: 'Notion', notionPageId: row.id, database: src.title };
      if (row.url) attrs.url = row.url;
      if (row.last_edited_time) attrs.notionLastEdited = row.last_edited_time;
      const tags = new Set<string>(['Notion', src.title]);
      for (const [key, value] of Object.entries(props)) {
        const p = value as NotionProp;
        const text = notionPropText(p);
        if (p?.type === 'title') { if (text) name = text; continue; }
        if (!kept.has(key) || !text) continue;
        if (p.type === 'select' || p.type === 'status') tags.add(text);
        else if (p.type === 'multi_select') text.split(', ').forEach((s) => s && tags.add(s));
        if (p.type === 'date' && !dateVal) dateVal = text;
        attrs[key] = text.slice(0, 300);
      }
      if (dateVal) attrs.start = dateVal;
      parents.set(row.id, {
        type: dateVal ? 'event' : 'preference',
        name: (name || src.title).slice(0, 80),
        source: 'manual',
        confidence: 0.85,
        rawInput: '',
        tags: Array.from(tags).slice(0, 12),
        attributes: attrs,
        relations: [],
      });
    }
  }

  // 2) 折叠子表:每张 parent-child 表的行,按其指向父的 relation 列折进对应父记忆。
  for (const c of classification) {
    if (c.role !== 'parent-child' || !c.foldInto) continue;
    const src = srcById.get(c.id);
    if (!src) continue;
    const relCol = src.properties.find((p) => p.type === 'relation' && p.relationTargetId === c.foldInto)?.name;
    if (!relCol) continue;
    const kept = keptCols.get(c.id) ?? new Set<string>();
    const foldKey = src.title; // 例:划线 / 笔记
    const bucket = new Map<string, string[]>(); // parentPageId -> 子摘要[]
    for (const row of rowsBySourceId[c.id] || []) {
      const props = row.properties || {};
      let title = '';
      const extras: string[] = [];
      for (const [key, value] of Object.entries(props)) {
        const p = value as NotionProp;
        const text = notionPropText(p);
        if (p?.type === 'title') { if (text) title = text; continue; }
        if (!kept.has(key) || !text || p.type === 'date') continue;
        extras.push(text);
      }
      const summary = [title, extras[0]].filter(Boolean).join(' · ').slice(0, FOLD_LINE_MAX);
      if (!summary) continue;
      const relProp = props[relCol] as { relation?: Array<{ id?: string }> } | undefined;
      const parentIds = Array.isArray(relProp?.relation)
        ? relProp!.relation.map((r) => r?.id).filter((x): x is string => Boolean(x))
        : [];
      for (const pid of parentIds) {
        if (!parents.has(pid)) continue;
        const arr = bucket.get(pid) || [];
        arr.push(summary);
        bucket.set(pid, arr);
      }
    }
    for (const [pid, list] of bucket) {
      const mem = parents.get(pid);
      if (!mem) continue;
      mem.attributes[foldKey] = list.slice(0, MAX_FOLD_PER_KEY).map((s, i) => `${i + 1}. ${s}`).join('\n');
      mem.attributes[`${foldKey}_count`] = String(list.length);
    }
  }

  // 3) rawInput 汇总(名字 + 前几个折叠/语义列),便于搜索与阅读。
  return Array.from(parents.values()).map((m) => {
    const parts = Object.keys(m.attributes)
      .filter((k) => !RESERVED_ATTR.has(k) && !k.endsWith('_count'))
      .slice(0, 3)
      .map((k) => m.attributes[k]);
    m.rawInput = [m.name, ...parts].filter(Boolean).join(' · ').slice(0, 400);
    return m;
  });
}
