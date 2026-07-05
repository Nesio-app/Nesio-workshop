/**
 * Notion database row → Life Graph node mapping (pure, unit-testable).
 * 批次 38:用户选定的数据库,每一行(row)存成一条记忆节点,字段(property)映射到
 * 属性/标签/日期。支持 Notion 常见 property 类型;未知类型静默跳过。
 */

export interface NotionProp {
  type?: string;
  [key: string]: unknown;
}

export interface NotionRow {
  id: string;
  url?: string;
  properties?: Record<string, unknown>;
}

export interface MappedNode {
  type: 'event' | 'preference';
  name: string;
  attributes: Record<string, string>;
  relations: Array<{ targetId: string; relation: string }>;
  tags: string[];
  confidence: number;
  rawInput: string;
}

function richText(arr: unknown): string {
  if (!Array.isArray(arr)) return '';
  return arr.map((r) => (r as { plain_text?: string })?.plain_text || '').join('');
}

/** Render a single Notion property to a flat display string. Empty string when blank. */
export function notionPropText(prop: NotionProp): string {
  const t = prop?.type;
  switch (t) {
    case 'title': return richText(prop.title);
    case 'rich_text': return richText(prop.rich_text);
    case 'select': return (prop.select as { name?: string })?.name || '';
    case 'status': return (prop.status as { name?: string })?.name || '';
    case 'multi_select': return ((prop.multi_select as Array<{ name?: string }>) || []).map((s) => s.name || '').filter(Boolean).join(', ');
    case 'number': return prop.number != null ? String(prop.number) : '';
    case 'checkbox': return prop.checkbox ? '是' : '否';
    case 'date': {
      const d = prop.date as { start?: string; end?: string } | null;
      if (!d?.start) return '';
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case 'url': return String(prop.url || '');
    case 'email': return String(prop.email || '');
    case 'phone_number': return String(prop.phone_number || '');
    case 'people': return ((prop.people as Array<{ name?: string }>) || []).map((p) => p.name || '').filter(Boolean).join(', ');
    case 'files': return ((prop.files as Array<{ name?: string }>) || []).map((f) => f.name || '').filter(Boolean).join(', ');
    case 'created_time': return String(prop.created_time || '');
    case 'last_edited_time': return String(prop.last_edited_time || '');
    case 'formula': {
      const f = prop.formula as { string?: string; number?: number; boolean?: boolean; date?: { start?: string } } | null;
      if (!f) return '';
      if (f.string) return f.string;
      if (f.number != null) return String(f.number);
      if (f.boolean != null) return f.boolean ? '是' : '否';
      return f.date?.start || '';
    }
    case 'rollup': {
      const r = prop.rollup as { number?: number; array?: unknown[] } | null;
      if (!r) return '';
      if (r.number != null) return String(r.number);
      return Array.isArray(r.array) ? `${r.array.length} 项` : '';
    }
    case 'relation': {
      const rel = prop.relation as unknown[] | undefined;
      return Array.isArray(rel) && rel.length ? `${rel.length} 个关联` : '';
    }
    case 'unique_id': {
      const u = prop.unique_id as { prefix?: string; number?: number } | null;
      return u?.number != null ? `${u.prefix ? `${u.prefix}-` : ''}${u.number}` : '';
    }
    default: return '';
  }
}

/** Extract the ISO date string from the first date-typed property, if any. */
function firstDate(props: Record<string, unknown>): string {
  for (const value of Object.values(props)) {
    const p = value as NotionProp;
    if (p?.type === 'date') {
      const d = p.date as { start?: string } | null;
      if (d?.start) return d.start;
    }
  }
  return '';
}

/** Convert one Notion database row into a Life Graph node. */
export function notionRowToNode(row: NotionRow, dbTitle: string): MappedNode {
  const props = row.properties || {};
  let name = '';
  const attributes: Record<string, string> = { source: 'Notion', database: dbTitle, notionPageId: row.id };
  if (row.url) attributes.url = row.url;
  const tags = new Set<string>(['Notion', dbTitle]);
  const rawParts: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    const p = value as NotionProp;
    const text = notionPropText(p);
    if (p?.type === 'title') { if (text) name = text; continue; }
    if (!text) continue;
    // select/status/multi_select 也进标签,便于按状态/分类检索
    if (p.type === 'select' || p.type === 'status') tags.add(text);
    else if (p.type === 'multi_select') text.split(', ').forEach((s) => s && tags.add(s));
    attributes[key] = text.slice(0, 300);
    rawParts.push(`${key}: ${text}`);
  }

  const dateVal = firstDate(props);
  if (dateVal) attributes.start = dateVal;

  return {
    // 有日期字段的行当作事件(能进时间线),否则当作偏好/记录
    type: dateVal ? 'event' : 'preference',
    name: (name || 'Untitled').slice(0, 80),
    attributes,
    relations: [],
    tags: Array.from(tags).slice(0, 12),
    confidence: 0.8,
    rawInput: rawParts.join(' · ').slice(0, 400),
  };
}

/** Pull a database's display title from a Notion database object. */
export function notionDbTitle(db: { title?: unknown }): string {
  return richText(db?.title) || 'Notion 表';
}
