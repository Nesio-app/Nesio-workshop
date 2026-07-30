/**
 * Life Graph — local-first storage for LifeNodes.
 * Nodes are stored in localStorage under a single key.
 * This is the foundation for Reasoning Engine and Today Feed.
 */
import { mergeConflictingNodes } from './life-node-merge';
import { emailFulltextScore } from './email-fulltext-index';
import { tokenizeCJK } from './cjk-tokenize';
import { expandQueryTerms } from './query-synonyms';

export type LifeNodeType =
  | 'person'
  | 'object'
  | 'place' // 批次 174 退役:不再生产/不再进类型选择器,仅作墓碑保留(老节点仍能渲染 PlaceSection)。勿重新加进 TYPE_ORDER/ALL_TYPES。
  | 'event'
  | 'commitment'
  | 'health_state'
  | 'preference'
  | 'note';

export type LifeNodeSource = 'manual' | 'photo' | 'calendar' | 'email' | 'system' | 'voice';

export interface LifeNodeAsset {
  id: string;
  kind: 'image' | 'file' | 'audio' | 'text' | string;
  storagePath?: string;
  /** 批次 23:图存 IndexedDB 本机(getLocalImage(id)),未登录/离线也能看图 */
  local?: boolean;
  mimeType?: string;
  label?: string;
  analysisSummary?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LifeNode {
  id: string;
  type: LifeNodeType;
  name: string;
  attributes: Record<string, string | number | boolean | null>;
  source: LifeNodeSource;
  confidence: number; // 0-1
  createdAt: string; // ISO
  lastConfirmedAt?: string;
  relations: Array<{ targetId: string; relation: string }>;
  tags?: string[];
  rawInput?: string;
  assets?: LifeNodeAsset[];
}

export type CloudSyncStatus = 'pending' | 'synced' | 'failed';
export type CloudSyncOperation = 'upsert' | 'delete' | 'backfill';

export interface LifeGraphCloudSyncRecord {
  resourceId: string;
  operation: CloudSyncOperation;
  status: CloudSyncStatus;
  attempts: number;
  updatedAt: string;
  lastSyncedAt?: string;
  lastError?: string;
}

export interface LifeGraphCloudSyncOutboxItem {
  resourceId: string;
  operation: CloudSyncOperation;
  queuedAt: string;
  updatedAt: string;
  attempts: number;
  // 注意:不再持久化整条 node/assets —— 图谱(loadAll)才是权威源。
  // 旧版每条 pending 都存一份完整节点副本,未登录时永不同步 → outbox 在
  // localStorage 里堆成第二份完整图谱,直接顶爆 ~5MB 配额。retry 时按 id 从
  // 图谱取回即可(与 backfill 一致)。
}

/**
 * 批量导入的节点(通讯录、系统生成的报告等)不代表用户亲手记下的生活 ——
 * 洞察统计与多面镜证据一律剔除,否则"镜子读到的是通讯录不是用户"(v1 规格 §2.3)。
 */
export function isBulkImported(node: LifeNode): boolean {
  if (node.source === 'system') return true;
  if (node.attributes?.contactSource) return true;
  return (node.tags || []).includes('联系人');
}

const STORAGE_KEY = 'nesio-life-graph-v1';
const CLOUD_SYNC_STATUS_KEY = 'nesio-life-graph-cloud-sync-v1';
const CLOUD_SYNC_OUTBOX_KEY = 'nesio-life-graph-cloud-sync-outbox-v1';
const PRIVATE_EXTERNAL_SOURCES = new Set<LifeNodeSource>(['calendar', 'email']);
const PRIVATE_EXTERNAL_ATTRIBUTE_KEYS = new Set([
  'calendarId',
  'calendarName',
  'calendarHtmlLink',
  'emailId',
  'messageId',
  'threadId',
  'gmailId',
  'htmlLink',
  'eventId',
  'externalId',
  'icalUid',
  'organizerEmail',
  'attendees',
  'attendeeEmails',
]);
const RECEIPT_SOURCES = new Set<LifeNodeSource>(['manual', 'photo', 'voice']);
const CLOUD_MEMORY_ENDPOINT = '/api/cloud/memory';
const CLOUD_SIGNALS_ENDPOINT = '/api/cloud/signals';
const LIFE_NODE_TYPES = new Set<LifeNodeType>([
  'person',
  'object',
  'place',
  'event',
  'commitment',
  'health_state',
  'preference',
  'note',
]);
const LIFE_NODE_SOURCES = new Set<LifeNodeSource>(['manual', 'photo', 'calendar', 'email', 'system', 'voice']);

function cloudMemorySyncEnabled(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

function cloudSignalsSyncEnabled(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

function lifeNodeSourceToSignalSource(source: LifeNodeSource): string {
  if (source === 'email') return 'gmail';
  if (source === 'system') return 'device';
  return source;
}

function lifeNodeTypeToSignalType(type: LifeNodeType): string {
  if (type === 'health_state') return 'symptom';
  if (type === 'place') return 'location';
  if (type === 'object' || type === 'person' || type === 'preference') return 'observation';
  return type;
}

function inferLifeNodeSignalRetention(node: LifeNode): string {
  const tags = (node.tags || []).join(' ').toLowerCase();
  if (node.type === 'person' || tags.includes('family') || tags.includes('家庭')) return 'AlwaysAlive';
  if (node.type === 'preference' || tags.includes('learning') || tags.includes('读书')) return 'LongLiving';
  if (tags.includes('weather') || tags.includes('天气')) return 'Disposable';
  return 'Normal';
}

function inferLifeNodeSignalSensitivity(node: LifeNode): string {
  const tags = (node.tags || []).join(' ').toLowerCase();
  if (node.type === 'health_state' || tags.includes('health') || tags.includes('健康')) return 'health';
  if (tags.includes('finance') || tags.includes('财务')) return 'financial';
  if (tags.includes('family') || tags.includes('家庭')) return 'family';
  if (node.source === 'calendar' || tags.includes('work') || tags.includes('工作') || tags.includes('会议')) return 'work';
  return 'normal';
}

function lifeNodeToCloudSignal(node: LifeNode) {
  const signalSource = lifeNodeSourceToSignalSource(node.source);
  const occurredAt =
    (typeof node.attributes.start === 'string' && node.attributes.start) ||
    (typeof node.attributes.date === 'string' && node.attributes.date) ||
    node.createdAt;
  return {
    id: typeof node.attributes.signalId === 'string' ? node.attributes.signalId : `sig_${node.id}`,
    source: signalSource,
    type: typeof node.attributes.signalType === 'string' ? node.attributes.signalType : lifeNodeTypeToSignalType(node.type),
    occurredAt,
    capturedAt: node.createdAt,
    title: node.name,
    payload: Object.fromEntries(
      Object.entries(node.attributes).filter(([key]) => !key.startsWith('signal')),
    ),
    entities: node.relations.map((relation) => ({
      id: relation.targetId,
      type: relation.relation,
      name: relation.targetId,
    })),
    confidence: node.confidence,
    sensitivity: inferLifeNodeSignalSensitivity(node),
    retentionPolicy: inferLifeNodeSignalRetention(node),
    evidence: { source: signalSource, externalId: node.id, raw: node.rawInput || '' },
    tags: node.tags || [],
  };
}

function syncLifeNodeSignalToCloud(node: LifeNode): void {
  if (!cloudSignalsSyncEnabled()) return;
  fetch(CLOUD_SIGNALS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals: [lifeNodeToCloudSignal(node)] }),
    credentials: 'same-origin',
  }).catch(() => {
    /* Cloud Signal mirror is best-effort; local Memory remains usable offline. */
  });
}

function cloudSyncRecordKey(resourceId: string, operation: CloudSyncOperation): string {
  return `${operation}:${resourceId}`;
}

