import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { buildModuleDataBus, MODULE_DATA_BUS_BOUNDARIES_V0 } from './module-data-bus.mjs';
import {
  loadExternalConnectionStateFromDb,
  loadModuleDataBusFromDb,
  isDbBackedDataLayerEnabled,
} from './module-data-network-db.mjs';
import { buildModuleRegistry } from './module-manager-core.mjs';
import { loadExternalBridgeContract } from './external-bridge-contract.mjs';

const DATA_CATALOG_SUMMARY_FIELDS = Object.freeze([
  'dataKey',
  'scope',
  'producers',
  'consumers',
  'producerCount',
  'consumerCount',
  'edgeCount',
  'health',
  'reserved',
]);

const EDGE_SUMMARY_FIELDS = Object.freeze(['fromModuleId', 'toModuleId', 'dataKey', 'relation', 'risk']);
const SHELL_ROUTE_FIELDS = Object.freeze([
  'routeKey',
  'moduleId',
  'label',
  'modeAvailability',
  'entryStatus',
  'emptyStateKey',
  'requiredCapabilities',
  'approvalGateKeys',
  'evidenceLinks',
]);

const SHELL_MODE_KEYS = Object.freeze(['personal', 'demo', 'market']);
const SHELL_ENTRY_STATUS_VALUES = Object.freeze(['ready', 'not_ready', 'external', 'unconnected', 'contract_only', 'gated']);
const SHELL_AVAILABILITY_VALUES = Object.freeze(['available', 'hidden', 'not_ready', 'gated']);
const SUMMARY_RESPONSE_WHITELIST = Object.freeze([
  'ok',
  'source',
  'generatedAt',
  'boundaries',
  'modules',
  'sharedDataCatalog',
  'sharedEdgeCount',
  'sharedEdges',
  'interconnectPlan',
  'crossBoundarySummary',
  'warningCount',
  'warnings',
  'shellRoutes',
  'externalConnectionSummary',
]);
const EXTERNAL_CONNECTION_FIELDS = Object.freeze(['ok', 'reason', 'providerCount', 'enabledCount', 'providerStates']);
const DEC_LIST_MAX_LIMIT = Number(process.env.BAOHE_DEC_MAX_LIMIT || '200');
const DEC_LIST_DEFAULT_LIMIT = Number.isFinite(Number(process.env.BAOHE_DEC_DEFAULT_LIMIT || '25'))
  ? Math.min(DEC_LIST_MAX_LIMIT, Math.max(1, Number(process.env.BAOHE_DEC_DEFAULT_LIMIT || '25')))
  : 25;
const DEC_LIST_MIN_LIMIT = 1;
const DEC_LIST_MAX_OFFSET = Number.isFinite(Number(process.env.BAOHE_DEC_MAX_OFFSET || '2000'))
  ? Math.max(100, Number(process.env.BAOHE_DEC_MAX_OFFSET || '2000'))
  : 2000;
const DEC_LIST_MIN_OFFSET = 0;

const DEC_CACHE_TTL_MS = Number(process.env.BAOHE_DEC_CACHE_TTL_MS || '15000');
const DEC_DATA_DEFAULT_CACHE_TTL_MS = Number.isFinite(DEC_CACHE_TTL_MS) && DEC_CACHE_TTL_MS > 0 ? DEC_CACHE_TTL_MS : 15000;
const DB_PATH_ENV = 'BAOHE_DB_PATH';
const DEC_USAGE_METRICS_MAX_KEYS = Number.isFinite(Number(process.env.BAOHE_DEC_USAGE_METRICS_MAX_KEYS || '240'))
  ? Number(process.env.BAOHE_DEC_USAGE_METRICS_MAX_KEYS || '240')
  : 240;
const DEC_USAGE_METRICS_TOP_SUMMARY_DEFAULT = Number.isFinite(
  Number(process.env.BAOHE_DEC_USAGE_METRICS_TOP_SUMMARY_DEFAULT || '5'),
)
  ? Math.max(1, Number(process.env.BAOHE_DEC_USAGE_METRICS_TOP_SUMMARY_DEFAULT || '5'))
  : 5;
const DEC_USAGE_METRICS_MAX_TOP_SUMMARY = Number.isFinite(
  Number(process.env.BAOHE_DEC_USAGE_METRICS_MAX_TOP_SUMMARY || '20'),
)
  ? Math.max(1, Number(process.env.BAOHE_DEC_USAGE_METRICS_MAX_TOP_SUMMARY || '20'))
  : 20;

/**
 * @type {Map<string, { payload: unknown; createdAt: number; expiresAt: number; ttlMs: number; status: string } >}
 */
const decResponseCache = new Map();
/**
 * @type {Map<string, {
 *   category: string;
 *   signature: string;
 *   calls: number;
 *   errors: number;
 *   cacheHit: number;
 *   cacheMiss: number;
 *   cacheRefresh: number;
 *   cacheStale: number;
 *   latencyMsSum: number;
 *   minLatencyMs: number;
 *   maxLatencyMs: number;
 *   lastLatencyMs: number;
 *   hasPagingRequests: number;
 *   pagingLimitRequests: number;
 *   pagingOffsetRequests: number;
 *   firstAt: number;
 *   lastAt: number;
 * } >}
 */
const decUsageMetrics = new Map();
const DEC_METRICS_CATEGORY = 'dec-metrics-v0';

function nowEpochMs() {
  return Date.now();
}

function normalizeUsageSignature(value = '') {
  return String(value || 'default')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function buildUsageMetricKey(category, signature) {
  return `${category}::${signature}`;
}

function pruneDecUsageMetrics() {
  if (decUsageMetrics.size <= DEC_USAGE_METRICS_MAX_KEYS) return;
  const oldest = [...decUsageMetrics.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt);
  while (decUsageMetrics.size > DEC_USAGE_METRICS_MAX_KEYS && oldest.length > 0) {
    const entry = oldest.shift();
    if (!entry) break;
    decUsageMetrics.delete(entry[0]);
  }
}

function getDecUsageMetric(category, signature) {
  const normalizedSignature = normalizeUsageSignature(signature);
  const key = buildUsageMetricKey(category, normalizedSignature);
  const existing = decUsageMetrics.get(key);
  if (existing) return existing;

  const now = nowEpochMs();
  const created = {
    category,
    signature: normalizedSignature,
    calls: 0,
    errors: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cacheRefresh: 0,
    cacheStale: 0,
    latencyMsSum: 0,
    minLatencyMs: 0,
    maxLatencyMs: 0,
    lastLatencyMs: 0,
    hasPagingRequests: 0,
    pagingLimitRequests: 0,
    pagingOffsetRequests: 0,
    firstAt: now,
    lastAt: now,
  };
  decUsageMetrics.set(key, created);
  pruneDecUsageMetrics();
  return created;
}

function recordUsageMetric({
  category,
  signature,
  latencyMs = 0,
  cacheStatus = 'error',
  hasPaging = false,
  hasLimitParam = false,
  hasOffsetParam = false,
  hasError = false,
}) {
  const metric = getDecUsageMetric(category, signature);
  metric.calls += 1;
  if (hasError) metric.errors += 1;

  switch (cacheStatus) {
    case 'hit':
      metric.cacheHit += 1;
      break;
    case 'miss':
      metric.cacheMiss += 1;
      break;
    case 'refreshed':
      metric.cacheRefresh += 1;
      break;
    case 'stale':
      metric.cacheStale += 1;
      break;
    default:
      break;
  }

  const safeLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
  metric.latencyMsSum += safeLatency;
  metric.lastLatencyMs = safeLatency;
  metric.lastAt = nowEpochMs();

  if (metric.calls === 1) {
    metric.minLatencyMs = safeLatency;
    metric.maxLatencyMs = safeLatency;
  } else {
    metric.minLatencyMs = Math.min(metric.minLatencyMs, safeLatency);
    metric.maxLatencyMs = Math.max(metric.maxLatencyMs, safeLatency);
  }

  if (hasPaging) {
    metric.hasPagingRequests += 1;
    if (hasLimitParam) metric.pagingLimitRequests += 1;
    if (hasOffsetParam) metric.pagingOffsetRequests += 1;
  }

  return metric;
}

function usageMetricRow(metric) {
  const avgLatencyMs = metric.calls > 0 ? Number((metric.latencyMsSum / metric.calls).toFixed(2)) : 0;
  return {
    category: metric.category,
    signature: metric.signature,
    calls: metric.calls,
    errors: metric.errors,
    cacheHit: metric.cacheHit,
    cacheMiss: metric.cacheMiss,
    cacheRefresh: metric.cacheRefresh,
    cacheStale: metric.cacheStale,
    avgLatencyMs,
    minLatencyMs: metric.minLatencyMs,
    maxLatencyMs: metric.maxLatencyMs,
    lastLatencyMs: metric.lastLatencyMs,
    pagingRequests: metric.hasPagingRequests,
    pagingLimitRequests: metric.pagingLimitRequests,
    pagingOffsetRequests: metric.pagingOffsetRequests,
    firstAt: new Date(metric.firstAt).toISOString(),
    lastAt: new Date(metric.lastAt).toISOString(),
  };
}

function normalizePositiveInt(value, fallback, max) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  const ceil = Math.floor(normalized);
  if (typeof max === 'number' && max > 0) {
    return Math.max(1, Math.min(ceil, max));
  }
  return ceil;
}

