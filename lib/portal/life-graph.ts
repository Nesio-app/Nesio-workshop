/**
 * Life Graph — local-first storage for LifeNodes.
 * Nodes are stored in localStorage under a single key.
 * This is the foundation for Reasoning Engine and Today Feed.
 */

export type LifeNodeType =
  | 'person'
  | 'object'
  | 'place'
  | 'event'
  | 'commitment'
  | 'health_state'
  | 'preference';

export type LifeNodeSource = 'manual' | 'photo' | 'calendar' | 'email' | 'system' | 'voice';

export interface LifeNodeAsset {
  id: string;
  kind: 'image' | 'file' | 'audio' | 'text' | string;
  storagePath?: string;
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
  node?: LifeNode;
  assets?: Array<LifeNodeAsset & { nodeId?: string }>;
  queuedAt: string;
  updatedAt: string;
  attempts: number;
}

const STORAGE_KEY = 'nesio-life-graph-v1';
const CLOUD_SYNC_STATUS_KEY = 'nesio-life-graph-cloud-sync-v1';
const CLOUD_SYNC_OUTBOX_KEY = 'nesio-life-graph-cloud-sync-outbox-v1';
const PRIVATE_EXTERNAL_SOURCES = new Set<LifeNodeSource>(['calendar', 'email']);
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

function loadCloudSyncOutboxMap(): Map<string, LifeGraphCloudSyncOutboxItem> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_OUTBOX_KEY);
    if (!raw) return new Map();
    const items = JSON.parse(raw) as LifeGraphCloudSyncOutboxItem[];
    if (!Array.isArray(items)) return new Map();
    return new Map(
      items
        .filter((item) => item?.resourceId && item?.operation)
        .map((item) => [cloudSyncRecordKey(item.resourceId, item.operation), item]),
    );
  } catch {
    return new Map();
  }
}

function saveCloudSyncOutboxMap(items: Map<string, LifeGraphCloudSyncOutboxItem>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLOUD_SYNC_OUTBOX_KEY, JSON.stringify(Array.from(items.values())));
  } catch {
    /* sync outbox is best-effort; local Memory remains authoritative offline. */
  }
}

function queueCloudSyncOutboxItem(
  resource: LifeNode | string,
  operation: CloudSyncOperation,
  payload: Pick<LifeGraphCloudSyncOutboxItem, 'assets'> = {},
): void {
  const resourceId = typeof resource === 'string' ? resource : resource.id;
  const items = loadCloudSyncOutboxMap();
  const key = cloudSyncRecordKey(resourceId, operation);
  const current = items.get(key);
  const now = new Date().toISOString();
  items.set(key, {
    resourceId,
    operation,
    node: typeof resource === 'string' ? current?.node : resource,
    assets: payload.assets || current?.assets,
    queuedAt: current?.queuedAt || now,
    updatedAt: now,
    attempts: current?.attempts || 0,
  });
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

function loadCloudSyncRecordMap(): Map<string, LifeGraphCloudSyncRecord> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_STATUS_KEY);
    if (!raw) return new Map();
    const records = JSON.parse(raw) as LifeGraphCloudSyncRecord[];
    if (!Array.isArray(records)) return new Map();
    return new Map(
      records
        .filter((record) => record?.resourceId && record?.operation && record?.status)
        .map((record) => [cloudSyncRecordKey(record.resourceId, record.operation), record]),
    );
  } catch {
    return new Map();
  }
}

function saveCloudSyncRecordMap(records: Map<string, LifeGraphCloudSyncRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLOUD_SYNC_STATUS_KEY, JSON.stringify(Array.from(records.values())));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-cloud-sync-updated'));
  } catch {
    /* sync status is diagnostic; local Memory must keep working if storage is full. */
  }
}

function cloudSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'cloud_memory_sync_failed';
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
  lastUpdatedAt: string | null;
} {
  const records = getLifeGraphCloudSyncRecords();
  return {
    pendingCount: records.filter((record) => record.status === 'pending').length,
    syncedCount: records.filter((record) => record.status === 'synced').length,
    failedCount: records.filter((record) => record.status === 'failed').length,
    lastUpdatedAt: records[0]?.updatedAt || null,
  };
}