// ── 同步表迁 IndexedDB(批次 52「全迁出」)────────────────────────────────
// outbox/状态记录按节点累积(数百条),与图谱主存同因同治:同步内存缓存承接
// 同步读写,IDB 持久,首次水合把旧 localStorage 搬进 IDB 并删原 key。
// 会话内已写(dirty)时与旧 IDB 按 key 合并,新 updatedAt 胜 —— 加安全,不丢标记。
function createIdbSyncMap<T extends { updatedAt: string }>(opts: {
  key: string;
  parse: (raw: string) => Map<string, T>;
  event?: string;
}): { load(): Map<string, T>; save(m: Map<string, T>): void } {
  let cache: Map<string, T> | null = null;
  let hydrated = false;
  let dirty = false;
  const seed = (): Map<string, T> => {
    try {
      const raw = localStorage.getItem(opts.key);
      return raw ? opts.parse(raw) : new Map();
    } catch { return new Map(); }
  };
  const persist = (m: Map<string, T>): void => {
    import('./idb-blob-store').then(({ idbBackend }) => {
      idbBackend.set(opts.key, JSON.stringify(Array.from(m.values()))).catch(() => { /* 诊断数据,尽力而为 */ });
    }).catch(() => {});
  };
  const emit = (): void => {
    if (opts.event) window.dispatchEvent(new CustomEvent(opts.event));
  };
  const hydrateOnce = (): void => {
    if (hydrated || typeof window === 'undefined') return;
    hydrated = true;
    import('./idb-blob-store').then(async (mod) => {
      mod.registerIdbBlobKey(opts.key);
      try {
        const raw = await mod.idbBackend.get(opts.key);
        const idbMap = raw ? opts.parse(raw) : null;
        const cur = cache ?? seed();
        if (dirty) {
          const merged = new Map(idbMap ?? []);
          for (const [k, v] of cur) {
            const prev = merged.get(k);
            if (!prev || String(v.updatedAt) >= String(prev.updatedAt)) merged.set(k, v);
          }
          cache = merged;
          persist(merged);
        } else if (idbMap && idbMap.size) {
          cache = idbMap;
        } else {
          if (cur.size) persist(cur); // 首次迁移 localStorage → IDB
          cache = cur;
        }
        try { localStorage.removeItem(opts.key); } catch { /* ignore */ }
        emit();
      } catch { /* 水合失败:保持种子,不删 localStorage,下次重试 */ }
    }).catch(() => {});
  };
  return {
    load(): Map<string, T> {
      if (typeof window === 'undefined') return new Map();
      if (cache == null) { cache = seed(); hydrateOnce(); }
      return cache;
    },
    save(m: Map<string, T>): void {
      if (typeof window === 'undefined') return;
      cache = m;
      dirty = true;
      if (hydrated) persist(m); else hydrateOnce();
      emit();
    },
  };
}

function parseOutboxRaw(raw: string): Map<string, LifeGraphCloudSyncOutboxItem> {
  const items = JSON.parse(raw) as Array<LifeGraphCloudSyncOutboxItem & { node?: unknown; assets?: unknown }>;
  if (!Array.isArray(items)) return new Map();
  return new Map(
    items
      .filter((item) => item?.resourceId && item?.operation)
      // 只保留瘦身字段;旧版遗留的 node/assets 在此丢弃(下次 save 落盘即瘦身)
      .map((item) => [
        cloudSyncRecordKey(item.resourceId, item.operation),
        {
          resourceId: item.resourceId,
          operation: item.operation,
          queuedAt: item.queuedAt || item.updatedAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
          attempts: typeof item.attempts === 'number' ? item.attempts : 0,
        } satisfies LifeGraphCloudSyncOutboxItem,
      ]),
  );
}

const outboxSyncMap = createIdbSyncMap<LifeGraphCloudSyncOutboxItem>({
  key: CLOUD_SYNC_OUTBOX_KEY,
  parse: parseOutboxRaw,
});

function loadCloudSyncOutboxMap(): Map<string, LifeGraphCloudSyncOutboxItem> {
  return outboxSyncMap.load();
}

/**
 * 一次性把旧版「胖 outbox」(每条含整节点副本)重写成瘦身版,立刻回收 localStorage。
 * 未登录设备上这份重复图谱是配额顶爆的主因;开机即压缩,给存储解压。
 */
let outboxCompacted = false;
function compactCloudSyncOutboxOnce(): void {
  if (outboxCompacted || typeof window === 'undefined') return;
  outboxCompacted = true;
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_OUTBOX_KEY);
    if (raw && (raw.includes('"node"') || raw.includes('"assets"'))) {
      saveCloudSyncOutboxMap(loadCloudSyncOutboxMap());
    }
  } catch {
    /* best-effort */
  }
}

function saveCloudSyncOutboxMap(items: Map<string, LifeGraphCloudSyncOutboxItem>): void {
  outboxSyncMap.save(items);
}

function queueCloudSyncOutboxItem(
  resource: LifeNode | string,
  operation: CloudSyncOperation,
): void {
  const resourceId = typeof resource === 'string' ? resource : resource.id;
  const items = loadCloudSyncOutboxMap();
  const key = cloudSyncRecordKey(resourceId, operation);
  const current = items.get(key);
  const now = new Date().toISOString();
  // 只记 id/operation/计数 —— 待发的节点内容 retry 时从权威图谱按 id 取回。
  items.set(key, {
    resourceId,
    operation,
    queuedAt: current?.queuedAt || now,
    updatedAt: now,
    attempts: current?.attempts || 0,
  });
  saveCloudSyncOutboxMap(items);
}

/**
 * 批量版:一次读、全部改、一次写。
 * 逐条版在 N 条循环里各自「读整张表 → 改一格 → 写回整张表」,是 O(N²) 的序列化;
 * 回填 200 条时四个阶段合计约 800 次全表读写 —— 打开记忆页卡顿的真实来源之一。
 */
function queueCloudSyncOutboxItems(resourceIds: readonly string[], operation: CloudSyncOperation): void {
  if (!resourceIds.length) return;
  const items = loadCloudSyncOutboxMap();
  const now = new Date().toISOString();
  for (const resourceId of resourceIds) {
    const key = cloudSyncRecordKey(resourceId, operation);
    const current = items.get(key);
    items.set(key, {
      resourceId,
      operation,
      queuedAt: current?.queuedAt || now,
      updatedAt: now,
      attempts: current?.attempts || 0,
    });
  }
  saveCloudSyncOutboxMap(items);
}

/** 批量记一次投递尝试(同上,一次读写)。 */
function updateCloudSyncOutboxAttempts(resourceIds: readonly string[], operation: CloudSyncOperation): void {
  if (!resourceIds.length) return;
  const items = loadCloudSyncOutboxMap();
  const now = new Date().toISOString();
  for (const resourceId of resourceIds) {
    const key = cloudSyncRecordKey(resourceId, operation);
    const current = items.get(key);
    if (!current) continue;
    items.set(key, { ...current, updatedAt: now, attempts: current.attempts + 1 });
  }
  saveCloudSyncOutboxMap(items);
}

/** 批量出队(成功后清理)。 */
function removeCloudSyncOutboxItems(resourceIds: readonly string[], operation: CloudSyncOperation): void {
  if (!resourceIds.length) return;
  const items = loadCloudSyncOutboxMap();
  for (const resourceId of resourceIds) items.delete(cloudSyncRecordKey(resourceId, operation));
  saveCloudSyncOutboxMap(items);
}

function updateCloudSyncOutboxAttempt(resourceId: string, operation: CloudSyncOperation): void {
  const items = loadCloudSyncOutboxMap();
  const key = cloudSyncRecordKey(resourceId, operation);
  const current = items.get(key);
  if (!current) return;
  items.set(key, {
    ...current,
    updatedAt: new Date().toISOString(),
    attempts: current.attempts + 1,
  });
  saveCloudSyncOutboxMap(items);
}