function buildDecUsageMetricsSummary(filteredRows, top = DEC_USAGE_METRICS_TOP_SUMMARY_DEFAULT) {
  const safeTop = normalizePositiveInt(top, DEC_USAGE_METRICS_TOP_SUMMARY_DEFAULT, DEC_USAGE_METRICS_MAX_TOP_SUMMARY);

  const byCategory = new Map();
  const bySignature = new Map();

  for (const metric of filteredRows) {
    const calls = metric.calls || 0;
    const errors = metric.errors || 0;
    const cacheHit = metric.cacheHit || 0;
    const cacheMiss = metric.cacheMiss || 0;
    const cacheRefresh = metric.cacheRefresh || 0;
    const cacheStale = metric.cacheStale || 0;
    const categorySummary = byCategory.get(metric.category) || {
      category: metric.category,
      calls: 0,
      errors: 0,
      cacheHit: 0,
      cacheMiss: 0,
      cacheRefresh: 0,
      cacheStale: 0,
      latencyMsSum: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      totalPagingRequests: 0,
    };

    categorySummary.calls += calls;
    categorySummary.errors += errors;
    categorySummary.cacheHit += cacheHit;
    categorySummary.cacheMiss += cacheMiss;
    categorySummary.cacheRefresh += cacheRefresh;
    categorySummary.cacheStale += cacheStale;
    categorySummary.totalPagingRequests += metric.pagingRequests || 0;
    categorySummary.latencyMsSum += metric.avgLatencyMs * calls;
    categorySummary.minLatencyMs = categorySummary.minLatencyMs === 0 || metric.minLatencyMs === 0
      ? Math.max(categorySummary.minLatencyMs, metric.minLatencyMs)
      : Math.min(categorySummary.minLatencyMs, metric.minLatencyMs);
    categorySummary.maxLatencyMs = Math.max(categorySummary.maxLatencyMs, metric.maxLatencyMs);

    const signatureKey = `${metric.category}::${metric.signature}`;
    const signatureSummary = bySignature.get(signatureKey) || {
      category: metric.category,
      signature: metric.signature,
      calls: 0,
      errors: 0,
      cacheHit: 0,
      cacheMiss: 0,
      latencyMsSum: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      pagingRequests: 0,
    };

    signatureSummary.calls += calls;
    signatureSummary.errors += errors;
    signatureSummary.cacheHit += cacheHit;
    signatureSummary.cacheMiss += cacheMiss;
    signatureSummary.pagingRequests += metric.pagingRequests || 0;
    signatureSummary.latencyMsSum += metric.avgLatencyMs * calls;
    signatureSummary.minLatencyMs = signatureSummary.minLatencyMs === 0 || metric.minLatencyMs === 0
      ? Math.max(signatureSummary.minLatencyMs, metric.minLatencyMs)
      : Math.min(signatureSummary.minLatencyMs, metric.minLatencyMs);
    signatureSummary.maxLatencyMs = Math.max(signatureSummary.maxLatencyMs, metric.maxLatencyMs);

    byCategory.set(metric.category, categorySummary);
    bySignature.set(signatureKey, signatureSummary);
  }

  const byCategoryRows = [...byCategory.values()].map((entry) => {
    const calls = entry.calls || 0;
    const totalCacheRequests = Math.max(1, entry.cacheHit + entry.cacheMiss + entry.cacheRefresh + entry.cacheStale);
    return {
      category: entry.category,
      calls: entry.calls,
      errors: entry.errors,
      cacheHitRate: Number(((entry.cacheHit / totalCacheRequests) * 100).toFixed(2)),
      errorRate: Number(((entry.errors / Math.max(1, calls)) * 100).toFixed(2)),
      avgLatencyMs: Number((entry.latencyMsSum / Math.max(1, calls)).toFixed(2)),
      minLatencyMs: entry.minLatencyMs,
      maxLatencyMs: entry.maxLatencyMs,
      totalPagingRequests: entry.totalPagingRequests,
    };
  }).sort((a, b) => b.calls - a.calls);

  const bySignatureRows = [...bySignature.values()].map((entry) => {
    const calls = entry.calls || 0;
    const totalCache = Math.max(1, entry.cacheHit + entry.cacheMiss);
    return {
      category: entry.category,
      signature: entry.signature,
      calls: entry.calls,
      errors: entry.errors,
      cacheHitRate: Number(((entry.cacheHit / totalCache) * 100).toFixed(2)),
      errorRate: Number(((entry.errors / Math.max(1, calls)) * 100).toFixed(2)),
      avgLatencyMs: Number((entry.latencyMsSum / Math.max(1, calls)).toFixed(2)),
      minLatencyMs: entry.minLatencyMs,
      maxLatencyMs: entry.maxLatencyMs,
      pagingRequests: entry.pagingRequests,
    };
  }).sort((a, b) => b.calls - a.calls);

  return {
    byCategory: byCategoryRows,
    bySignature: bySignatureRows,
    topByCalls: bySignatureRows.slice(0, safeTop),
    topByErrorRate: bySignatureRows
      .filter((entry) => entry.calls > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, safeTop),
    totalCategories: byCategoryRows.length,
    totalSignatures: bySignatureRows.length,
  };
}

function buildDecUsageMetricsPayload(filter = {}) {
  const normalizedFilter = (filter && typeof filter === 'object') ? filter : {};
  const signatureFilter = typeof normalizedFilter.signature === 'string' && normalizedFilter.signature.trim().length > 0
    ? normalizeUsageSignature(normalizedFilter.signature)
    : '';
  const categoryFilter = typeof normalizedFilter.category === 'string' && normalizedFilter.category.trim().length > 0
    ? normalizedFilter.category.trim()
    : '';

  const rows = [...decUsageMetrics.values()]
    .filter((metric) => {
      if (signatureFilter && metric.signature !== signatureFilter) return false;
      if (categoryFilter && metric.category !== categoryFilter) return false;
      return true;
    })
    .map(usageMetricRow)
    .sort((left, right) => right.calls - left.calls);

  const filteredRows = normalizedFilter.includeZero === true ? rows : rows.filter((entry) => entry.calls > 0);
  const totalCalls = filteredRows.reduce((sum, entry) => sum + entry.calls, 0);
  const totalErrors = filteredRows.reduce((sum, entry) => sum + entry.errors, 0);
  const totalCacheHit = filteredRows.reduce((sum, entry) => sum + entry.cacheHit, 0);
  const totalCacheMiss = filteredRows.reduce((sum, entry) => sum + entry.cacheMiss, 0);
  const totalCacheRefresh = filteredRows.reduce((sum, entry) => sum + entry.cacheRefresh, 0);
  const totalCacheStale = filteredRows.reduce((sum, entry) => sum + entry.cacheStale, 0);
  const summary = {
    metricCount: filteredRows.length,
    totalCalls,
    totalErrors,
    totalCacheHit,
    totalCacheMiss,
    totalCacheRefresh,
    totalCacheStale,
  };

  if (normalizedFilter.summary === true) {
    const summaryRows = buildDecUsageMetricsSummary(filteredRows, normalizedFilter.top);
    return {
      ok: true,
      implementation: DEC_METRICS_CATEGORY,
      generatedAt: new Date().toISOString(),
      boundaries: {
        implementation: DEC_METRICS_CATEGORY,
        readsRegistryMetadataOnly: false,
        readsArtifactFilesOnly: false,
        writesRealData: false,
        readsRealData: false,
      },
      summary: {
        ...summary,
        ...summaryRows,
      },
      metrics: filteredRows,
    };
  }

  return {
    ok: true,
    implementation: DEC_METRICS_CATEGORY,
    generatedAt: new Date().toISOString(),
    boundaries: {
      implementation: DEC_METRICS_CATEGORY,
      readsRegistryMetadataOnly: false,
      readsArtifactFilesOnly: false,
      writesRealData: false,
      readsRealData: false,
    },
    summary,
    metrics: filteredRows,
  };
}

function currentDbPath() {
  const configured = process.env[DB_PATH_ENV];
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return join(process.cwd(), 'database', 'treasurebox-local.db');
}