async function syncLifeNodeToCloud(node: LifeNode): Promise<void> {
  if (!cloudMemorySyncEnabled()) return;
  queueCloudSyncOutboxItem(node, 'upsert', { assets: [] });
  markCloudSyncPending(node.id, 'upsert');
  try {
    updateCloudSyncOutboxAttempt(node.id, 'upsert');
    const response = await fetch(CLOUD_MEMORY_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nodes: [node], assets: [] }),
    });
    if (!response.ok) throw new Error('cloud_memory_sync_failed');
    markCloudSyncSynced(node.id, 'upsert');
    removeCloudSyncOutboxItem(node.id, 'upsert');
  } catch (error) {
    markCloudSyncFailed(node.id, 'upsert', error);
  }
}

async function syncLifeGraphDeleteToCloud(id: string): Promise<void> {
  if (!cloudMemorySyncEnabled()) return;
  queueCloudSyncOutboxItem(id, 'delete');
  markCloudSyncPending(id, 'delete');
  try {
    updateCloudSyncOutboxAttempt(id, 'delete');
    const response = await fetch(CLOUD_MEMORY_ENDPOINT, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nodeId: id }),
    });
    if (!response.ok) throw new Error('cloud_memory_sync_failed');
    markCloudSyncSynced(id, 'delete');
    removeCloudSyncOutboxItem(id, 'delete');
  } catch (error) {
    markCloudSyncFailed(id, 'delete', error);
  }
}

export async function retryLifeGraphCloudSync(): Promise<{
  retriedCount: number;
  succeededCount: number;
  failedCount: number;
}> {
  if (!cloudMemorySyncEnabled()) return { retriedCount: 0, succeededCount: 0, failedCount: 0 };

  const retryRecords = getLifeGraphCloudSyncRecords().filter(
    (record) => record.status === 'pending' || record.status === 'failed',
  );
  const outboxItemsByKey = loadCloudSyncOutboxMap();
  let retriedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  for (const record of retryRecords) {
    const item = outboxItemsByKey.get(cloudSyncRecordKey(record.resourceId, record.operation));
    if (!item) continue;
    retriedCount += 1;
    markCloudSyncPending(item.resourceId, item.operation);
    updateCloudSyncOutboxAttempt(item.resourceId, item.operation);
    try {
      if ((item.operation === 'upsert' || item.operation === 'backfill') && item.node) {
        const response = await fetch(CLOUD_MEMORY_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nodes: [item.node], assets: item.assets || [] }),
        });
        if (!response.ok) throw new Error('cloud_memory_sync_failed');
      } else if (item.operation === 'delete') {
        const response = await fetch(CLOUD_MEMORY_ENDPOINT, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nodeId: item.resourceId }),
        });
        if (!response.ok) throw new Error('cloud_memory_sync_failed');
      } else {
        throw new Error('cloud_memory_sync_payload_missing');
      }
      markCloudSyncSynced(item.resourceId, item.operation);
      removeCloudSyncOutboxItem(item.resourceId, item.operation);
      succeededCount += 1;
    } catch (error) {
      markCloudSyncFailed(item.resourceId, item.operation, error);
      failedCount += 1;
    }
  }

  return { retriedCount, succeededCount, failedCount };
}

function loadAll(): LifeNode[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LifeNode[];
  } catch {
    return [];
  }
}