function removeCloudSyncOutboxItem(resourceId: string, operation: CloudSyncOperation): void {
  const items = loadCloudSyncOutboxMap();
  items.delete(cloudSyncRecordKey(resourceId, operation));
  saveCloudSyncOutboxMap(items);
}

function parseSyncRecordsRaw(raw: string): Map<string, LifeGraphCloudSyncRecord> {
  const records = JSON.parse(raw) as LifeGraphCloudSyncRecord[];
  if (!Array.isArray(records)) return new Map();
  return new Map(
    records
      .filter((record) => record?.resourceId && record?.operation && record?.status)
      .map((record) => [cloudSyncRecordKey(record.resourceId, record.operation), record]),
  );
}

const recordSyncMap = createIdbSyncMap<LifeGraphCloudSyncRecord>({
  key: CLOUD_SYNC_STATUS_KEY,
  parse: parseSyncRecordsRaw,
  event: 'nesio-life-graph-cloud-sync-updated',
});

function loadCloudSyncRecordMap(): Map<string, LifeGraphCloudSyncRecord> {
  return recordSyncMap.load();
}

function saveCloudSyncRecordMap(records: Map<string, LifeGraphCloudSyncRecord>): void {
  recordSyncMap.save(records);
}

function cloudSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'cloud_memory_sync_failed';
}

/** 批量标待发 / 已同步 / 失败:同样一次读写(见 queueCloudSyncOutboxItems 的说明)。 */
function markCloudSyncMany(
  resourceIds: readonly string[],
  operation: CloudSyncOperation,
  status: 'pending' | 'synced' | 'failed',
  error?: unknown,
): void {
  if (!resourceIds.length) return;
  const records = loadCloudSyncRecordMap();
  const now = new Date().toISOString();
  for (const resourceId of resourceIds) {
    const key = cloudSyncRecordKey(resourceId, operation);
    const current = records.get(key);
    records.set(key, {
      resourceId,
      operation,
      status,
      attempts: status === 'pending' ? (current?.attempts || 0) + 1 : (current?.attempts || 1),
      updatedAt: now,
      lastSyncedAt: status === 'synced' ? now : current?.lastSyncedAt,
      ...(status === 'failed' ? { lastError: cloudSyncErrorMessage(error) } : {}),
    });
  }
  saveCloudSyncRecordMap(records);
}

function markCloudSyncPending(resourceId: string, operation: CloudSyncOperation): void {
  const records = loadCloudSyncRecordMap();
  const key = cloudSyncRecordKey(resourceId, operation);
  const current = records.get(key);
  records.set(key, {
    resourceId,
    operation,
    status: 'pending',
    attempts: (current?.attempts || 0) + 1,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: current?.lastSyncedAt,
  });
  saveCloudSyncRecordMap(records);
}

function markCloudSyncSynced(resourceId: string, operation: CloudSyncOperation): void {
  const records = loadCloudSyncRecordMap();
  const key = cloudSyncRecordKey(resourceId, operation);
  const current = records.get(key);
  const now = new Date().toISOString();
  records.set(key, {
    resourceId,
    operation,
    status: 'synced',
    attempts: current?.attempts || 1,
    updatedAt: now,
    lastSyncedAt: now,
  });
  saveCloudSyncRecordMap(records);
}

function markCloudSyncFailed(resourceId: string, operation: CloudSyncOperation, error: unknown): void {
  const records = loadCloudSyncRecordMap();
  const key = cloudSyncRecordKey(resourceId, operation);
  const current = records.get(key);
  records.set(key, {
    resourceId,
    operation,
    status: 'failed',
    attempts: current?.attempts || 1,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: current?.lastSyncedAt,
    lastError: cloudSyncErrorMessage(error),
  });
  saveCloudSyncRecordMap(records);
}

export function getLifeGraphCloudSyncRecords(): LifeGraphCloudSyncRecord[] {
  return Array.from(loadCloudSyncRecordMap().values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function getLifeGraphCloudSyncSummary(): {
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  notConfiguredCount: number;
  lastUpdatedAt: string | null;
} {
  compactCloudSyncOutboxOnce(); // Memory 页挂载即回收旧胖 outbox 的 localStorage
  const records = getLifeGraphCloudSyncRecords();
  const NOT_CONFIGURED_ERRORS = new Set(['cloud_not_configured', 'cloud_memory_sync_failed', 'cloud_memory_network_error']);
  const notConfigured = records.filter(
    (r) => r.status === 'failed' && NOT_CONFIGURED_ERRORS.has(r.lastError ?? ''),
  );
  const genuineFailed = records.filter(
    (r) => r.status === 'failed' && !NOT_CONFIGURED_ERRORS.has(r.lastError ?? ''),
  );
  return {
    pendingCount: records.filter((record) => record.status === 'pending').length,
    syncedCount: records.filter((record) => record.status === 'synced').length,
    failedCount: genuineFailed.length,
    notConfiguredCount: notConfigured.length,
    lastUpdatedAt: records[0]?.updatedAt || null,
  };
}

// Errors that mean "cloud not ready yet" — don't mark as failed, just skip silently
const CLOUD_TRANSIENT_ERRORS = new Set(['cloud_not_configured', 'not_signed_in', 'cloud_not_available']);

async function cloudFetchWithSmartError(
  input: RequestInfo,
  init: RequestInit,
): Promise<{ ok: boolean; transient: boolean; error?: string }> {
  try {
    const response = await fetch(input, init);
    if (response.ok) return { ok: true, transient: false };
    // Parse the body to distinguish transient vs real failures
    let errorCode = 'cloud_memory_sync_failed';
    try {
      const body = await response.clone().json() as { error?: string };
      if (body.error) errorCode = body.error;
    } catch { /* ignore parse error */ }
    const transient = CLOUD_TRANSIENT_ERRORS.has(errorCode) || response.status === 503 || response.status === 401;
    return { ok: false, transient, error: errorCode };
  } catch {
    // 网络错(断网/超时)是**暂时**的:标 failed 会把它踢出重试队列、还刷屏报错。
    // 归 transient → 留在 pending,等退避窗口到了再试。
    return { ok: false, transient: true, error: 'cloud_memory_network_error' };
  }
}

/** 指数退避:第 N 次尝试后至少等 min(30s × 2^N, 6h) 再重试。 */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 6 * 3_600_000;
/** 单轮重试条数上限 —— 此前无上限,离线时会顺序发几百个注定失败的请求。 */
const RETRY_BATCH_CAP = 25;

export function retryBackoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * Math.pow(2, Math.max(0, attempts)), RETRY_MAX_MS);
}

/** 到点了吗?(attempts 越多等越久;没有 updatedAt 的老记录立即可试) */
export function isRetryDue(record: { attempts?: number; updatedAt?: string }, now = Date.now()): boolean {
  if (!record.updatedAt) return true;
  const last = Date.parse(record.updatedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= retryBackoffMs(record.attempts || 0);
}

async function syncLifeGraphUpsertToCloud(node: LifeNode): Promise<void> {
  if (!cloudMemorySyncEnabled()) return;
  queueCloudSyncOutboxItem(node, 'upsert');
  markCloudSyncPending(node.id, 'upsert');
  updateCloudSyncOutboxAttempt(node.id, 'upsert');
  const result = await cloudFetchWithSmartError(CLOUD_MEMORY_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: [node], assets: [] }),
  });
  if (result.ok) {
    markCloudSyncSynced(node.id, 'upsert');
    removeCloudSyncOutboxItem(node.id, 'upsert');
  } else if (!result.transient) {
    markCloudSyncFailed(node.id, 'upsert', new Error(result.error));
  }
  // transient (not configured / not signed in) → leave as pending, retry later
}