function withCache(key, ttlMs, createValue, force = false, usageContext = null) {
  const startedAt = nowEpochMs();
  let cacheStatus = 'error';
  let shouldRecordUsage = usageContext && typeof usageContext === 'object';
  let hasPaging = false;
  let hasLimitParam = false;
  let hasOffsetParam = false;

  if (shouldRecordUsage) {
    hasPaging = usageContext.hasPaging === true;
    hasLimitParam = usageContext.hasLimitParam === true;
    hasOffsetParam = usageContext.hasOffsetParam === true;
  }

  const now = Date.now();
  const cached = decResponseCache.get(key);
  if (!force && cached && cached.expiresAt > now) {
    cacheStatus = 'hit';
  const response = {
      ...cached.payload,
      cache: {
        status: 'hit',
        hit: true,
        ttlMs: cached.ttlMs,
        cachedAt: cached.createdAt,
        expiresAt: cached.expiresAt,
      },
    };
    const latencyMs = nowEpochMs() - startedAt;
    if (shouldRecordUsage) {
    recordUsageMetric({
      ...usageContext,
      latencyMs,
      cacheStatus,
      hasPaging,
      hasLimitParam,
        hasOffsetParam,
      });
    }
    return response;
  }

  try {
    const payload = createValue();
    const createdAt = Date.now();
    const ttl = Math.max(2000, ttlMs || DEC_DATA_DEFAULT_CACHE_TTL_MS);
    const next = {
      payload,
      createdAt,
      expiresAt: createdAt + ttl,
      ttlMs: ttl,
      status: 'fresh',
    };
    decResponseCache.set(key, next);
    cacheStatus = cached ? 'refreshed' : 'miss';
    const response = {
      ...payload,
      cache: {
        status: cached ? 'refreshed' : 'miss',
        hit: false,
        ttlMs: next.ttlMs,
        cachedAt: next.createdAt,
        expiresAt: next.expiresAt,
      },
    };
    const latencyMs = nowEpochMs() - startedAt;
    if (shouldRecordUsage) {
      recordUsageMetric({
        ...usageContext,
        latencyMs,
        cacheStatus,
        hasPaging,
        hasLimitParam,
        hasOffsetParam,
      });
    }
    return response;
  } catch (error) {
    if (cached) {
      cacheStatus = 'stale';
      const response = {
        ...cached.payload,
        cache: {
          status: 'stale',
          hit: true,
          ttlMs: cached.ttlMs,
          cachedAt: cached.createdAt,
          expiresAt: cached.expiresAt,
          staleReason: error instanceof Error ? error.message : 'unknown cache fallback error',
        },
      };
      const latencyMs = nowEpochMs() - startedAt;
      if (shouldRecordUsage) {
        recordUsageMetric({
          ...usageContext,
          latencyMs,
          cacheStatus,
          hasPaging,
          hasLimitParam,
          hasOffsetParam,
        });
      }
      return response;
    }
    if (shouldRecordUsage) {
      recordUsageMetric({
        ...usageContext,
        latencyMs: nowEpochMs() - startedAt,
        cacheStatus,
        hasPaging,
        hasLimitParam,
        hasOffsetParam,
        hasError: true,
      });
    }
    throw error;
  }
}

function uniqueValues(values = []) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeBooleanValue(value, fallback = undefined) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizePaging(rawLimit, rawOffset) {
  const parsedLimit = Number.parseInt(String(rawLimit || ''), 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(DEC_LIST_MAX_LIMIT, Math.max(DEC_LIST_MIN_LIMIT, parsedLimit))
    : DEC_LIST_DEFAULT_LIMIT;

  const parsedOffset = Number.parseInt(String(rawOffset || ''), 10);
  const offset = Number.isFinite(parsedOffset)
    ? Math.max(DEC_LIST_MIN_OFFSET, Math.min(DEC_LIST_MAX_OFFSET, parsedOffset))
    : DEC_LIST_MIN_OFFSET;

  return { limit, offset };
}

function decodePageCursor(rawCursor, expectedTable) {
  if (typeof rawCursor !== 'string' || rawCursor.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(rawCursor.trim(), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.table !== expectedTable) return null;
    return parsed;
  } catch {
    return null;
  }
}

function encodePageCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function cursorForLastRow(table, row) {
  if (!row) return null;
  if (table === 'artifacts') {
    return encodePageCursor({
      table,
      priority: Number(row.visibility_priority || 0),
      updatedAt: row.updated_at,
      id: row.artifact_id,
    });
  }
  if (table === 'handoffs') {
    return encodePageCursor({
      table,
      at: row.parsed_at,
      id: row.handoff_id,
    });
  }
  if (table === 'gates') {
    return encodePageCursor({
      table,
      at: row.updated_at,
      id: row.gate_id,
    });
  }
  if (table === 'events') {
    return encodePageCursor({
      table,
      at: row.created_at,
      id: row.event_id,
    });
  }
  return null;
}

function addCursorWhereClause(whereClause, table, cursor) {
  if (!cursor) return false;
  if (table === 'artifacts') {
    const priority = Number(cursor.priority);
    if (!Number.isFinite(priority) || typeof cursor.updatedAt !== 'string' || typeof cursor.id !== 'string') {
      return false;
    }
    whereClause.push({
      sql: `(
        COALESCE(visibility_priority, 0) < ?
        OR (
          COALESCE(visibility_priority, 0) = ?
          AND (
            datetime(updated_at) < datetime(?)
            OR (datetime(updated_at) = datetime(?) AND artifact_id > ?)
          )
        )
      )`,
      value: [priority, priority, cursor.updatedAt, cursor.updatedAt, cursor.id],
    });
    return true;
  }
  const cursorConfig = {
    handoffs: { alias: 'h', column: 'parsed_at', id: 'handoff_id' },
    gates: { alias: 'g', column: 'updated_at', id: 'gate_id' },
    events: { alias: null, column: 'created_at', id: 'event_id' },
  }[table];
  if (!cursorConfig || typeof cursor.at !== 'string' || typeof cursor.id !== 'string') return false;
  const prefix = cursorConfig.alias ? `${cursorConfig.alias}.` : '';
  whereClause.push({
    sql: `(
      datetime(${prefix}${cursorConfig.column}) < datetime(?)
      OR (
        datetime(${prefix}${cursorConfig.column}) = datetime(?)
        AND ${prefix}${cursorConfig.id} > ?
      )
    )`,
    value: [cursor.at, cursor.at, cursor.id],
  });
  return true;
}

function mapWhereClause(whereClause) {
  return whereClause.length > 0 ? ` WHERE ${whereClause.map((entry) => entry.sql).join(' AND ')}` : '';
}

function addWhereClause(whereClause, sql, value) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.trim().length === 0) return;
  whereClause.push({ sql, value: Array.isArray(value) ? value : [value] });
}