function saveAll(nodes: LifeNode[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  } catch {
    /* storage full or unavailable */
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

  const nodesById = new Map<string, LifeNode>();
  for (const localNode of loadAll()) nodesById.set(localNode.id, localNode);
  for (const incomingNode of incomingNodes) {
    const localNode = nodesById.get(incomingNode.id);
    const mergedAssets = mergeLifeNodeAssets(
      mergeLifeNodeAssets(localNode?.assets, incomingNode.assets),
      incomingAssetsByNodeId.get(incomingNode.id),
    );
    nodesById.set(incomingNode.id, {
      ...localNode,
      ...incomingNode,
      assets: mergedAssets.length ? mergedAssets : undefined,
    });
  }

  const mergedNodes = Array.from(nodesById.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  saveAll(mergedNodes);
  window.dispatchEvent(new CustomEvent('nesio-life-graph-cloud-hydrated', {
    detail: { importedNodeCount: incomingNodes.length, importedAssetCount: incomingAssets.length },
  }));
  return { importedNodeCount: incomingNodes.length, importedAssetCount: incomingAssets.length };
}

export async function backfillLocalLifeGraphToCloud({ limit = 200 }: { limit?: number } = {}): Promise<{
  attemptedNodeCount: number;
  attemptedAssetCount: number;
}> {
  if (!cloudMemorySyncEnabled()) return { attemptedNodeCount: 0, attemptedAssetCount: 0 };
  const nodes = loadAll();
  const backfillNodes = nodes.slice(0, limit);
  const backfillAssets = backfillNodes.flatMap((node) =>
    (node.assets || []).map((asset) => ({ ...asset, nodeId: node.id })),
  );
  if (!backfillNodes.length && !backfillAssets.length) {
    return { attemptedNodeCount: 0, attemptedAssetCount: 0 };
  }

  for (const node of backfillNodes) {
    queueCloudSyncOutboxItem(node, 'backfill', {
      assets: (node.assets || []).map((asset) => ({ ...asset, nodeId: node.id })),
    });
    markCloudSyncPending(node.id, 'backfill');
  }
  try {
    for (const node of backfillNodes) updateCloudSyncOutboxAttempt(node.id, 'backfill');
    const response = await fetch(CLOUD_MEMORY_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nodes: backfillNodes, assets: backfillAssets, backfill: true }),
    });
    if (!response.ok) throw new Error('cloud_memory_sync_failed');
    for (const node of backfillNodes) {
      markCloudSyncSynced(node.id, 'backfill');
      removeCloudSyncOutboxItem(node.id, 'backfill');
    }
  } catch (error) {
    for (const node of backfillNodes) markCloudSyncFailed(node.id, 'backfill', error);
  }

  return { attemptedNodeCount: backfillNodes.length, attemptedAssetCount: backfillAssets.length };
}

export function getLifeGraph(): LifeNode[] {
  return loadAll();
}

export function isPrivateExternalNode(node: LifeNode): boolean {
  if (PRIVATE_EXTERNAL_SOURCES.has(node.source)) return true;
  return Boolean(
    node.attributes['calendarId'] ||
      node.attributes['calendarName'] ||
      node.attributes['emailId'] ||
      node.attributes['messageId'],
  );
}

export function prunePrivateExternalNodes(): number {
  const nodes = loadAll();
  const filtered = nodes.filter((node) => !isPrivateExternalNode(node));
  const removed = nodes.length - filtered.length;
  if (removed > 0) saveAll(filtered);
  return removed;
}

export function addLifeNode(node: Omit<LifeNode, 'id' | 'createdAt'>): LifeNode {
  const nodes = loadAll();
  const newNode: LifeNode = {
    ...node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  nodes.unshift(newNode);
  saveAll(nodes);
  void syncLifeNodeToCloud(newNode);
  syncLifeNodeSignalToCloud(newNode);
  if (typeof window !== 'undefined' && RECEIPT_SOURCES.has(newNode.source)) {
    window.dispatchEvent(new CustomEvent('nesio-memory-received', { detail: { node: newNode } }));
  }
  return newNode;
}

export function updateLifeNode(id: string, patch: Partial<LifeNode>): boolean {
  const nodes = loadAll();
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return false;
  nodes[idx] = { ...nodes[idx], ...patch };
  saveAll(nodes);
  void syncLifeNodeToCloud(nodes[idx]);
  return true;
}

export function deleteLifeNode(id: string): boolean {
  const nodes = loadAll();
  const filtered = nodes.filter((n) => n.id !== id);
  if (filtered.length === nodes.length) return false;
  saveAll(filtered);
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

function queryTokens(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .replace(/[，。！？、,.!?;；:："'“”‘’()[\]{}]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  ));
}

export function searchLifeGraphFuzzy(query: string, limit = 6): LifeNode[] {
  const q = query.toLowerCase().trim();
  if (!q) return getRecentNodes(limit);
  const tokens = queryTokens(q);
  return loadAll()
    .map((node) => {
      const text = nodeSearchText(node);
      let score = 0;
      if (node.name.toLowerCase().includes(q)) score += 8;
      if (node.rawInput?.toLowerCase().includes(q)) score += 6;
      if (text.includes(q)) score += 5;
      for (const token of tokens) {
        if (node.name.toLowerCase().includes(token)) score += 4;
        if (node.tags?.some((tag) => tag.toLowerCase().includes(token))) score += 3;
        if (text.includes(token)) score += 1;
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
    node.relations.push({ targetId: personName, relation: 'owned_by' });
    node.attributes['owner'] = personName;
  }

  // Commitment detection
  if (lower.includes('提醒') || lower.includes('别忘') || lower.includes('记得')) {
    node.type = 'commitment';
  }

  return node;
}