async function syncLifeGraphDeleteToCloud(id: string): Promise<void> {
  if (!cloudMemorySyncEnabled()) return;
  queueCloudSyncOutboxItem(id, 'delete');
  markCloudSyncPending(id, 'delete');
  updateCloudSyncOutboxAttempt(id, 'delete');
  const result = await cloudFetchWithSmartError(CLOUD_MEMORY_ENDPOINT, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: id }),
  });
  if (result.ok) {
    markCloudSyncSynced(id, 'delete');
    removeCloudSyncOutboxItem(id, 'delete');
  } else if (!result.transient) {
    markCloudSyncFailed(id, 'delete', new Error(result.error));
  }
}

export async function retryLifeGraphCloudSync(): Promise<{
  retriedCount: number;
  succeededCount: number;
  failedCount: number;
}> {
  if (!cloudMemorySyncEnabled()) return { retriedCount: 0, succeededCount: 0, failedCount: 0 };

  // 退避 + 限量:离线时此前会顺序发几百个注定失败的请求(控制台刷屏 + 白耗主线程)。
  // 现在只取「退避窗口已到」的前 N 条,重试次数越多等得越久。
  const now = Date.now();
  const retryRecords = getLifeGraphCloudSyncRecords().filter((record) => record.status === 'pending' || record.status === 'failed')
    .filter((record) => isRetryDue(record, now))
    .slice(0, RETRY_BATCH_CAP);
  const outboxItemsByKey = loadCloudSyncOutboxMap();
  // 权威源:待发的节点内容从图谱按 id 取回(outbox 只留 id,不再存副本)
  const graphById = new Map(loadAll().map((n) => [n.id, n]));
  let retriedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  for (const record of retryRecords) {
    const item = outboxItemsByKey.get(cloudSyncRecordKey(record.resourceId, record.operation));
    if (!item) continue;
    retriedCount += 1;
    markCloudSyncPending(item.resourceId, item.operation);
    updateCloudSyncOutboxAttempt(item.resourceId, item.operation);
    let result: { ok: boolean; transient: boolean; error?: string };
    if (item.operation === 'upsert' || item.operation === 'backfill') {
      const node = graphById.get(item.resourceId);
      if (!node) {
        // 节点已被删除 —— 无内容可发,清出 outbox,不算失败
        removeCloudSyncOutboxItem(item.resourceId, item.operation);
        markCloudSyncSynced(item.resourceId, item.operation);
        retriedCount -= 1;
        continue;
      }
      const assets = (node.assets || []).map((asset) => ({ ...asset, nodeId: node.id }));
      result = await cloudFetchWithSmartError(CLOUD_MEMORY_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [node], assets }),
      });
    } else if (item.operation === 'delete') {
      result = await cloudFetchWithSmartError(CLOUD_MEMORY_ENDPOINT, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: item.resourceId }),
      });
    } else {
      result = { ok: false, transient: false, error: 'cloud_memory_sync_payload_missing' };
    }
    if (result.ok) {
      markCloudSyncSynced(item.resourceId, item.operation);
      removeCloudSyncOutboxItem(item.resourceId, item.operation);
      succeededCount += 1;
    } else if (result.transient) {
      // not configured / not signed in — leave as pending, don't count as failure
      markCloudSyncPending(item.resourceId, item.operation);
    } else {
      markCloudSyncFailed(item.resourceId, item.operation, new Error(result.error));
      failedCount += 1;
    }
  }

  return { retriedCount, succeededCount, failedCount };
}

// ── 主存储迁 IndexedDB ──────────────────────────────────────────────────
// localStorage ~5MB 全 origin 共享上限对记忆图谱太小(用户实测 761 条就撑爆);
// IDB 可用设备存储的很大一部分(上百 G)。为保持「同步读」(getLifeGraph 首屏即读),
// 用会话内存缓存:首次同步从 localStorage 播种(迁移源 + 消除水合空窗),IDB 异步
// 水合。安全保证:① 当前有数据的设备,首访 memCache 同步拿到全量,迁移与读写全程
// 有据,零丢失;② 已迁设备(localStorage 空),水合前 memCache 为空 → 期间无真删
// 可能(列表为空删不了具体节点),写入用 union 与旧 IDB 合并(加安全、删不复活);
// 水合完成派发 updated 让界面补齐。
let memCache: LifeNode[] | null = null;
let memDirty = false;
let graphHydrated = false;

function seedFromLocalStorage(): LifeNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function unionNodesById(a: LifeNode[], b: LifeNode[]): LifeNode[] {
  const byId = new Map<string, LifeNode>();
  const stamp = (n: LifeNode) => String((n.attributes?.updatedAt as string) || n.createdAt || '');
  for (const n of [...a, ...b]) {
    if (!n?.id) continue;
    const prev = byId.get(n.id);
    if (!prev || stamp(n) >= stamp(prev)) byId.set(n.id, n);
  }
  return Array.from(byId.values());
}

// 落盘合并窗:每次写图都同步 JSON.stringify 全图(2328 节点)是速记提交冻结的主因之一。
// 400ms 内的连续写只落一次(取最后一份);pagehide 时强制冲刷,快速关页不丢。
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending: LifeNode[] | null = null;

// 上次落盘时每片的 JSON(会话内)。写的时候只落**变了的片** —— 改一条今年的记忆
// 不再重写历史几年的数据。空 Map = 下次全量重写(首次/迁移后)。
let lastShardJson = new Map<string, string>();

function flushPersistNow(): void {
  if (persistTimer != null) { clearTimeout(persistTimer); persistTimer = null; }
  const nodes = persistPending;
  persistPending = null;
  if (!nodes) return;
  void (async () => {
    try {
      const [{ idbBackend }, shards] = await Promise.all([
        import('./idb-blob-store'),
        import('./life-graph-shards'),
      ]);
      if (!idbBackend) return;
      const res = await shards.writeGraphShards(idbBackend, nodes, lastShardJson);
      lastShardJson = res.nextJson;
    } catch {
      // 写盘失败必须可见(红线:不许吞掉会丢数据的存储写失败)。
      // 同时把分片缓存清空 —— 下次写全量重来,免得「以为写过了」而跳过某片。
      lastShardJson = new Map();
      import('./storage-health').then(({ STORAGE_FULL_EVENT, getStorageHealth }) => {
        window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: getStorageHealth() }));
      }).catch(() => {});
    }
  })();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPersistNow);
}

function persistGraphToIdb(nodes: LifeNode[]): void {
  persistPending = nodes;
  if (persistTimer != null) return; // 已有窗口:只更新待写快照
  persistTimer = setTimeout(() => { persistTimer = null; flushPersistNow(); }, 400);
}