function normalizeLike(value) {
  if (typeof value !== 'string') return '';
  return `%${value.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function buildPaginationSql(limit, offset) {
  return ` LIMIT ${limit} OFFSET ${offset}`;
}

function pickSummaryFields(item, fields) {
  const source = item || {};
  const output = {};
  for (const field of fields) {
    output[field] = source[field];
  }
  return output;
}

function buildModuleOwnerIndex(modules = []) {
  return modules.reduce((acc, module) => {
    if (!module || typeof module.id !== 'string') return acc;
    const owner = [
      module.owner,
      module.responsibleAgent,
      module.maintainer,
      module.evidenceOwner,
      module.gateOwner,
    ].find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
    if (owner) acc.set(module.id, owner.trim());
    return acc;
  }, new Map());
}

function buildWarningEvidenceFields(warning) {
  const keys = new Set();
  keys.add('warningKind');
  keys.add('issue');
  if (warning.warningKind) keys.add('warningKind');
  if (warning.dataKey) keys.add('dataKey');
  if (warning.moduleId) keys.add('moduleId');
  if (Array.isArray(warning.producers)) keys.add('producers');
  if (Array.isArray(warning.consumers)) keys.add('consumers');
  if (Array.isArray(warning.dataKeys)) keys.add('dataKeys');
  return Array.from(keys);
}

function pickWarningOwner(warning, moduleOwnerIndex = new Map()) {
  const moduleCandidates = []
    .concat(
      warning.moduleId ? [warning.moduleId] : [],
      Array.isArray(warning.producers) ? warning.producers : [],
      Array.isArray(warning.consumers) ? warning.consumers : [],
      Array.isArray(warning.dataKeys) ? warning.dataKeys : [],
    )
    .filter(Boolean)
    .filter((moduleId, index, list) => list.indexOf(moduleId) === index);

  for (const moduleId of moduleCandidates) {
    const owner = moduleOwnerIndex.get(moduleId);
    if (owner) return owner;
  }
  return 'unassigned';
}

function parseJsonStringArray(rawValue, fallback = []) {
  if (typeof rawValue !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function pickFields(value, fields) {
  const output = {};
  const source = value || {};
  for (const field of fields) {
    output[field] = source[field];
  }
  return output;
}

function sanitizeExternalConnectionSummary(rawState) {
  if (!rawState || typeof rawState !== 'object') {
    return {
      ok: false,
      reason: 'external connection state unavailable',
      providerCount: 0,
      enabledCount: 0,
      providerStates: [],
    };
  }

  const providerStates = Array.isArray(rawState.providerStates)
    ? rawState.providerStates
      .map((entry) => ({
        provider: entry?.provider || '',
        connectionType: entry?.connectionType,
        status: entry?.status || 'unknown',
        environment: entry?.environment || 'unknown',
        isEnabled: Boolean(entry?.isEnabled),
      }))
      .filter((entry) => entry.provider.length > 0)
    : [];

  return pickFields(
    {
      ok: Boolean(rawState.ok),
      reason: rawState.reason || (rawState.ok ? 'loaded' : 'unknown'),
      providerCount: Number(rawState.providerCount || providerStates.length || 0),
      enabledCount: Number(rawState.enabledCount || providerStates.filter((entry) => entry.isEnabled).length || 0),
      providerStates,
    },
    EXTERNAL_CONNECTION_FIELDS,
  );
}

function sharedCatalog(moduleDataBus) {
  return moduleDataBus.dataCatalog
    .filter((item) => item.ownership.sharingKind === 'shared')
    .map((item) => pickSummaryFields(item, DATA_CATALOG_SUMMARY_FIELDS));
}

function sharedEdges(moduleDataBus, sharedDataCatalogKeys) {
  return moduleDataBus.edges
    .filter((edge) => sharedDataCatalogKeys.has(edge.dataKey))
    .map((edge) => pickSummaryFields(edge, EDGE_SUMMARY_FIELDS));
}

function shellModeAvailabilityForModule(module) {
  const availability = module.ready === true ? 'available' : 'not_ready';
  const gated = Array.isArray(module.approvalRequiredActions) && module.approvalRequiredActions.length > 0
    ? 'gated'
    : availability;
  return {
    personal: gated,
    demo: availability,
    market: availability,
  };
}

function shellEntryStatusForModule(module) {
  if (!module || module.ready == null) return 'unconnected';
  if (module.ready !== true) return 'not_ready';
  if (module.origin === 'external') return 'external';
  if (Array.isArray(module.approvalRequiredActions) && module.approvalRequiredActions.length > 0) return 'gated';
  return 'ready';
}

function shellEmptyStateForRoute(entryStatus) {
  if (entryStatus === 'unconnected') return 'module_not_connected';
  if (entryStatus === 'not_ready') return 'module_not_ready';
  if (entryStatus === 'external') return 'external_module';
  if (entryStatus === 'gated') return 'approval_required';
  return null;
}

function summarizeShellRoutesForPayload(routes = [], moduleIdSet = new Set()) {
  const routeList = Array.isArray(routes) ? routes : [];
  const modeAvailabilitySummary = {
    personal: { available: 0, hidden: 0, not_ready: 0, gated: 0 },
    demo: { available: 0, hidden: 0, not_ready: 0, gated: 0 },
    market: { available: 0, hidden: 0, not_ready: 0, gated: 0 },
  };
  const entryStatusSummary = {
    ready: 0,
    not_ready: 0,
    external: 0,
    unconnected: 0,
    contract_only: 0,
    gated: 0,
  };
  const knownModules = moduleIdSet.size > 0 ? moduleIdSet : new Set(routeList.map((route) => route?.moduleId));
  const warnings = [];

  for (const route of routeList) {
    const status = String(route.entryStatus || 'not_ready');
    const entrySummary = route.modeAvailability || {};
    for (const mode of SHELL_MODE_KEYS) {
      const modeAvailabilityValue = String(entrySummary[mode] || 'not_ready');
      if (modeAvailabilitySummary[mode][modeAvailabilityValue] != null) {
        modeAvailabilitySummary[mode][modeAvailabilityValue] += 1;
      }
    }
    if (SHELL_ENTRY_STATUS_VALUES.includes(status)) {
      entryStatusSummary[status] += 1;
    }
    if (route.moduleId && !knownModules.has(route.moduleId)) {
      warnings.push({
        warningKind: 'unknown_module_id',
        routeKey: route.routeKey,
        moduleId: route.moduleId,
        issue: 'shell route references module id missing from module registry',
      });
    }
    if (!Array.isArray(route.evidenceLinks) || route.evidenceLinks.length === 0) {
      warnings.push({
        warningKind: 'missing_evidence_link',
        routeKey: route.routeKey,
        issue: 'shell route has no evidence links',
      });
    }
  }

  return {
    routeCount: routeList.length,
    routeKeyCount: new Set(routeList.map((route) => route.routeKey)).size,
    readyRouteCount: routeList.filter((route) => route.entryStatus === 'ready').length,
    externalRouteCount: routeList.filter((route) => route.entryStatus === 'external').length,
    unconnectedRouteCount: routeList.filter((route) => route.entryStatus === 'unconnected').length,
    gatedRouteCount: routeList.filter((route) => Array.isArray(route.approvalGateKeys)
      && route.approvalGateKeys.length > 0).length,
    missingEvidenceRouteCount: routeList.filter((route) => !Array.isArray(route.evidenceLinks) || route.evidenceLinks.length === 0).length,
    modeAvailabilitySummary,
    entryStatusSummary,
    warningCount: warnings.length,
    warnings,
  };
}

function buildShellRoutesFromModules(modules = []) {
  const shellRoutes = modules.map((module) => {
    const entryStatus = shellEntryStatusForModule(module);
    return {
      routeKey: `${module.id}_open`,
      moduleId: module.id,
      label: {
        zh: module.name || module.id,
        en: module.nameEn || module.name || module.id,
      },
      modeAvailability: shellModeAvailabilityForModule(module),
      entryStatus,
      emptyStateKey: shellEmptyStateForRoute(entryStatus),
      requiredCapabilities: uniqueValues([
        ...((module.allowedActions || []).filter(Boolean)),
        ...((module.consumedData || []).filter(Boolean)),
      ]),
      approvalGateKeys: uniqueValues((module.approvalRequiredActions || []).filter(Boolean)),
      evidenceLinks: [
        { kind: 'module_manager', artifact: 'lib/portal/module-manager-core.mjs' },
        { kind: 'spec', artifact: 'outputs/2026-06-15-shell-route-contract-v0-spec.md' },
      ],
    };
  });

  const summary = summarizeShellRoutesForPayload(shellRoutes, new Set(modules.map((module) => module.id)));
  return { routes: shellRoutes, summary };
}

function buildShellRouteSnapshot(bus, modules) {
  const fallback = buildShellRoutesFromModules(modules);
  const dbRoutes = Array.isArray(bus.shellRoutes) ? bus.shellRoutes : [];
  const routes = dbRoutes.length > 0 ? dbRoutes : fallback.routes;
  const summary = bus.shellRouteSummary || summarizeShellRoutesForPayload(routes, new Set(modules.map((module) => module.id)));

  return {
    routes: routes.map((route) => pickSummaryFields(route, SHELL_ROUTE_FIELDS)),
    summary: pickSummaryFields(summary, [
      'routeCount',
      'routeKeyCount',
      'readyRouteCount',
      'externalRouteCount',
      'unconnectedRouteCount',
      'gatedRouteCount',
      'missingEvidenceRouteCount',
      'modeAvailabilitySummary',
      'entryStatusSummary',
      'warningCount',
      'warnings',
    ]),
  };
}

function buildFlowGraph(moduleDataBus) {
  const ownershipByKey = new Map(
    moduleDataBus.dataCatalog.map((item) => [item.dataKey, item.ownership?.sharingKind || 'inferred']),
  );

  const flowNodes = new Map();
  const flowEdges = [];

  for (const moduleEntry of moduleDataBus.modules) {
    flowNodes.set(moduleEntry.moduleId, {
      moduleId: moduleEntry.moduleId,
      mode: moduleEntry.mode,
      origin: moduleEntry.mode === 'external' ? 'external' : 'local',
      out: 0,
      in: 0,
    });
  }

  for (const edge of moduleDataBus.edges) {
    const edgeRisk = edge.risk || 'local_contract';
    const sharingKind = ownershipByKey.get(edge.dataKey) || 'inferred';
    const fromNode = flowNodes.get(edge.fromModuleId);
    const toNode = flowNodes.get(edge.toModuleId);
    if (fromNode) fromNode.out += 1;
    if (toNode) toNode.in += 1;

    flowEdges.push({
      fromModuleId: edge.fromModuleId,
      toModuleId: edge.toModuleId,
      dataKey: edge.dataKey,
      relation: edge.relation,
      risk: edgeRisk,
      sharingKind,
    });
  }

  return {
    generatedAt: moduleDataBus.generatedAt,
    nodes: Array.from(flowNodes.values()),
    edges: flowEdges,
    summary: {
      version: moduleDataBus.interconnectPlan.version,
      nodeCount: flowNodes.size,
      edgeCount: flowEdges.length,
      crossBoundaryEdgeCount: flowEdges.filter((edge) => edge.risk === 'cross_boundary').length,
      sharedDataKeyCount: Array.from(new Set(
        flowEdges.filter((edge) => edge.sharingKind === 'shared').map((edge) => edge.dataKey),
      )).size,
    },
  };
}

function buildPayloadFromStaticBus(
  format,
  moduleDataBus,
  shellRoutePayload,
  includeExternalConnectionSummary = false,
  moduleOwnerIndex = new Map(),
) {
  if (format === 'summary') {
    const sharedDataCatalog = sharedCatalog(moduleDataBus);
    const sharedDataCatalogKeys = new Set(sharedDataCatalog.map((item) => item.dataKey));
    const sharedDataEdges = sharedEdges(moduleDataBus, sharedDataCatalogKeys);
    const payload = {
      ok: true,
      source: 'registry_static',
      generatedAt: moduleDataBus.generatedAt,
      boundaries: {
        implementation: moduleDataBus.boundaries.implementation,
        readsRegistryMetadataOnly: true,
        readsArtifactFilesOnly: false,
        writesRealData: false,
      },
      modules: moduleDataBus.summary,
      sharedDataCatalog,
      sharedEdgeCount: sharedDataEdges.length,
      sharedEdges: sharedDataEdges,
      interconnectPlan: {
        version: moduleDataBus.interconnectPlan.version,
        criticalGapCount: moduleDataBus.interconnectPlan.criticalGapCount,
        connectionReadyKeyCount: moduleDataBus.interconnectPlan.connectionReadyKeyCount,
        missingLocalProducerCount: moduleDataBus.interconnectPlan.missingLocalProducerCount,
        orphanedProducerCount: moduleDataBus.interconnectPlan.orphanedProducerCount,
        priority: moduleDataBus.interconnectPlan.priority,
      },
      crossBoundarySummary: {
        externalToLocalEdgeCount: moduleDataBus.crossBoundarySummary.externalToLocalEdgeCount,
        localToExternalEdgeCount: moduleDataBus.crossBoundarySummary.localToExternalEdgeCount,
        externalToLocalEdges: moduleDataBus.crossBoundarySummary.externalToLocalEdges,
      },
      warningCount: moduleDataBus.warnings.length,
      warnings: filterSummaryWarnings(moduleDataBus.warnings, moduleOwnerIndex),
      shellRoutes: shellRoutePayload,
    };
    if (includeExternalConnectionSummary) {
      payload.externalConnectionSummary = sanitizeExternalConnectionSummary(loadExternalConnectionStateFromDb());
    }
    return pickFields(payload, SUMMARY_RESPONSE_WHITELIST);
  }

  return {
    ok: true,
    source: 'registry_static',
    generatedAt: moduleDataBus.generatedAt,
    boundaries: moduleDataBus.boundaries,
    moduleDataBus: {
      summary: moduleDataBus.summary,
      modules: moduleDataBus.modules,
      dataCatalog: moduleDataBus.dataCatalog,
      edges: moduleDataBus.edges,
      interconnectPlan: moduleDataBus.interconnectPlan,
      crossBoundarySummary: moduleDataBus.crossBoundarySummary,
      warnings: moduleDataBus.warnings,
    },
    shellRoutes: shellRoutePayload,
  };
}

function buildPayloadFromDbBus(
  format,
  moduleDataBus,
  shellRoutePayload,
  includeExternalConnectionSummary = false,
  moduleOwnerIndex = new Map(),
) {
  if (format === 'summary') {
    const sharedDataCatalog = sharedCatalog(moduleDataBus);
    const sharedDataCatalogKeys = new Set(sharedDataCatalog.map((item) => item.dataKey));
    const sharedDataEdges = sharedEdges(moduleDataBus, sharedDataCatalogKeys);
    const payload = {
      ok: true,
      source: 'sqlite_local',
      generatedAt: moduleDataBus.generatedAt,
      boundaries: {
        implementation: moduleDataBus.boundaries.implementation,
        readsRegistryMetadataOnly: false,
        readsArtifactFilesOnly: false,
        writesRealData: false,
        writesNotion: false,
        sendsNotifications: false,
        authorizesExternalServices: false,
        executesActions: false,
        productionDeploy: false,
      },
      modules: moduleDataBus.summary,
      moduleDataBus: {
        summary: moduleDataBus.summary,
        modules: moduleDataBus.modules,
        dataCatalog: moduleDataBus.dataCatalog,
        edges: moduleDataBus.edges,
        interconnectPlan: moduleDataBus.interconnectPlan,
        crossBoundarySummary: moduleDataBus.crossBoundarySummary,
        warnings: moduleDataBus.warnings,
      },
      sharedDataCatalog,
      sharedEdgeCount: sharedDataEdges.length,
      sharedEdges: sharedDataEdges,
      interconnectPlan: {
        version: moduleDataBus.interconnectPlan.version,
        criticalGapCount: moduleDataBus.interconnectPlan.criticalGapCount,
        connectionReadyKeyCount: moduleDataBus.interconnectPlan.connectionReadyKeyCount,
        missingLocalProducerCount: moduleDataBus.interconnectPlan.missingLocalProducerCount,
        orphanedProducerCount: moduleDataBus.interconnectPlan.orphanedProducerCount,
        priority: moduleDataBus.interconnectPlan.priority,
      },
      crossBoundarySummary: {
        externalToLocalEdgeCount: moduleDataBus.crossBoundarySummary.externalToLocalEdgeCount,
        localToExternalEdgeCount: moduleDataBus.crossBoundarySummary.localToExternalEdgeCount,
        externalToLocalEdges: moduleDataBus.crossBoundarySummary.externalToLocalEdges,
      },
      warningCount: moduleDataBus.warnings.length,
      warnings: filterSummaryWarnings(moduleDataBus.warnings, moduleOwnerIndex),
      shellRoutes: shellRoutePayload,
    };
    if (includeExternalConnectionSummary) {
      payload.externalConnectionSummary = sanitizeExternalConnectionSummary(loadExternalConnectionStateFromDb());
    }
    return pickFields(payload, SUMMARY_RESPONSE_WHITELIST);
  }

  return {
    ok: true,
    source: 'sqlite_local',
    generatedAt: moduleDataBus.generatedAt,
    boundaries: {
      implementation: moduleDataBus.boundaries.implementation,
      readsRegistryMetadataOnly: false,
      readsArtifactFilesOnly: false,
      writesRealData: false,
      writesNotion: false,
      sendsNotifications: false,
      authorizesExternalServices: false,
      executesActions: false,
      productionDeploy: false,
    },
    moduleDataBus: {
      summary: moduleDataBus.summary,
      modules: moduleDataBus.modules,
      dataCatalog: moduleDataBus.dataCatalog,
      edges: moduleDataBus.edges,
      interconnectPlan: moduleDataBus.interconnectPlan,
      crossBoundarySummary: moduleDataBus.crossBoundarySummary,
      warnings: moduleDataBus.warnings,
    },
    shellRoutes: shellRoutePayload,
  };
}

function filterSummaryWarnings(warnings, moduleOwnerIndex = new Map()) {
  return warnings
    .filter((warning) => (
      ['missing_data_producer', 'producer_without_consumer', 'module_dependency_missing_local_producer'].includes(warning.warningKind)
    ))
    .map((warning) => ({
      warningKind: warning.warningKind,
      dataKey: warning.dataKey,
      moduleId: warning.moduleId,
      issue: warning.issue,
      reason: warning.issue,
      owner: pickWarningOwner(warning, moduleOwnerIndex),
      evidenceFields: buildWarningEvidenceFields(warning),
    }));
}

function readPortalConfig() {
  const path = join(process.cwd(), 'public', 'portal-config.json');
  const content = readFileSync(path, 'utf8');
  return JSON.parse(content);
}

function loadOpsSnapshotRows() {
  const dbPath = currentDbPath();
  if (!existsSync(dbPath)) {
    return {
      ok: false,
      reason: `sqlite file not found: ${dbPath}`,
      payload: null,
    };
  }

  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });

    const needsCeoArtifacts = db.prepare(`
      SELECT
        artifact_id,
        artifact_path,
        title,
        owner,
        state,
        next_owner,
        next_step,
        resume_action,
        blocker,
        visibility_priority,
        source_verified,
        handoff_parsed,
        updated_at
      FROM artifact_record
      WHERE needs_ceo_gate = 1
      ORDER BY visibility_priority DESC, datetime(updated_at) DESC
    `).all();

    const handoffQueue = db.prepare(`
      SELECT
        h.handoff_id,
        h.artifact_path,
        h.artifact_title,
        h.from_agent,
        h.to_agents_json,
        h.status,
        h.next_owner,
        h.reason,
        h.blocker,
        h.needs_ceo_gate,
        h.source_verified,
        h.parsed_at,
        h.evidence_ref,
        a.state AS artifact_state,
        a.owner AS artifact_owner,
        a.title AS linked_artifact_title
      FROM handoff_record h
      JOIN artifact_record a
        ON a.artifact_id = h.artifact_id
      ORDER BY datetime(h.parsed_at) DESC, h.handoff_id ASC
    `).all();

    const gateQueue = db.prepare(`
      SELECT
        g.gate_id,
        g.artifact_id,
        g.category,
        g.status,
        g.owner,
        g.reason,
        g.blocker,
        g.needs_ceo_gate,
        g.qa_status,
        g.source_verified,
        g.evidence_ref,
        g.dedupe_key,
        g.updated_at,
        a.artifact_path,
        a.title AS artifact_title,
        a.owner AS artifact_owner,
        a.state AS artifact_state
      FROM gate_decision g
      JOIN artifact_record a
        ON a.artifact_id = g.artifact_id
      ORDER BY datetime(g.updated_at) DESC, g.gate_id ASC
    `).all();

    const events = db.prepare(`
      SELECT
        event_id,
        module_id,
        event_type,
        actor,
        payload_json,
        artifact_path,
        created_at
      FROM event_log
      ORDER BY datetime(created_at) DESC
      LIMIT 25
    `).all();

    const gateNeedsCeo = gateQueue.filter((entry) => entry.needs_ceo_gate).length;
    const gateStatusCount = new Map();
    for (const entry of gateQueue) {
      gateStatusCount.set(entry.status, (gateStatusCount.get(entry.status) || 0) + 1);
    }

    const handoffStatusCount = new Map();
    for (const entry of handoffQueue) {
      handoffStatusCount.set(entry.status, (handoffStatusCount.get(entry.status) || 0) + 1);
    }

    return {
      ok: true,
      payload: {
        artifactCount: needsCeoArtifacts.length,
        handoffCount: handoffQueue.length,
        handoffPendingCount: handoffQueue.filter((entry) => entry.status !== 'closed').length,
        handoffStatusCount: Object.fromEntries(handoffStatusCount),
        gateCount: gateQueue.length,
        gateNeedsCeo: gateNeedsCeo,
        gateStatusCount: Object.fromEntries(gateStatusCount),
        artifactsNeedingCeo: needsCeoArtifacts,
        handoffQueue,
        gateQueue,
        latestEvents: events,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'unknown sqlite read error',
      payload: null,
    };
  } finally {
    db?.close?.();
  }
}

function readOpsPageRowsFromDb(db, table, options = {}) {
  const whereClause = [];
  const { limit, offset } = normalizePaging(options.limit, options.offset);
  const cursor = decodePageCursor(options.cursor, table);
  const usesCursor = Boolean(cursor);
  const pageLimit = limit + 1;
  const pageOffset = usesCursor ? 0 : offset;

  if (table === 'artifacts') {
    if (typeof options.kind === 'string' && options.kind.trim()) {
      addWhereClause(whereClause, 'artifact_kind = ?', options.kind.trim());
    }
    if (typeof options.state === 'string' && options.state.trim()) {
      addWhereClause(whereClause, 'state = ?', options.state.trim());
    }
    if (typeof options.owner === 'string' && options.owner.trim()) {
      addWhereClause(whereClause, 'owner LIKE ?', normalizeLike(options.owner));
    }
    if (typeof options.search === 'string' && options.search.trim()) {
      const like = normalizeLike(options.search);
      whereClause.push({ sql: '(artifact_path LIKE ? OR title LIKE ?)', value: [like, like] });
    }

    const needsCeoGate = normalizeBooleanValue(options.needsCeo);
    if (needsCeoGate === true) whereClause.push({ sql: 'needs_ceo_gate = 1' });
    else if (needsCeoGate === false) whereClause.push({ sql: 'needs_ceo_gate = 0' });
    const countWhereClause = whereClause.slice();
    addCursorWhereClause(whereClause, table, cursor);

    const where = mapWhereClause(whereClause);
    const countWhere = mapWhereClause(countWhereClause);
    const listSql = `
      SELECT
        artifact_id,
        artifact_path,
        title,
        artifact_kind,
        owner,
        state,
        next_owner,
        next_step,
        resume_action,
        blocker,
        needs_ceo_gate,
        visibility_priority,
        source_verified,
        handoff_parsed,
        updated_at,
        created_at
      FROM artifact_record
      ${where}
      ORDER BY COALESCE(visibility_priority, 0) DESC, datetime(updated_at) DESC, artifact_id ASC
      ${buildPaginationSql(pageLimit, pageOffset)}
    `;
    const countSql = `SELECT COUNT(*) AS total FROM artifact_record${countWhere}`;

    const statementValues = whereClause.flatMap((entry) => entry.value || []);
    const countStatementValues = countWhereClause.flatMap((entry) => entry.value || []);

    const rows = db.prepare(listSql).all(...statementValues);
    const pageRows = rows.slice(0, limit);
    const totalRows = db.prepare(countSql).get(...countStatementValues);

    return {
      total: Number(totalRows?.total || 0),
      nextCursor: rows.length > limit ? cursorForLastRow(table, pageRows[pageRows.length - 1]) : null,
      items: pageRows.map((entry) => ({
        artifactId: entry.artifact_id,
        artifactPath: entry.artifact_path,
        title: entry.title,
        kind: entry.artifact_kind,
        owner: entry.owner,
        state: entry.state,
        nextOwner: entry.next_owner || null,
        nextStep: entry.next_step || null,
        resumeAction: entry.resume_action || null,
        blocker: entry.blocker || null,
        needsCeoGate: Boolean(entry.needs_ceo_gate),
        visibilityPriority: entry.visibility_priority || 0,
        sourceVerified: Boolean(entry.source_verified),
        handoffParsed: Boolean(entry.handoff_parsed),
        updatedAt: entry.updated_at,
        createdAt: entry.created_at,
      })),
    };
  }

  if (table === 'handoffs') {
    if (typeof options.artifactPath === 'string' && options.artifactPath.trim()) {
      addWhereClause(whereClause, 'h.artifact_path LIKE ?', normalizeLike(options.artifactPath));
    }
    if (typeof options.status === 'string' && options.status.trim()) {
      addWhereClause(whereClause, 'h.status = ?', options.status.trim());
    }
    if (typeof options.owner === 'string' && options.owner.trim()) {
      const like = normalizeLike(options.owner);
      whereClause.push({ sql: '(h.from_agent LIKE ? OR h.next_owner LIKE ?)', value: [like, like] });
    }

    const needsCeoGate = normalizeBooleanValue(options.needsCeo);
    if (needsCeoGate === true) whereClause.push({ sql: 'h.needs_ceo_gate = 1' });
    else if (needsCeoGate === false) whereClause.push({ sql: 'h.needs_ceo_gate = 0' });
    const countWhereClause = whereClause.slice();
    addCursorWhereClause(whereClause, table, cursor);

    const where = mapWhereClause(whereClause);
    const countWhere = mapWhereClause(countWhereClause);
    const listSql = `
      SELECT
        h.handoff_id,
        h.artifact_id,
        h.artifact_path,
        h.artifact_title,
        h.status,
        h.from_agent,
        h.to_agents_json,
        h.next_owner,
        h.reason,
        h.resume_action,
        h.blocker,
        h.needs_ceo_gate,
        h.source_verified,
        h.parsed_at,
        h.evidence_ref,
        a.state AS artifact_state,
        a.owner AS artifact_owner,
        a.title AS linked_artifact_title
      FROM handoff_record h
      JOIN artifact_record a
        ON a.artifact_id = h.artifact_id
      ${where}
      ORDER BY datetime(h.parsed_at) DESC, h.handoff_id ASC
      ${buildPaginationSql(pageLimit, pageOffset)}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM handoff_record h
      JOIN artifact_record a
        ON a.artifact_id = h.artifact_id
      ${countWhere}
    `;

    const statementValues = whereClause.flatMap((entry) => entry.value || []);
    const countStatementValues = countWhereClause.flatMap((entry) => entry.value || []);

    const rows = db.prepare(listSql).all(...statementValues);
    const pageRows = rows.slice(0, limit);
    const totalRows = db.prepare(countSql).get(...countStatementValues);

    return {
      total: Number(totalRows?.total || 0),
      nextCursor: rows.length > limit ? cursorForLastRow(table, pageRows[pageRows.length - 1]) : null,
      items: pageRows.map((entry) => ({
        handoffId: entry.handoff_id,
        artifactId: entry.artifact_id,
        artifactPath: entry.artifact_path,
        artifactTitle: entry.artifact_title,
        status: entry.status,
        fromAgent: entry.from_agent,
        toAgentsJson: entry.to_agents_json,
        nextOwner: entry.next_owner || null,
        reason: entry.reason || null,
        resumeAction: entry.resume_action || null,
        blocker: entry.blocker || null,
        needsCeoGate: Boolean(entry.needs_ceo_gate),
        sourceVerified: Boolean(entry.source_verified),
        parsedAt: entry.parsed_at,
        evidenceRef: entry.evidence_ref || null,
        artifactState: entry.artifact_state,
        artifactOwner: entry.artifact_owner,
        linkedArtifactTitle: entry.linked_artifact_title,
      })),
    };
  }

  if (table === 'gates') {
    if (typeof options.status === 'string' && options.status.trim()) {
      addWhereClause(whereClause, 'g.status = ?', options.status.trim());
    }
    if (typeof options.owner === 'string' && options.owner.trim()) {
      addWhereClause(whereClause, 'g.owner LIKE ?', normalizeLike(options.owner));
    }
    if (typeof options.category === 'string' && options.category.trim()) {
      addWhereClause(whereClause, 'g.category = ?', options.category.trim());
    }
    if (typeof options.artifactPath === 'string' && options.artifactPath.trim()) {
      addWhereClause(whereClause, 'a.artifact_path LIKE ?', normalizeLike(options.artifactPath));
    }

    const needsCeoGate = normalizeBooleanValue(options.needsCeo);
    if (needsCeoGate === true) whereClause.push({ sql: 'g.needs_ceo_gate = 1' });
    else if (needsCeoGate === false) whereClause.push({ sql: 'g.needs_ceo_gate = 0' });
    const countWhereClause = whereClause.slice();
    addCursorWhereClause(whereClause, table, cursor);

    const where = mapWhereClause(whereClause);
    const countWhere = mapWhereClause(countWhereClause);
    const listSql = `
      SELECT
        g.gate_id,
        g.artifact_id,
        g.category,
        g.status,
        g.owner,
        g.reason,
        g.blocker,
        g.needs_ceo_gate,
        g.qa_status,
        g.source_verified,
        g.evidence_ref,
        g.dedupe_key,
        g.updated_at,
        a.artifact_path,
        a.title AS artifact_title,
        a.owner AS artifact_owner,
        a.state AS artifact_state
      FROM gate_decision g
      JOIN artifact_record a
        ON a.artifact_id = g.artifact_id
      ${where}
      ORDER BY datetime(g.updated_at) DESC, g.gate_id ASC
      ${buildPaginationSql(pageLimit, pageOffset)}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM gate_decision g
      JOIN artifact_record a
        ON a.artifact_id = g.artifact_id
      ${countWhere}
    `;

    const statementValues = whereClause.flatMap((entry) => entry.value || []);
    const countStatementValues = countWhereClause.flatMap((entry) => entry.value || []);

    const rows = db.prepare(listSql).all(...statementValues);
    const pageRows = rows.slice(0, limit);
    const totalRows = db.prepare(countSql).get(...countStatementValues);

    return {
      total: Number(totalRows?.total || 0),
      nextCursor: rows.length > limit ? cursorForLastRow(table, pageRows[pageRows.length - 1]) : null,
      items: pageRows.map((entry) => ({
        gateId: entry.gate_id,
        artifactId: entry.artifact_id,
        category: entry.category,
        status: entry.status,
        owner: entry.owner,
        reason: entry.reason || null,
        blocker: entry.blocker || null,
        needsCeoGate: Boolean(entry.needs_ceo_gate),
        qaStatus: entry.qa_status || null,
        sourceVerified: Boolean(entry.source_verified),
        evidenceRef: entry.evidence_ref || null,
        dedupeKey: entry.dedupe_key,
        updatedAt: entry.updated_at,
        artifactPath: entry.artifact_path,
        artifactTitle: entry.artifact_title,
        artifactOwner: entry.artifact_owner,
        artifactState: entry.artifact_state,
      })),
    };
  }

  if (table === 'events') {
    if (typeof options.module === 'string' && options.module.trim()) {
      addWhereClause(whereClause, 'module_id = ?', options.module.trim());
    }
    if (typeof options.type === 'string' && options.type.trim()) {
      addWhereClause(whereClause, 'event_type = ?', options.type.trim());
    }
    if (typeof options.artifactPath === 'string' && options.artifactPath.trim()) {
      addWhereClause(whereClause, 'artifact_path LIKE ?', normalizeLike(options.artifactPath));
    }
    const countWhereClause = whereClause.slice();
    addCursorWhereClause(whereClause, table, cursor);

    const where = mapWhereClause(whereClause);
    const countWhere = mapWhereClause(countWhereClause);
    const listSql = `
      SELECT
        event_id,
        module_id,
        event_type,
        actor,
        payload_json,
        artifact_path,
        created_at
      FROM event_log
      ${where}
      ORDER BY datetime(created_at) DESC, event_id ASC
      ${buildPaginationSql(pageLimit, pageOffset)}
    `;
    const countSql = `SELECT COUNT(*) AS total FROM event_log${countWhere}`;
    const statementValues = whereClause.flatMap((entry) => entry.value || []);
    const countStatementValues = countWhereClause.flatMap((entry) => entry.value || []);

    const rows = db.prepare(listSql).all(...statementValues);
    const pageRows = rows.slice(0, limit);
    const totalRows = db.prepare(countSql).get(...countStatementValues);

    return {
      total: Number(totalRows?.total || 0),
      nextCursor: rows.length > limit ? cursorForLastRow(table, pageRows[pageRows.length - 1]) : null,
      items: pageRows.map((entry) => ({
        eventId: entry.event_id,
        moduleId: entry.module_id,
        eventType: entry.event_type,
        actor: entry.actor || null,
        payloadJson: entry.payload_json,
        artifactPath: entry.artifact_path,
        createdAt: entry.created_at,
      })),
    };
  }

  return null;
}

function getDecOpsPagePayload({
  table,
  options = {},
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  if (!table) {
    return {
      ok: false,
      implementation: 'ops-v0',
      reason: 'unsupported ops table',
    };
  }

  const normalizedLimit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : DEC_LIST_DEFAULT_LIMIT;
  const normalizedOffset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;
  const hasLimitParam = options.limit != null && String(options.limit).trim().length > 0;
  const hasOffsetParam = options.offset != null && String(options.offset).trim().length > 0;
  const hasCursorParam = options.cursor != null && String(options.cursor).trim().length > 0;
  const normalizedCursor = hasCursorParam ? String(options.cursor).trim() : null;
  const pagination = normalizePaging(normalizedLimit, normalizedOffset);
  const cacheKey = `${table}:page:${pagination.limit}:${pagination.offset}:cursor:${normalizedCursor || ''}:kind:${options.kind || ''}:state:${options.state || ''}:owner:${options.owner || ''}:status:${options.status || ''}:needs:${options.needsCeo || ''}:category:${options.category || ''}:search:${options.search || ''}`;

  const response = withCache(cacheKey, ttlMs, () => {
    const dbPath = currentDbPath();
    if (!existsSync(dbPath)) {
      return {
        ok: false,
        implementation: 'ops-v0',
        reason: `sqlite file not found: ${dbPath}`,
      };
    }

    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readonly: true });
      const result = readOpsPageRowsFromDb(db, table, {
        ...options,
        limit: pagination.limit,
        offset: pagination.offset,
      });

      if (!result) {
        return {
          ok: false,
          implementation: 'ops-v0',
          reason: `unsupported ops table: ${table}`,
        };
      }

      const totalPages = result.total > 0
        ? Math.ceil(result.total / pagination.limit)
        : 0;

      return {
        ok: true,
        implementation: 'ops-v0',
        generatedAt: new Date().toISOString(),
        table,
        boundaries: {
          implementation: 'ops-v0',
          readsRegistryMetadataOnly: false,
          readsArtifactFilesOnly: false,
          writesRealData: false,
          readsRealData: false,
        },
        page: {
          limit: pagination.limit,
          offset: hasCursorParam ? 0 : pagination.offset,
          total: result.total,
          totalPages,
          cursor: normalizedCursor,
          nextCursor: result.nextCursor || null,
          paginationStrategy: hasCursorParam ? 'cursor' : 'offset',
          hasMore: result.nextCursor ? true : pagination.offset + pagination.limit < result.total,
        },
        filters: {
          kind: options.kind || null,
          state: options.state || null,
          owner: options.owner || null,
          status: options.status || null,
          needsCeo: options.needsCeo == null ? null : options.needsCeo,
          category: options.category || null,
          search: options.search || null,
          artifactPath: options.artifactPath || null,
          module: options.module || null,
          type: options.type || null,
          cursor: normalizedCursor,
        },
        items: result.items,
      };
    } catch (error) {
      return {
        ok: false,
        implementation: 'ops-v0',
        reason: error instanceof Error ? error.message : 'unknown sqlite read error',
      };
    } finally {
      if (db) db.close();
    }
  }, force, {
    category: 'ops-page',
    signature: `table=${table};kind=${options.kind || ''};state=${options.state || ''};owner=${options.owner || ''};status=${options.status || ''};needs=${options.needsCeo || ''};category=${options.category || ''};search=${options.search || ''};artifactPath=${options.artifactPath || ''};module=${options.module || ''};type=${options.type || ''};hasPagination=${hasLimitParam || hasOffsetParam || hasCursorParam ? 1 : 0};cursor=${hasCursorParam ? 1 : 0}`,
    hasPaging: hasLimitParam || hasOffsetParam || hasCursorParam,
    hasLimitParam,
    hasOffsetParam,
  });

  return response;
}

function getModuleNetworkSnapshotCore(format = 'summary', includeFlow = false, includeExternalConnectionSummary = false) {
  const config = readPortalConfig();
  const core = buildModuleRegistry(config);
  const moduleOwnerIndex = buildModuleOwnerIndex(core.modules);
  const staticBus = buildModuleDataBus(core.modules, {
    generatedAt: new Date().toISOString(),
    mode: 'runtime_probe',
    experienceReservedData: [...(core.experienceServices?.reservedKeys?.consumedData || [])],
    dataKeyOwnership: core.dataKeyOwnership.keys,
  });

  const dbResult = loadModuleDataBusFromDb();
  const dbBus = dbResult.ok ? dbResult.moduleDataBus : null;
  const activeBus = dbBus || staticBus;
  const shellRoutePayload = buildShellRouteSnapshot(activeBus, core.modules);
  const contract = dbBus
    ? buildPayloadFromDbBus(format, activeBus, shellRoutePayload, includeExternalConnectionSummary, moduleOwnerIndex)
    : buildPayloadFromStaticBus(format, activeBus, shellRoutePayload, includeExternalConnectionSummary, moduleOwnerIndex);
  const flow = includeFlow ? buildFlowGraph(activeBus) : undefined;

  return {
    ok: true,
    implementation: MODULE_DATA_BUS_BOUNDARIES_V0.implementation,
    module: 'module-data-network-v0',
    generatedAt: activeBus.generatedAt,
    boundary: MODULE_DATA_BUS_BOUNDARIES_V0,
    contract,
    flow,
    warningCount: activeBus.warnings.length,
    warnings: format === 'full' ? activeBus.warnings : filterSummaryWarnings(activeBus.warnings, moduleOwnerIndex),
    sourceSummary: {
      provider: dbBus ? 'sqlite_local' : 'registry_static',
      dbBacked: Boolean(dbBus),
      dbEnabled: isDbBackedDataLayerEnabled(),
      fallbackReason: dbBus ? null : (dbResult.ok ? null : dbResult.reason),
    },
    _bus: {
      modules: activeBus.modules,
      shellRoutes: shellRoutePayload,
      warnings: activeBus.warnings,
    },
  };
}

export function getDecNetworkPayload({
  format = 'summary',
  includeFlow = false,
  includeExternalConnectionSummary = false,
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  const normalizedFormat = format === 'full' ? 'full' : 'summary';
  const cacheKey = `network:${normalizedFormat}:${includeFlow ? 'flow' : 'noflow'}:${includeExternalConnectionSummary ? 'ext' : 'noext'}`;
  return withCache(cacheKey, ttlMs, () => getModuleNetworkSnapshotCore(
    normalizedFormat,
    includeFlow,
    includeExternalConnectionSummary,
  ), force, {
    category: 'network',
    signature: `format=${normalizedFormat};flow=${includeFlow ? 1 : 0};external=${includeExternalConnectionSummary ? 1 : 0}`,
  });
}

export function getDecModulesPayload({
  format = 'summary',
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  const normalizedFormat = format === 'full' ? 'full' : 'summary';
  const cacheKey = `modules:${normalizedFormat}`;
  const response = withCache(cacheKey, ttlMs, () => {
    const network = getModuleNetworkSnapshotCore('full', false);
    const modules = network._bus?.modules || [];
    const shellRoutes = network._bus?.shellRoutes || { routes: [], summary: {} };
    const projectedModules = modules.map((entry) => ({
      moduleId: entry.moduleId,
      mode: entry.mode,
      ownedData: entry.ownedData || [],
      consumedData: entry.consumedData || [],
      emittedEvents: entry.emittedEvents || [],
      approvalRequiredActions: entry.approvalRequiredActions || [],
      dependencyCount: entry.dependencyCount,
    }));

    return {
      ok: true,
      implementation: MODULE_DATA_BUS_BOUNDARIES_V0.implementation,
      module: 'dec-modules-v0',
      generatedAt: network.generatedAt,
      source: network.sourceSummary.provider,
      summary: {
        moduleCount: projectedModules.length,
        routeCount: shellRoutes.summary?.routeCount || 0,
        readyRouteCount: shellRoutes.summary?.readyRouteCount || 0,
        externalRouteCount: shellRoutes.summary?.externalRouteCount || 0,
        unconnectedRouteCount: shellRoutes.summary?.unconnectedRouteCount || 0,
      },
      modules: normalizedFormat === 'full'
        ? projectedModules
        : projectedModules.map((module) => ({ moduleId: module.moduleId, mode: module.mode })),
      shellRoutes,
    };
  }, force, {
    category: 'modules',
    signature: `format=${normalizedFormat}`,
  });

  return response;
}

export function getDecExternalBridgePayload({
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  const cacheKey = 'external-bridge';
  return withCache(cacheKey, ttlMs, () => {
    const contract = loadExternalBridgeContract(process.cwd());
    const dbState = loadExternalConnectionStateFromDb();
    const stateMap = new Map(dbState.providerStates?.map((entry) => [entry.provider, entry]));
    const modules = (contract.modules || []).map((module) => ({
      ...module,
      dbConnection: stateMap.get(module.providerId) || null,
    }));

    return {
      ok: true,
      implementation: 'external-bridge-v0',
      generatedAt: contract.generatedAt,
      boundaries: {
        ...contract.boundaries,
        dbBacked: dbState.ok,
      },
      summary: contract.summary,
      modules,
      risk: contract.risk || [],
      handoffReady: contract.handoffReady || [],
      dbState,
    };
  }, force, {
    category: 'external',
    signature: 'default',
  });
}

export function getDecOpsPayload({
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  const cacheKey = 'ops-queue';
  return withCache(cacheKey, ttlMs, () => {
    const ops = loadOpsSnapshotRows();
    if (!ops.ok) {
      return {
        ok: false,
        implementation: 'ops-v0',
        reason: ops.reason || 'unknown data-layer issue',
      };
    }

    return {
      ok: true,
      implementation: 'ops-v0',
      generatedAt: new Date().toISOString(),
      boundaries: {
        implementation: 'ops-v0',
        readsRegistryMetadataOnly: false,
        readsArtifactFilesOnly: false,
        writesRealData: false,
        readsRealData: false,
      },
      counts: {
        needsCeoArtifactCount: ops.payload.artifactCount,
        handoffCount: ops.payload.handoffCount,
        handoffPendingCount: ops.payload.handoffPendingCount,
        gateCount: ops.payload.gateCount,
        needsCeoGateCount: ops.payload.gateNeedsCeo,
      },
      handoffStatusCount: ops.payload.handoffStatusCount,
      gateStatusCount: ops.payload.gateStatusCount,
      handoffQueue: ops.payload.handoffQueue,
      gateQueue: ops.payload.gateQueue,
      artifactsNeedingCeo: ops.payload.artifactsNeedingCeo,
      latestEvents: ops.payload.latestEvents,
    };
  }, force, {
    category: 'ops',
    signature: 'ops',
  });
}

/**
 * @param {{ category?: string; signature?: string; includeZero?: boolean; summary?: boolean; top?: number | string }} [options]
 */
export function getDecUsageMetricsPayload(options = {}) {
  const normalizedOptions = options && typeof options === 'object' ? options : {};
  return buildDecUsageMetricsPayload({
    category: normalizedOptions.category,
    signature: normalizedOptions.signature,
    includeZero: normalizedOptions.includeZero === true,
    summary: normalizedOptions.summary === true,
    top: normalizedOptions.top,
  });
}


export function getDecArtifactsPayload({
  options = {},
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  return getDecOpsPagePayload({
    table: 'artifacts',
    options,
    force,
    ttlMs,
  });
}

export function getDecHandoffsPayload({
  options = {},
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  return getDecOpsPagePayload({
    table: 'handoffs',
    options,
    force,
    ttlMs,
  });
}

export function getDecGatesPayload({
  options = {},
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  return getDecOpsPagePayload({
    table: 'gates',
    options,
    force,
    ttlMs,
  });
}

export function getDecEventsPayload({
  options = {},
  force = false,
  ttlMs = DEC_DATA_DEFAULT_CACHE_TTL_MS,
}) {
  return getDecOpsPagePayload({
    table: 'events',
    options,
    force,
    ttlMs,
  });
}
