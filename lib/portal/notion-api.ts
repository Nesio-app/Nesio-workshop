/**
 * Notion API 共享客户端（N-1:迁 2025-09-03 data source 新模型）。
 *
 * 背景:Notion 2025-09-03 重构数据模型,不向后兼容 ——
 *   数据库(database) → 一或多个数据源(data source) → 页面(page)。
 *   查询端点从 /v1/databases/{id}/query 迁到 /v1/data_sources/{data_source_id}/query,
 *   需先做一步 discovery 拿 data_source_id;一旦某库有第二个数据源,database_id 就不够精确。
 *
 * 本模块是 Notion 版本 + 端点的单一真源,routes 一律经此调用:
 *   - 版本头统一 NOTION_VERSION = '2025-09-03'
 *   - discoverDatabases():search 数据库并展开各自的 data_sources[]
 *   - primaryDataSourceId():解析主数据源 id(单源库取唯一;老库无 data_sources 回落 database_id)
 *   - queryDataSourceRows():优先 /data_sources/{id}/query,404 回落 /databases/{id}/query(兜底/老库)
 */
import { notionDbTitle } from './notion-map';
import type { NotionSourceSchema, NotionPropType } from './notion-classify';

export const NOTION_API = 'https://api.notion.com/v1';
/** 2025-09-03:data source 三级模型。改这里即全站切版本。 */
export const NOTION_VERSION = '2025-09-03';

export function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export interface NotionDataSource {
  id: string;
  name?: string;
}

export interface NotionDatabaseRef {
  databaseId: string;
  title: string;
  /** 2025-09-03:一个库可含多个数据源。老库/未迁移时为空数组。 */
  dataSources: NotionDataSource[];
}

interface NotionSearchDb {
  id: string;
  title?: unknown;
  data_sources?: Array<{ id?: string; name?: string }>;
}

/**
 * Discovery(2025-09-03):枚举 integration 可见的数据库,并展开各自的 data_sources[]。
 * 这一步取回并让上层存住 data_source_id,后续查询才精确。抛错交由 route 处理(区分 401/其它)。
 */
export async function discoverDatabases(token: string): Promise<{ ok: true; databases: NotionDatabaseRef[] } | { ok: false; status: number }> {
  const res = await fetch(`${NOTION_API}/search`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      filter: { property: 'object', value: 'database' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 50,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { results?: NotionSearchDb[] };
  const databases = (data.results || []).map((db) => ({
    databaseId: db.id,
    title: notionDbTitle(db),
    dataSources: Array.isArray(db.data_sources)
      ? db.data_sources.filter((d) => d?.id).map((d) => ({ id: d.id as string, name: d.name }))
      : [],
  }));
  return { ok: true, databases };
}

/**
 * 解析一个库的主数据源 id(2025-09-03)。
 * 单源库取唯一那个;老库/未迁移(无 data_sources)回落用 database_id —— queryDataSourceRows 会据此兜底。
 */
export function primaryDataSourceId(db: NotionDatabaseRef): string {
  return db.dataSources[0]?.id || db.databaseId;
}

/**
 * 取一个数据源的 schema(N-3 结构折叠用):列名 + 类型 + relation 目标。
 * GET /v1/data_sources/{id};404 回落 /v1/databases/{id}(老库)。取不到返回 null。
 * relation 目标读 relation.data_source_id(2025-09-03)或 database_id(老)。
 */
export async function getDataSourceSchema(token: string, sourceId: string): Promise<NotionSourceSchema | null> {
  const fetchObj = async (path: string): Promise<Record<string, unknown> | null> => {
    const res = await fetch(`${NOTION_API}/${path}/${sourceId}`, { headers: notionHeaders(token) });
    if (!res.ok) return res.status === 404 ? null : {};
    return (await res.json()) as Record<string, unknown>;
  };
  const obj = (await fetchObj('data_sources').catch(() => null)) || (await fetchObj('databases').catch(() => null));
  if (!obj) return null;
  const propsRaw = (obj.properties as Record<string, { type?: string; relation?: { data_source_id?: string; database_id?: string } }>) || {};
  const properties = Object.entries(propsRaw).map(([name, def]) => ({
    name,
    type: (def?.type || 'rich_text') as NotionPropType,
    ...(def?.type === 'relation'
      ? { relationTargetId: def.relation?.data_source_id || def.relation?.database_id || undefined }
      : {}),
  }));
  return { id: sourceId, title: (typeof obj.name === 'string' && obj.name) || notionDbTitle(obj as { title?: unknown }) || 'Notion 表', properties };
}

/**
 * 取一个数据源(或老库)的标题。优先 GET /v1/data_sources/{id};404 回落 GET /v1/databases/{id}。
 * data source 对象用 name 或 title 承载标题,老库用 title。取不到返回兜底名。
 */
export async function getSourceTitle(token: string, sourceId: string): Promise<string> {
  const tryGet = async (path: string): Promise<string | null> => {
    const res = await fetch(`${NOTION_API}/${path}/${sourceId}`, { headers: notionHeaders(token) });
    if (!res.ok) return res.status === 404 ? null : '';
    const obj = (await res.json()) as { name?: string; title?: unknown };
    return (typeof obj.name === 'string' && obj.name) || notionDbTitle(obj) || '';
  };
  const fromDs = await tryGet('data_sources').catch(() => '');
  if (fromDs) return fromDs;
  const fromDb = await tryGet('databases').catch(() => '');
  return fromDb || 'Notion 表';
}

export interface NotionRow {
  id: string;
  url?: string;
  /** 供 N-3 折叠 + 增量高水位。 */
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

/**
 * 查询一个数据源的行(2025-09-03)。
 * 优先 /v1/data_sources/{id}/query;若传入的 id 实为 database_id(兜底/老库/旧存选择),
 * data_sources 端点会 404 —— 回落 /v1/databases/{id}/query。两条都失败返回空数组(调用方兜底)。
 */
export async function queryDataSourceRows(token: string, sourceId: string, pageSize = 100): Promise<NotionRow[]> {
  const dsRes = await fetch(`${NOTION_API}/data_sources/${sourceId}/query`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({ page_size: pageSize }),
  });
  if (dsRes.ok) {
    const data = (await dsRes.json()) as { results?: NotionRow[] };
    return data.results || [];
  }
  // 兜底:传入的是 database_id(老库或旧存的选择),回落老端点。
  if (dsRes.status === 404) {
    const dbRes = await fetch(`${NOTION_API}/databases/${sourceId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ page_size: pageSize }),
    });
    if (dbRes.ok) {
      const data = (await dbRes.json()) as { results?: NotionRow[] };
      return data.results || [];
    }
  }
  return [];
}