function hydrateGraphOnce(): void {
  if (graphHydrated || typeof window === 'undefined') return;
  graphHydrated = true; // 立即置位防重入;异步内校正 memCache
  import('./idb-blob-store').then(async (mod) => {
    const { idbBackend } = mod;
    mod.registerIdbBlobKey?.(STORAGE_KEY); // 让备份/恢复/清理把图谱当 IDB blob
    try {
      const shards = await import('./life-graph-shards');
      mod.registerIdbBlobKey?.(shards.GRAPH_SHARD_INDEX_KEY);
      // 旧的单 blob → 分片。先写后验再删:对不上就保留旧 blob,下次重来(见该模块注释)。
      await shards.migrateLegacyBlobToShards(idbBackend, STORAGE_KEY).catch(() => null);

      const read = await shards.readGraphShards(idbBackend);

      // ⚠️ 有片没读出来:这时 read.nodes **不是全量**。什么都别做 ——
      // 不覆盖 memCache(界面会突然空掉)、不回写(会把没读出来的片抹掉)。
      // 放开 graphHydrated 让下次读写再试一次;分片写缓存作废,免得基于半张图做增量。
      if (read && !read.complete) {
        lastShardJson = new Map();
        graphHydrated = false;
        import('./storage-health').then(({ logDropped }) => logDropped('graph.shard_read_incomplete', new Error('partial shard read'))).catch(() => {});
        return;
      }
      if (read?.shards?.length) {
        for (const sh of read.shards) mod.registerIdbBlobKey?.(shards.shardStorageKey(sh));
      }

      const idbNodes = read ? read.nodes : null;
      const seed = memCache ?? seedFromLocalStorage();
      if (memDirty) {
        // 本会话已写:memCache 最新,与旧 IDB union(补 IDB 独有,不复活已删)后回写
        const merged = Array.isArray(idbNodes) ? unionNodesById(seed, idbNodes) : seed;
        memCache = merged;
        persistGraphToIdb(merged);
      } else if (Array.isArray(idbNodes) && idbNodes.length) {
        memCache = idbNodes; // 未写过 + IDB 有数据:IDB 权威
      } else {
        if (seed.length) persistGraphToIdb(seed); // IDB 空:首次迁移 localStorage → 分片
        memCache = seed;
      }
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      // R1 存量修复:把「targetId 存的是人名」那类悬空关联就地修好。
      // 只在真有悬空关联时才写盘(repairDanglingRelations 自己判),所以每次启动
      // 跑一遍不花钱。放在这里而不是给个按钮 —— 那些关系界面上根本渲染不出来,
      // 用户不知道它存在,也就永远不会去点那个按钮。
      try { repairDanglingRelations(); } catch { /* 修不动就保持原样,不挡启动 */ }
      window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    } catch {
      // 水合失败:保持 localStorage 播种,不删 localStorage,放开重入让下次再试
      graphHydrated = false;
    }
  }).catch(() => { graphHydrated = false; });
}

function loadAll(): LifeNode[] {
  if (typeof window === 'undefined') return [];
  if (memCache == null) {
    memCache = seedFromLocalStorage();
    hydrateGraphOnce();
  }
  return memCache;
}

function saveAll(nodes: LifeNode[]): void {
  if (typeof window === 'undefined') return;
  compactCloudSyncOutboxOnce();
  memCache = nodes;
  const wasHydrated = graphHydrated;
  memDirty = true;
  window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  import('./storage-health').then(({ checkStorageWarning }) => checkStorageWarning());
  if (wasHydrated) {
    persistGraphToIdb(nodes);
  } else {
    hydrateGraphOnce(); // 未水合:reconcile(union 旧 IDB)后由水合回写,防覆盖旧数据
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return values.length ? values : undefined;
}

function normalizeAttributes(value: unknown): LifeNode['attributes'] {
  if (!isRecord(value)) return {};
  const attributes: LifeNode['attributes'] = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
      attributes[key] = raw;
    }
  }
  return attributes;
}

function normalizeRelations(value: unknown): LifeNode['relations'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((relation) => {
      if (!isRecord(relation)) return null;
      const targetId = stringValue(relation.targetId);
      const relationName = stringValue(relation.relation);
      return targetId && relationName ? { targetId, relation: relationName } : null;
    })
    .filter((relation): relation is LifeNode['relations'][number] => Boolean(relation));
}

function normalizeAsset(value: unknown): (LifeNodeAsset & { nodeId?: string }) | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const kind = stringValue(value.kind);
  if (!id || !kind) return null;
  return {
    id,
    kind,
    nodeId: stringValue(value.nodeId),
    storagePath: stringValue(value.storagePath),
    mimeType: stringValue(value.mimeType),
    label: stringValue(value.label),
    analysisSummary: stringValue(value.analysisSummary),
    tags: stringArrayValue(value.tags),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
  };
}

function normalizeNode(value: unknown): LifeNode | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const type = stringValue(value.type);
  const source = stringValue(value.source);
  const createdAt = stringValue(value.createdAt);
  if (!id || !name || !type || !source || !createdAt) return null;
  if (!LIFE_NODE_TYPES.has(type as LifeNodeType)) return null;
  if (!LIFE_NODE_SOURCES.has(source as LifeNodeSource)) return null;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : 0.6;
  const assets = Array.isArray(value.assets)
    ? value.assets.map(normalizeAsset).filter((asset): asset is LifeNodeAsset => Boolean(asset))
    : undefined;

  return {
    id,
    type: type as LifeNodeType,
    name,
    attributes: normalizeAttributes(value.attributes),
    source: source as LifeNodeSource,
    confidence,
    createdAt,
    lastConfirmedAt: stringValue(value.lastConfirmedAt),
    relations: normalizeRelations(value.relations),
    tags: stringArrayValue(value.tags),
    rawInput: stringValue(value.rawInput),
    assets,
  };
}

function mergeLifeNodeAssets(existing: LifeNodeAsset[] = [], incoming: LifeNodeAsset[] = []): LifeNodeAsset[] {
  const assetsById = new Map<string, LifeNodeAsset>();
  for (const asset of existing) assetsById.set(asset.id, asset);
  for (const asset of incoming) {
    const current = assetsById.get(asset.id);
    assetsById.set(asset.id, { ...current, ...asset });
  }
  return Array.from(assetsById.values());
}

export function mergeCloudMemorySnapshot(snapshot: { nodes?: unknown[]; assets?: unknown[] }): {
  importedNodeCount: number;
  importedAssetCount: number;
} {
  if (typeof window === 'undefined') return { importedNodeCount: 0, importedAssetCount: 0 };

  const incomingNodes = Array.isArray(snapshot.nodes)
    ? snapshot.nodes.map(normalizeNode).filter((node): node is LifeNode => Boolean(node))
    : [];
  const incomingAssets = Array.isArray(snapshot.assets)
    ? snapshot.assets.map(normalizeAsset).filter((asset): asset is LifeNodeAsset & { nodeId?: string } => Boolean(asset))
    : [];
  const incomingAssetsByNodeId = new Map<string, LifeNodeAsset[]>();

  for (const asset of incomingAssets) {
    if (!asset.nodeId) continue;
    const current = incomingAssetsByNodeId.get(asset.nodeId) || [];
    current.push(asset);
    incomingAssetsByNodeId.set(asset.nodeId, current);
  }

  // ⚠️ 删除意图优先于云快照(2026-07-30,财务账本地基体检查出的丢数据路径)。
  //
  // syncMemoryWithCloud 的顺序是「① 先拉云合并 → ② 再重试挂起的 delete」。
  // 离线时删掉一条 → 这条还在云上 → ① 把它合回本地(复活)→ ② 才把云端删掉。
  // 净结果:云端对了,**本地那条永远留着**,而且它的 outbox 记录已被标 synced,
  // 再也不会被删第二次。用户看到的是「删了又回来,再删一次才真没了」。
  //
  // outbox 里还留着 delete:<id> == 这条删除尚未确认送达云端。此刻云快照必然是
  // 删除之前的旧视图,不能拿它覆盖用户的删除意图。等 ② 成功后 outbox 条目被移除,
  // 后续快照里也不会再有这个 id,自然收敛。
  //
  // 只挡 delete,不挡 upsert —— upsert 的冲突由下面的 last-write-wins 处理。
  const pendingDeleteIds = new Set<string>();
  try {
    for (const item of loadCloudSyncOutboxMap().values()) {
      if (item.operation === 'delete') pendingDeleteIds.add(item.resourceId);
    }
  } catch { /* outbox 读不出来时按老路走:宁可多合一条,也不阻断同步 */ }

  const nodesById = new Map<string, LifeNode>();
  for (const localNode of loadAll()) nodesById.set(localNode.id, localNode);
  // 批次198(P1 前台自动同步的安全前提):last-write-wins,不再「云端无条件胜」。
  // 此前 `{...local, ...incoming}` 让云端标量字段无条件覆盖本地 —— 一旦登录后自动拉云打开,
  // 陈旧云快照会盖掉本地更新的编辑 → 丢数据。改为按 attributes.updatedAt(数据审计#3 的
  // 编辑时刻,退化 createdAt)取新者的标量字段,较旧一侧独有字段仍保留;资产两侧永远并集。
  let skippedDeletedCount = 0;
  for (const incomingNode of incomingNodes) {
    if (pendingDeleteIds.has(incomingNode.id)) { skippedDeletedCount += 1; continue; } // 见上:删除意图优先
    const localNode = nodesById.get(incomingNode.id);
    const mergedAssets = mergeLifeNodeAssets(
      mergeLifeNodeAssets(localNode?.assets, incomingNode.assets),
      incomingAssetsByNodeId.get(incomingNode.id),
    );
    // 数据审计#3:按 updatedAt 取新者标量 + attributes/tags 两侧并集(较旧侧独有属性/标签不丢;
    // 此前浅合并会整体替换嵌套 attributes → 并发加不同属性丢一侧)。assets 仍两侧并集。
    const merged = localNode ? mergeConflictingNodes(localNode, incomingNode) : incomingNode;
    nodesById.set(incomingNode.id, {
      ...merged,
      assets: mergedAssets.length ? mergedAssets : undefined,
    });
  }

  const mergedNodes = Array.from(nodesById.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  saveAll(mergedNodes);
  // 报数要诚实:被删除意图挡下的那些没有合进来,不能算「已导入」
  //(否则「已恢复 N 条」会比实际多,用户对不上数)。
  const importedNodeCount = incomingNodes.length - skippedDeletedCount;
  window.dispatchEvent(new CustomEvent('nesio-life-graph-cloud-hydrated', {
    detail: { importedNodeCount, importedAssetCount: incomingAssets.length },
  }));
  return { importedNodeCount, importedAssetCount: incomingAssets.length };
}

export async function backfillLocalLifeGraphToCloud({ limit = 200, ids }: { limit?: number; ids?: string[] } = {}): Promise<{
  attemptedNodeCount: number;
  attemptedAssetCount: number;
}> {
  if (!cloudMemorySyncEnabled()) return { attemptedNodeCount: 0, attemptedAssetCount: 0 };
  const nodes = loadAll();
  // ids 指定时只补这些(同步体检查出「本地有云端没有」后的定点补传)。
  // 不指定时维持老行为:取最新 limit 条 —— 注意这**不是全量**,图是新→旧排序,
  // 老节点若当初没成功 upsert 就永远轮不到。全量补齐请走 auditGraphConsistency
  // 查出缺失 id 再传进来(graph-consistency.ts)。
  const backfillNodes = ids
    ? nodes.filter((n) => ids.includes(n.id))
    : nodes.slice(0, limit);
  const backfillAssets = backfillNodes.flatMap((node) =>
    (node.assets || []).map((asset) => ({ ...asset, nodeId: node.id })),
  );
  if (!backfillNodes.length && !backfillAssets.length) {
    return { attemptedNodeCount: 0, attemptedAssetCount: 0 };
  }

  // 批量记账:此前逐条调用,200 个节点 × 四阶段 ≈ 800 次全表读写(O(N²) 序列化),
  // 是「打开记忆页冻住」的真实来源之一。现在每个阶段只读写一次。
  const backfillIds = backfillNodes.map((n) => n.id);
  queueCloudSyncOutboxItems(backfillIds, 'backfill');
  markCloudSyncMany(backfillIds, 'backfill', 'pending');
  try {
    updateCloudSyncOutboxAttempts(backfillIds, 'backfill');
    const response = await fetch(CLOUD_MEMORY_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nodes: backfillNodes, assets: backfillAssets, backfill: true }),
    });
    if (!response.ok) throw new Error('cloud_memory_sync_failed');
    markCloudSyncMany(backfillIds, 'backfill', 'synced');
    removeCloudSyncOutboxItems(backfillIds, 'backfill');
    for (const node of backfillNodes) syncLifeNodeSignalToCloud(node);
  } catch (error) {
    markCloudSyncMany(backfillIds, 'backfill', 'failed', error);
  }

  return { attemptedNodeCount: backfillNodes.length, attemptedAssetCount: backfillAssets.length };
}

export function getLifeGraph(): LifeNode[] {
  return loadAll();
}

export function isPrivateExternalNode(node: LifeNode): boolean {
  if (PRIVATE_EXTERNAL_SOURCES.has(node.source)) return true;
  if (Object.keys(node.attributes).some((key) => PRIVATE_EXTERNAL_ATTRIBUTE_KEYS.has(key))) return true;

  const hasEventTiming = Boolean(
    node.attributes.start ||
      node.attributes.end ||
      node.attributes.startTime ||
      node.attributes.endTime,
  );
  if (node.type === 'event' && hasEventTiming && !RECEIPT_SOURCES.has(node.source)) return true;

  const text = [
    node.rawInput || '',
    ...(node.tags || []),
    ...Object.keys(node.attributes),
  ].join(' ').toLowerCase();
  return text.includes('google calendar') || text.includes('gmail') || text.includes('calendarid');
}

export function prunePrivateExternalNodes(): number {
  const nodes = loadAll();
  const filtered = nodes.filter((node) => !isPrivateExternalNode(node));
  const removed = nodes.length - filtered.length;
  if (removed > 0) {
    const pruned = nodes.filter((node) => isPrivateExternalNode(node));
    saveAll(filtered);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nesio-life-node-deleted', { detail: { nodes: pruned } }));
    }
  }
  return removed;
}

/**
 * Notion 连接器逐行导入的节点识别(N-0 清理用)。
 * 判据只认 Notion 连接器写入的痕迹:attributes.source==='Notion' / notionPageId / database。
 * 刻意不碰「微信读书」手动粘贴导入(那是 source:'manual' + tag「微信读书」,是用户主动录入的高价值数据)。
 */
export function isNotionImportedNode(node: LifeNode): boolean {
  const a = node.attributes || {};
  return (
    a.source === 'Notion' ||
    (typeof a.notionPageId === 'string' && a.notionPageId !== '') ||
    (typeof a.database === 'string' && a.database !== '')
  );
}

/**
 * 清除所有 Notion 连接器逐行倒进来的记忆(N-0:止血)。
 * 旧的「勾表→每行一条记忆」灌进大量日期/技术 ID 噪声,收录模型重做前先清干净。
 * 与 prunePrivateExternalNodes 同构:saveAll 过滤 + 广播删除意图(本地事实库据此清对应 Signal)。
 * 返回清除条数。
 */
export function pruneNotionNodes(): number {
  const nodes = loadAll();
  const pruned = nodes.filter(isNotionImportedNode);
  if (pruned.length === 0) return 0;
  const filtered = nodes.filter((node) => !isNotionImportedNode(node));
  saveAll(filtered);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-life-node-deleted', { detail: { nodes: pruned } }));
  }
  return pruned.length;
}


// ── 节点事实 sink(架构审查 #1 残留修复,2026-07-08)────────────────────────
// updateLifeNode 此前只写投影(localStorage)+云,不写本地 IDB 事实库 ——
// done/子任务/改名全是旁路写,rebuildLifeGraphFromSignals 会把它们丢掉,
// 「投影可重建」名不副实。环依赖(life-domain/signal → life-graph)不允许
// 这里直接 import 转换器,改为注册钩子:life-domain/node-fact-sink 在模块
// 加载时注册,add/update/delete 三个写入点统一喂事实库(同 id 幂等覆盖 = upsert)。
export interface NodeFactSink {
  upsert(node: LifeNode): void;
  remove(node: LifeNode): void;
}
let nodeFactSink: NodeFactSink | null = null;
export function registerNodeFactSink(sink: NodeFactSink): void {
  nodeFactSink = sink;
}

export function addLifeNode(node: Omit<LifeNode, 'id' | 'createdAt'>): LifeNode {
  const nodes = loadAll();
  const createdAt = new Date().toISOString();
  const newNode: LifeNode = {
    ...node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt,
    // 逻辑修改时间(编辑时刻)。多端同步据此定胜负 —— 而非「谁最后同步」,
    // 否则旧副本批量回传会覆盖新编辑(数据审计 #3:云同步 last-write-wins 丢数据)。
    // 导入/恢复若已带 updatedAt,尊重原值;新建时 = createdAt。
    attributes: {
      ...node.attributes,
      updatedAt: typeof node.attributes?.updatedAt === 'string' ? node.attributes.updatedAt : createdAt,
    },
  };
  nodes.unshift(newNode);
  saveAll(nodes);
  void syncLifeGraphUpsertToCloud(newNode);
  syncLifeNodeSignalToCloud(newNode);
  if (typeof window !== 'undefined' && RECEIPT_SOURCES.has(newNode.source)) {
    window.dispatchEvent(new CustomEvent('nesio-memory-received', { detail: { node: newNode } }));
  }
  nodeFactSink?.upsert(newNode);
  return newNode;
}

export function updateLifeNode(id: string, patch: Partial<LifeNode>): boolean {
  const nodes = loadAll();
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return false;
  const merged = { ...nodes[idx], ...patch };
  // 每次编辑刷新逻辑修改时间 —— 多端同步据此定胜负(数据审计 #3)。
  // patch 显式带 updatedAt(如恢复历史版本)则尊重,否则记为当前时刻。
  const patchStamp = typeof patch.attributes?.updatedAt === 'string' ? patch.attributes.updatedAt : undefined;
  merged.attributes = { ...merged.attributes, updatedAt: patchStamp ?? new Date().toISOString() };
  nodes[idx] = merged;
  saveAll(nodes);
  nodeFactSink?.upsert(nodes[idx]);
  void syncLifeGraphUpsertToCloud(nodes[idx]);
  syncLifeNodeSignalToCloud(nodes[idx]);
  return true;
}

// ── 双向关联(R1)────────────────────────────────────────────────────────────

/**
 * 关系类型 → 反向关系。**关联天然是双向的**:
 * 「这封邮件确认了这个行程」的另一面就是「这个行程由这封邮件确认」。
 * 只写一边的话,从另一头点进去看不到 —— 而人不会知道自己站在哪一头。
 *
 * 不在表里的关系走对称(自己是自己的反面),`user_linked` 就是这一类。
 */
export const RELATION_INVERSE: Readonly<Record<string, string>> = {
  confirmed_by_email: 'confirms_plan',
  confirms_plan: 'confirmed_by_email',
  part_of_plan: 'plan_item',
  plan_item: 'part_of_plan',
  has_checklist: 'checklist_of',
  checklist_of: 'has_checklist',
};

export function inverseRelation(relation: string): string {
  return RELATION_INVERSE[relation] ?? relation;
}

export type LinkResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'self' | 'missing_from' | 'missing_to' | 'bad_relation' };

/**
 * 把两个节点关联起来 —— **一次读写把两边都写完**。
 *
 * 为什么不是两次 updateLifeNode:那样第二次失败(节点刚被删/存储写不进去)时
 * 会留下**半条关联** —— 从 A 点进去看得到 B,从 B 点进去看不到 A。
 * 这种状态没有任何界面会报错,只是「有时候能看到、有时候看不到」,
 * 是最难查的一类。这里一次 loadAll → 两处改 → 一次 saveAll,要么都成要么都不成。
 *
 * 三条前置校验,不满足直接返回原因(调用方据此给提示,不许静默吞掉):
 *   · **targetId 必须是真实节点 id**。曾经有代码把「人名」塞进 targetId
 *     (life-graph 的语音解析),那种关系指向不存在的东西,界面上永远渲染不出来,
 *     图谱里却一直占着位置。
 *   · 不许自己关自己。
 *   · 关系名不许为空。
 *
 * 幂等:同一对 + 同一关系重复调用不会写第二条(`created: false`)。
 */
export function linkNodes(fromId: string, toId: string, relation: string): LinkResult {
  const rel = (relation || '').trim();
  if (!rel) return { ok: false, reason: 'bad_relation' };
  if (fromId === toId) return { ok: false, reason: 'self' };
  const nodes = loadAll();
  const i = nodes.findIndex((n) => n.id === fromId);
  if (i < 0) return { ok: false, reason: 'missing_from' };
  const j = nodes.findIndex((n) => n.id === toId);
  if (j < 0) return { ok: false, reason: 'missing_to' };

  const inv = inverseRelation(rel);
  const hasFwd = (nodes[i].relations || []).some((r) => r.targetId === toId && r.relation === rel);
  const hasBack = (nodes[j].relations || []).some((r) => r.targetId === fromId && r.relation === inv);
  if (hasFwd && hasBack) return { ok: true, created: false };

  const stamp = new Date().toISOString();
  if (!hasFwd) {
    nodes[i] = {
      ...nodes[i],
      relations: [...(nodes[i].relations || []), { targetId: toId, relation: rel }],
      attributes: { ...nodes[i].attributes, updatedAt: stamp },
    };
  }
  if (!hasBack) {
    nodes[j] = {
      ...nodes[j],
      relations: [...(nodes[j].relations || []), { targetId: fromId, relation: inv }],
      attributes: { ...nodes[j].attributes, updatedAt: stamp },
    };
  }
  saveAll(nodes);
  for (const n of [nodes[i], nodes[j]]) {
    nodeFactSink?.upsert(n);
    void syncLifeGraphUpsertToCloud(n);
    syncLifeNodeSignalToCloud(n);
  }
  return { ok: true, created: true };
}

/** 解除关联 —— 同样两边一起,同样一次读写。返回 false = 本来就没这条。 */
export function unlinkNodes(fromId: string, toId: string, relation: string): boolean {
  const nodes = loadAll();
  const i = nodes.findIndex((n) => n.id === fromId);
  const j = nodes.findIndex((n) => n.id === toId);
  if (i < 0 && j < 0) return false;
  const inv = inverseRelation(relation);
  let changed = false;
  const stamp = new Date().toISOString();
  if (i >= 0) {
    const next = (nodes[i].relations || []).filter((r) => !(r.targetId === toId && r.relation === relation));
    if (next.length !== (nodes[i].relations || []).length) {
      nodes[i] = { ...nodes[i], relations: next, attributes: { ...nodes[i].attributes, updatedAt: stamp } };
      changed = true;
    }
  }
  if (j >= 0) {
    const next = (nodes[j].relations || []).filter((r) => !(r.targetId === fromId && r.relation === inv));
    if (next.length !== (nodes[j].relations || []).length) {
      nodes[j] = { ...nodes[j], relations: next, attributes: { ...nodes[j].attributes, updatedAt: stamp } };
      changed = true;
    }
  }
  if (!changed) return false;
  saveAll(nodes);
  for (const idx of [i, j]) {
    if (idx < 0) continue;
    nodeFactSink?.upsert(nodes[idx]);
    void syncLifeGraphUpsertToCloud(nodes[idx]);
    syncLifeNodeSignalToCloud(nodes[idx]);
  }
  return true;
}

/**
 * 找出 targetId 指不到任何节点的关系(悬空关联)。
 *
 * 存量数据里确实有:语音解析那条 `owned_by` 把**人名**当成了 targetId。
 * 这种关系界面上永远渲染不出来(渲染层要 `g.find(x => x.id === targetId)`),
 * 但它一直在图里占着位置、进备份、上云、参与去重键计算。
 */
export function danglingRelations(nodes: readonly LifeNode[]): Array<{ nodeId: string; targetId: string; relation: string }> {
  const ids = new Set(nodes.map((n) => n.id));
  const out: Array<{ nodeId: string; targetId: string; relation: string }> = [];
  for (const n of nodes) {
    for (const r of n.relations || []) {
      if (!ids.has(r.targetId)) out.push({ nodeId: n.id, targetId: r.targetId, relation: r.relation });
    }
  }
  return out;
}

/**
 * 修存量的悬空关联:能按名字找到对应节点就改成真 id,找不到就把名字**移进属性**
 * 再删掉这条关系。
 *
 * 为什么不直接删:那个名字是用户说过的信息(「Linda 的娃娃」),删了就没了。
 * 移进 `attributes.owner` 之后它仍然可搜、可显示,只是不再冒充一条关系。
 */
export function repairDanglingRelations(): { fixed: number; movedToAttributes: number } {
  const nodes = loadAll();
  if (!nodes.length) return { fixed: 0, movedToAttributes: 0 };
  const ids = new Set(nodes.map((n) => n.id));
  const byName = new Map<string, string>();
  for (const n of nodes) {
    const k = (n.name || '').trim().toLowerCase();
    if (k && !byName.has(k)) byName.set(k, n.id);
  }
  let fixed = 0; let moved = 0; let touched = false;
  for (let i = 0; i < nodes.length; i++) {
    const rels = nodes[i].relations || [];
    if (!rels.some((r) => !ids.has(r.targetId))) continue;
    const attrs = { ...nodes[i].attributes };
    const next: LifeNode['relations'] = [];
    for (const r of rels) {
      if (ids.has(r.targetId)) { next.push(r); continue; }
      const resolved = byName.get(r.targetId.trim().toLowerCase());
      if (resolved && resolved !== nodes[i].id) { next.push({ ...r, targetId: resolved }); fixed += 1; continue; }
      // 名字保住,关系丢掉
      if (!attrs[r.relation]) attrs[r.relation] = r.targetId;
      moved += 1;
    }
    nodes[i] = { ...nodes[i], relations: next, attributes: attrs };
    touched = true;
  }
  if (touched) saveAll(nodes);
  return { fixed, movedToAttributes: moved };
}

/**
 * 投影整体重建 — 仅供 Signal 事实库恢复路径调用
 * (lib/life-domain/signal-read-cache.rebuildLifeGraphFromSignals)。
 * Cutover(2026-07-04)后 Signal 是权威源,LifeGraph 是可重建的派生视图;
 * 这个函数是该关系的证明。组件层禁止直接调用。
 */
export function replaceLifeGraphProjection(nodes: LifeNode[]): void {
  saveAll(nodes);
}

export function deleteLifeNode(id: string): boolean {
  const nodes = loadAll();
  const deleted = nodes.find((n) => n.id === id);
  const removed = loadAll().find((n) => n.id === id) ?? null;
  const filtered = nodes.filter((n) => n.id !== id);
  if (filtered.length === nodes.length) return false;
  saveAll(filtered);
  if (removed) nodeFactSink?.remove(removed);
  // Cutover(2026-07-04):删除意图显式广播——本地事实库(signal-read-cache)
  // 据此删对应 Signal。事实库独立后不能再用「不在投影=删」推断。
  if (deleted && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-life-node-deleted', { detail: { nodes: [deleted] } }));
  }
  void syncLifeGraphDeleteToCloud(id);
  return true;
}

export function searchLifeGraph(query: string): LifeNode[] {
  const q = query.toLowerCase().trim();
  if (!q) return loadAll();
  return loadAll().filter(
    (n) =>
      n.name.toLowerCase().includes(q) ||
      Object.values(n.attributes).some((v) => String(v).toLowerCase().includes(q)) ||
      n.tags?.some((t) => t.toLowerCase().includes(q)),
  );
}

function nodeSearchText(node: LifeNode): string {
  return [
    node.name,
    node.rawInput || '',
    ...(node.tags || []),
    ...Object.entries(node.attributes).flatMap(([key, value]) => [key, String(value ?? '')]),
    ...node.relations.flatMap((relation) => [relation.targetId, relation.relation]),
  ].join(' ').toLowerCase();
}

// 端上简答的分词器与 smart-search(深问)共用 cjk-tokenize —— 中文没空格,
// 整句「充电宝在哪」曾被当一个 token,永远匹配不到记忆名「充电宝」(用户实测)。
// smart-search 早修过同样的坑,这个函数当时漏了,导致端上中文检索全灭。
function queryTokens(query: string): string[] {
  return tokenizeCJK(query);
}

export function searchLifeGraphFuzzy(query: string, limit = 6): LifeNode[] {
  const q = query.toLowerCase().trim();
  if (!q) return getRecentNodes(limit);
  const tokens = queryTokens(q);
  // 中英同义词扩展(PDF1 图7):问「医生预约」也要能捞到英文的
  // "Appointment with MedPsych Integrated"。权重刻意压在原词之下,
  // 精确命中永远排在同义命中前面。
  const synonyms = expandQueryTerms(tokens);
  return loadAll()
    .map((node) => {
      const text = nodeSearchText(node);
      let score = 0;
      const nameLower = node.name.toLowerCase();
      if (nameLower.includes(q)) score += 8;
      // 反向包含:提问里含记忆名(「充电宝在哪」含「充电宝」)—— 中文长名的强命中,
      // 比逐 bigram 更稳。≥2 字防单字名过度命中。
      else if (node.name.trim().length >= 2 && q.includes(nameLower)) score += 8;
      if (node.rawInput?.toLowerCase().includes(q)) score += 6;
      if (text.includes(q)) score += 5;
      for (const token of tokens) {
        if (node.name.toLowerCase().includes(token)) score += 4;
        if (node.tags?.some((tag) => tag.toLowerCase().includes(token))) score += 3;
        if (text.includes(token)) score += 1;
      }
      // 同义词:名字命中 +2(原词是 +4),否则文本命中 +1,且不与名字分累加 ——
      // 保证「原词精确命中」永远压过「同义词命中」。
      for (const s of synonyms) {
        if (nameLower.includes(s)) score += 2;
        else if (text.includes(s)) score += 1;
      }
      // 里程碑 B:邮件正文(≤1500 预览之外)命中 —— 本机全文索引补分,零云。
      if (node.source === 'email') {
        const eid = typeof node.attributes.emailId === 'string' ? node.attributes.emailId : '';
        if (eid) score += emailFulltextScore(eid, tokens, q);
      }
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.node.createdAt).getTime() - new Date(a.node.createdAt).getTime())
    .slice(0, limit)
    .map((entry) => entry.node);
}

export function getRecentNodes(limit = 8): LifeNode[] {
  return loadAll()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/** Parse natural language into a LifeNode — rule-based, no LLM required for MVP */
export function parseManualCapture(text: string): Omit<LifeNode, 'id' | 'createdAt'> {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Person names: "记住 Linda 的娃娃..."
  const personMatch = t.match(/(\S+)\s*的/);
  const personName = personMatch?.[1] || '';

  // Object
  const objectMatch = t.match(/记住\s+(.+?)(?:在|放|存|位于|$)/);
  const locationMatch = t.match(/(?:在|放在|存在|位于)\s*(.+?)(?:里|中|$)/);

  const name = objectMatch?.[1]?.trim() || t.slice(0, 20);
  const location = locationMatch?.[1]?.trim() || '';

  const node: Omit<LifeNode, 'id' | 'createdAt'> = {
    type: location ? 'object' : personName ? 'person' : 'object',
    name,
    attributes: {},
    source: 'voice',
    confidence: 0.8,
    relations: [],
    rawInput: t,
    tags: [],
  };

  if (location) node.attributes['location'] = location;
  if (personName) {
    // ⚠️ 这里**不许**写 relations。以前是 `{ targetId: personName, relation: 'owned_by' }` ——
    // targetId 存的是人名而不是节点 id,于是这条关系指向一个不存在的东西:
    // 界面永远渲染不出来(渲染层要 g.find(x => x.id === targetId)),
    // 但它一直在图里占位、进备份、上云、参与去重键计算。
    // 名字存进属性即可;真要连到人节点,由 linkNodes(用真 id)在节点落库之后做。
    node.attributes['owner'] = personName;
  }

  // Commitment detection
  if (lower.includes('提醒') || lower.includes('别忘') || lower.includes('记得')) {
    node.type = 'commitment';
  }

  return node;
}
