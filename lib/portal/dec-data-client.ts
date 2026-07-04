/**
 * ⚠️ 命名消歧:本仓库有两个互不相关的 "DEC"。
 * 这里(dec-data-*)是 **运营数据目录**(ops/reporting 只读 API,
 * /api/data/v1/dec,类别: network/modules/artifacts/gates/metrics…)。
 * 它与 lib/intelligence/dec.ts 的 **Decision Engine**(PRD Ch.36 跨域
 * 推荐引擎)没有任何关系。详见 STATE.md 命名词典。
 */
export type DecCategory =
  | 'network'
  | 'modules'
  | 'external'
  | 'ops'
  | 'artifacts'
  | 'handoffs'
  | 'gates'
  | 'events'
  | 'metrics';

export interface DecCatalogItem {
  category: DecCategory;
  path: string;
  intent: string[];
  query: string[];
  returns: string[];
  readOnly: boolean;
}

export interface DecAccessBoundary {
  implementation: string;
  mode: string;
  authProvider: string;
  readsOnly: boolean;
  allowsFrontendDirectDb: boolean;
  writesRealData: boolean;
  writesNotion: boolean;
  authorizesExternalServices: boolean;
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
    enforced: boolean;
    scope: string;
  };
  allowedRoles?: string[];
}

export interface DecCatalogResponse {
  ok: true;
  generatedAt: string;
  implementation: string;
  basePath: string;
  requestPattern: string;
  paging?: {
    defaultLimit: number;
    maxLimit: number;
    maxOffset: number;
    preferredStrategy: string;
    cursorSupportedCategories: DecCategory[];
  };
  accessBoundary?: DecAccessBoundary;
  boundaries: {
    readsRealData: boolean;
    writesRealData: boolean;
    writesNotion: boolean;
    sendsNotifications: boolean;
    authorizesExternalServices: boolean;
    executesActions: boolean;
    productionDeploy: boolean;
  };
  categories: DecCatalogItem[];
}

export interface DecCatalogFailureResponse {
  ok: false;
  reason: string;
}

type DecOpsTable = 'artifacts' | 'handoffs' | 'gates' | 'events';
type DecFormat = 'summary' | 'full';

export interface DecFailureResponse {
  ok: false;
  category: DecCategory;
  reason: string;
  error?: string;
  supported?: DecCategory[];
  requested?: string;
}

export interface DecBaseResponse {
  ok: true;
  generatedAt: string;
  implementation?: string;
  module?: string;
}

export interface DecShellRouteSummary {
  routeCount: number;
  routeKeyCount?: number;
  readyRouteCount: number;
  externalRouteCount: number;
  unconnectedRouteCount: number;
  gatedRouteCount?: number;
  missingEvidenceRouteCount?: number;
}

export interface DecModulesPayloadItem {
  moduleId: string;
  mode: string;
  ownedData?: string[];
  consumedData?: string[];
  emittedEvents?: string[];
  approvalRequiredActions?: string[];
  dependencyCount?: number;
}

export interface DecModulesPayloadShellRoutes {
  routes: Array<Record<string, unknown>>;
  summary: DecShellRouteSummary;
  source?: string;
}

export interface DecModulesSummary {
  moduleCount: number;
  routeCount: number;
  readyRouteCount: number;
  externalRouteCount: number;
  unconnectedRouteCount: number;
  modulesWithApprovalActionCount?: number;
}

export interface DecModulesPayload extends DecBaseResponse {
  source: 'registry_static' | 'sqlite_local';
  summary: DecModulesSummary;
  modules: DecModulesPayloadItem[];
  shellRoutes: DecModulesPayloadShellRoutes;
}

export type DecModulesResponse = DecModulesPayload | DecFailureResponse;

export interface DecArtifactPayloadItem extends Record<string, unknown> {
  artifactId: string;
  artifactPath: string;
  title: string;
  kind: string;
  owner: string;
  state: string;
  nextOwner: string | null;
  nextStep: string | null;
  resumeAction: string | null;
  blocker: string | null;
  needsCeoGate: boolean;
  visibilityPriority: number;
  sourceVerified: boolean;
  handoffParsed: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface DecHandoffPayloadItem extends Record<string, unknown> {
  handoffId: string;
  artifactId: string;
  artifactPath: string;
  artifactTitle: string;
  status: string;
  fromAgent: string;
  toAgentsJson: string;
  nextOwner: string | null;
  reason: string | null;
  resumeAction: string | null;
  blocker: string | null;
  needsCeoGate: boolean;
  sourceVerified: boolean;
  parsedAt: string;
  evidenceRef: string | null;
  artifactState: string;
  artifactOwner: string;
  linkedArtifactTitle: string;
}

export interface DecGatePayloadItem extends Record<string, unknown> {
  gateId: string;
  artifactId: string;
  category: string;
  status: string;
  owner: string;
  reason: string | null;
  blocker: string | null;
  needsCeoGate: boolean;
  qaStatus: string | null;
  sourceVerified: boolean;
  evidenceRef: string | null;
  dedupeKey: string;
  updatedAt: string;
  artifactPath: string;
  artifactTitle: string;
  artifactOwner: string;
  artifactState: string;
}

export interface DecEventPayloadItem extends Record<string, unknown> {
  eventId: string;
  moduleId: string | null;
  eventType: string;
  actor: string | null;
  payloadJson: string;
  artifactPath: string | null;
  createdAt: string;
}

export interface DecUsageMetric {
  category: string;
  signature: string;
  calls: number;
  errors: number;
  cacheHit: number;
  cacheMiss: number;
  cacheRefresh: number;
  cacheStale: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  lastLatencyMs: number;
  pagingRequests: number;
  pagingLimitRequests: number;
  pagingOffsetRequests: number;
  firstAt: string;
  lastAt: string;
}

export interface DecUsageMetricByCategorySummary {
  category: string;
  calls: number;
  errors: number;
  cacheHitRate: number;
  errorRate: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  totalPagingRequests: number;
}

export interface DecUsageMetricBySignatureSummary {
  category: string;
  signature: string;
  calls: number;
  errors: number;
  cacheHitRate: number;
  errorRate: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  pagingRequests: number;
}

export interface DecUsageMetricsResponse {
  ok: true;
  generatedAt: string;
  implementation: string;
  summary: {
    metricCount: number;
    totalCalls: number;
    totalErrors: number;
    totalCacheHit: number;
    totalCacheMiss: number;
    totalCacheRefresh: number;
    totalCacheStale: number;
    byCategory?: DecUsageMetricByCategorySummary[];
    bySignature?: DecUsageMetricBySignatureSummary[];
    topByCalls?: DecUsageMetricBySignatureSummary[];
    topByErrorRate?: DecUsageMetricBySignatureSummary[];
    totalCategories?: number;
    totalSignatures?: number;
  };
  metrics: DecUsageMetric[];
  boundaries?: Record<string, unknown>;
}

export interface DecOpsPage {
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  cursor?: string | null;
  nextCursor?: string | null;
  paginationStrategy?: 'offset' | 'cursor' | string;
}

export interface DecOpsPayload<T extends Record<string, unknown>> extends DecBaseResponse {
  implementation: string;
  table: DecOpsTable;
  page: DecOpsPage;
  filters: Record<string, unknown>;
  items: T[];
}

export type DecArtifactPayload = DecOpsPayload<DecArtifactPayloadItem> | DecFailureResponse;
export type DecHandoffPayload = DecOpsPayload<DecHandoffPayloadItem> | DecFailureResponse;
export type DecGatePayload = DecOpsPayload<DecGatePayloadItem> | DecFailureResponse;
export type DecEventPayload = DecOpsPayload<DecEventPayloadItem> | DecFailureResponse;

interface FetchDecOptions {
  ttl?: number;
  force?: boolean;
  format?: DecFormat;
  signature?: string;
  includeZero?: boolean;
  summary?: boolean;
  top?: number | string;
}

interface FetchDecOpsOptions extends FetchDecOptions {
  limit?: number | string;
  offset?: number | string;
  cursor?: string;
  kind?: string;
  state?: string;
  owner?: string;
  status?: string;
  needsCeo?: boolean | string;
  category?: string;
  search?: string;
  artifactPath?: string;
  module?: string;
  type?: string;
}

const SUPPORTED_CATEGORY_SET: ReadonlySet<DecCategory> = new Set<DecCategory>([
  'network',
  'modules',
  'external',
  'ops',
  'artifacts',
  'handoffs',
  'gates',
  'events',
  'metrics',
]);

const DEC_BASE_PATH = '/api/data/v1/dec';

function normalizeCategory(value: unknown): DecCategory | null {
  if (typeof value !== 'string') return null;
  return SUPPORTED_CATEGORY_SET.has(value as DecCategory) ? (value as DecCategory) : null;
}

function safeReadString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeReadNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeReadBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false;
  }
  return undefined;
}

function normalizeAccessBoundary(value: unknown): DecAccessBoundary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const rateLimit = source.rateLimit && typeof source.rateLimit === 'object' && !Array.isArray(source.rateLimit)
    ? (source.rateLimit as Record<string, unknown>)
    : null;
  return {
    implementation: safeReadString(source.implementation) || 'dec-access-boundary-v0',
    mode: safeReadString(source.mode) || 'local-advisory',
    authProvider: safeReadString(source.authProvider) || 'none',
    readsOnly: safeReadBoolean(source.readsOnly) !== false,
    allowsFrontendDirectDb: safeReadBoolean(source.allowsFrontendDirectDb) === true,
    writesRealData: safeReadBoolean(source.writesRealData) === true,
    writesNotion: safeReadBoolean(source.writesNotion) === true,
    authorizesExternalServices: safeReadBoolean(source.authorizesExternalServices) === true,
    rateLimit: rateLimit
      ? {
        windowMs: safeReadNumber(rateLimit.windowMs),
        maxRequests: safeReadNumber(rateLimit.maxRequests),
        enforced: safeReadBoolean(rateLimit.enforced) === true,
        scope: safeReadString(rateLimit.scope) || '',
      }
      : undefined,
    allowedRoles: Array.isArray(source.allowedRoles)
      ? source.allowedRoles.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  };
}

function safeReadModulesArray(value: unknown): DecModulesPayloadItem[] {
  if (!Array.isArray(value)) return [];
  const normalized: DecModulesPayloadItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const safeEntry = entry as Record<string, unknown>;

    const moduleId = safeReadString(safeEntry.moduleId) || '';
    const mode = safeReadString(safeEntry.mode) || '';
    if (!moduleId || !mode) continue;

    const ownedData = Array.isArray(safeEntry.ownedData)
      ? safeEntry.ownedData.filter((item: unknown) => typeof item === 'string') as string[]
      : [];
    const consumedData = Array.isArray(safeEntry.consumedData)
      ? safeEntry.consumedData.filter((item: unknown) => typeof item === 'string') as string[]
      : [];
    const emittedEvents = Array.isArray(safeEntry.emittedEvents)
      ? safeEntry.emittedEvents.filter((item: unknown) => typeof item === 'string') as string[]
      : [];
    const approvalRequiredActions = Array.isArray(safeEntry.approvalRequiredActions)
      ? safeEntry.approvalRequiredActions.filter((item: unknown) => typeof item === 'string') as string[]
      : [];

    normalized.push({
      moduleId,
      mode,
      ownedData,
      consumedData,
      emittedEvents,
      approvalRequiredActions,
      dependencyCount: safeReadNumber(safeEntry.dependencyCount),
    });
  }
  return normalized;
}

function normalizeShellRoutes(value: unknown): DecModulesPayload['shellRoutes'] {
  const payload = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const summary = payload.summary && typeof payload.summary === 'object'
    ? (payload.summary as Record<string, unknown>)
    : {};
  return {
    routes: Array.isArray(payload.routes) ? payload.routes as Array<Record<string, unknown>> : [],
    source: safeReadString(payload.source),
    summary: {
      routeCount: safeReadNumber(summary.routeCount),
      routeKeyCount: summary.routeKeyCount != null ? safeReadNumber(summary.routeKeyCount) : undefined,
      readyRouteCount: safeReadNumber(summary.readyRouteCount),
      externalRouteCount: safeReadNumber(summary.externalRouteCount),
      unconnectedRouteCount: safeReadNumber(summary.unconnectedRouteCount),
      gatedRouteCount: summary.gatedRouteCount != null ? safeReadNumber(summary.gatedRouteCount) : undefined,
      missingEvidenceRouteCount: summary.missingEvidenceRouteCount != null
        ? safeReadNumber(summary.missingEvidenceRouteCount)
        : undefined,
    },
  };
}

function appendQueryParam(params: URLSearchParams, key: string, value: unknown) {
  if (value == null || value === false) return;
  const normalized = typeof value === 'string' ? value.trim() : String(value);
  if (!normalized) return;
  params.set(key, normalized);
}

function isDecOpsTable(category: DecCategory): category is DecOpsTable {
  return category === 'artifacts' || category === 'handoffs' || category === 'gates' || category === 'events';
}

export function buildDecPayloadPath(category: DecCategory, options: FetchDecOptions = {}): string {
  const params = new URLSearchParams();
  const format = options.format || 'summary';
  params.set('format', format);
  if (options.force) params.set('force', '1');
  if (typeof options.ttl === 'number' && Number.isFinite(options.ttl) && options.ttl > 500) {
    params.set('ttl', String(Math.floor(options.ttl)));
  }
  appendQueryParam(params, 'signature', options.signature);
  if (options.includeZero) params.set('includeZero', '1');
  if (options.summary) params.set('summary', '1');
  appendQueryParam(params, 'top', options.top);
  const query = params.toString();
  return `${DEC_BASE_PATH}/${category}${query ? `?${query}` : ''}`;
}

function buildDecOpsPayloadPath(category: DecOpsTable, options: FetchDecOpsOptions = {}): string {
  const base = new URLSearchParams();
  if (typeof options.ttl === 'number' && Number.isFinite(options.ttl) && options.ttl > 500) {
    base.set('ttl', String(Math.floor(options.ttl)));
  }
  if (options.force) base.set('force', '1');
  base.set('format', 'full');

  appendQueryParam(base, 'limit', options.limit);
  appendQueryParam(base, 'offset', options.offset);
  appendQueryParam(base, 'cursor', options.cursor);
  appendQueryParam(base, 'kind', options.kind);
  appendQueryParam(base, 'state', options.state);
  appendQueryParam(base, 'owner', options.owner);
  appendQueryParam(base, 'status', options.status);
  appendQueryParam(base, 'category', options.category);
  appendQueryParam(base, 'search', options.search);
  appendQueryParam(base, 'artifactPath', options.artifactPath);
  appendQueryParam(base, 'module', options.module);
  appendQueryParam(base, 'eventType', options.type);
  const needsCeo = safeReadBoolean(options.needsCeo);
  if (needsCeo !== undefined) base.set('needsCeo', needsCeo ? '1' : '0');

  const query = base.toString();
  return `${DEC_BASE_PATH}/${category}${query ? `?${query}` : ''}`;
}

async function requestDecPayload<T>(category: DecCategory, options: FetchDecOptions | FetchDecOpsOptions = {}): Promise<T> {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error(`Unsupported DEC category: ${String(category)}`);
  }
  const shouldUseOpsPath = isDecOpsTable(normalizedCategory);

  const queryUrl = shouldUseOpsPath
    ? buildDecOpsPayloadPath(normalizedCategory, options as FetchDecOpsOptions)
    : buildDecPayloadPath(normalizedCategory, options as FetchDecOptions);

  const response = await fetch(queryUrl, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const reason = await response.text().catch(() => response.statusText);
    throw new Error(`DEC payload request failed (${response.status} ${response.statusText}): ${reason}`);
  }
  return (await response.json()) as T;
}

export function readDecDataError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error) return 'Unknown DEC error';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) {
    const message = safeReadString((error as Record<string, unknown>).message);
    if (message) return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function safeFetchDecPayload<T>(category: DecCategory, options: FetchDecOptions = {}): Promise<T | null> {
  try {
    return await requestDecPayload<T>(category, options);
  } catch (error) {
    console.error(`Safe DEC fetch failed (${category}):`, readDecDataError(error));
    return null;
  }
}

function parseDecModulesPayload(raw: unknown): DecModulesResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      category: 'modules',
      reason: 'DEC modules payload parse error',
    };
  }
  const source = raw as Record<string, unknown>;
  if (source.ok === false) {
    return {
      ok: false,
      category: 'modules',
      reason: safeReadString(source.reason) || 'DEC modules returned an error response',
      error: safeReadString(source.error),
      supported: Array.isArray(source.supported) ? source.supported as DecCategory[] : undefined,
      requested: safeReadString(source.requested),
    };
  }

  if (source.ok !== true) {
    return {
      ok: false,
      category: 'modules',
      reason: 'DEC payload missing ok flag',
    };
  }

  const summary = source.summary && typeof source.summary === 'object'
    ? (source.summary as Record<string, unknown>)
    : {};

  return {
    ok: true,
    generatedAt: safeReadString(source.generatedAt) || new Date().toISOString(),
    implementation: safeReadString(source.implementation) || undefined,
    module: safeReadString(source.module) || 'dec-modules-v0',
    source: (safeReadString(source.source) as DecModulesPayload['source']) || 'registry_static',
    summary: {
      moduleCount: safeReadNumber(summary.moduleCount),
      routeCount: safeReadNumber(summary.routeCount),
      readyRouteCount: safeReadNumber(summary.readyRouteCount),
      externalRouteCount: safeReadNumber(summary.externalRouteCount),
      unconnectedRouteCount: safeReadNumber(summary.unconnectedRouteCount),
      modulesWithApprovalActionCount: summary.modulesWithApprovalActionCount != null
        ? safeReadNumber(summary.modulesWithApprovalActionCount)
        : undefined,
    },
    modules: safeReadModulesArray(source.modules),
    shellRoutes: normalizeShellRoutes(source.shellRoutes),
  };
}

function parseDecOpsPayload<T extends Record<string, unknown>>(
  table: DecOpsTable,
  raw: unknown,
  itemParser: (item: unknown) => T,
): DecOpsPayload<T> | DecFailureResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      category: table,
      reason: `DEC ${table} payload parse error`,
    };
  }
  const source = raw as Record<string, unknown>;
  if (source.ok === false) {
    return {
      ok: false,
      category: table,
      reason: safeReadString(source.reason) || `DEC ${table} returned an error response`,
      error: safeReadString(source.error),
      supported: Array.isArray(source.supported) ? source.supported as DecCategory[] : undefined,
      requested: safeReadString(source.requested),
    };
  }
  if (source.ok !== true) {
    return {
      ok: false,
      category: table,
      reason: `DEC ${table} payload missing ok flag`,
    };
  }

  const page = (source.page && typeof source.page === 'object')
    ? (source.page as Record<string, unknown>)
    : {};
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    ok: true,
    generatedAt: safeReadString(source.generatedAt) || new Date().toISOString(),
    implementation: safeReadString(source.implementation) || 'ops-v0',
    table: (safeReadString(source.table) as DecOpsTable) || table,
    page: {
      limit: safeReadNumber(page.limit),
      offset: safeReadNumber(page.offset),
      total: safeReadNumber(page.total),
      totalPages: safeReadNumber(page.totalPages),
      hasMore: page.hasMore === true,
      cursor: page.cursor == null ? null : safeReadString(page.cursor) || null,
      nextCursor: page.nextCursor == null ? null : safeReadString(page.nextCursor) || null,
      paginationStrategy: safeReadString(page.paginationStrategy),
    },
    filters: typeof source.filters === 'object' && source.filters != null
      ? (source.filters as Record<string, unknown>)
      : {},
    items: items.map((entry) => itemParser(entry)),
  };
}

function parseDecMetricsPayload(raw: unknown): DecUsageMetricsResponse | DecFailureResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      category: 'metrics',
      reason: 'DEC metrics payload parse error',
    };
  }
  const source = raw as Record<string, unknown>;
  if (source.ok === false) {
    return {
      ok: false,
      category: 'metrics',
      reason: safeReadString(source.reason) || 'DEC metrics returned an error response',
      error: safeReadString(source.error),
      supported: Array.isArray(source.supported) ? source.supported as DecCategory[] : undefined,
      requested: safeReadString(source.requested),
    };
  }
  if (source.ok !== true) {
    return {
      ok: false,
      category: 'metrics',
      reason: 'DEC metrics payload missing ok flag',
    };
  }

  const summary = source.summary && typeof source.summary === 'object'
    ? (source.summary as Record<string, unknown>)
    : {};

  const parseSummaryCategoryRows = (value: unknown): DecUsageMetricByCategorySummary[] => {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        category: safeReadString(row.category) || '',
        calls: safeReadNumber(row.calls),
        errors: safeReadNumber(row.errors),
        cacheHitRate: safeReadNumber(row.cacheHitRate),
        errorRate: safeReadNumber(row.errorRate),
        avgLatencyMs: safeReadNumber(row.avgLatencyMs),
        minLatencyMs: safeReadNumber(row.minLatencyMs),
        maxLatencyMs: safeReadNumber(row.maxLatencyMs),
        totalPagingRequests: safeReadNumber(row.totalPagingRequests),
      };
    });
  };

  const parseSummarySignatureRows = (value: unknown): DecUsageMetricBySignatureSummary[] => {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        category: safeReadString(row.category) || '',
        signature: safeReadString(row.signature) || '',
        calls: safeReadNumber(row.calls),
        errors: safeReadNumber(row.errors),
        cacheHitRate: safeReadNumber(row.cacheHitRate),
        errorRate: safeReadNumber(row.errorRate),
        avgLatencyMs: safeReadNumber(row.avgLatencyMs),
        minLatencyMs: safeReadNumber(row.minLatencyMs),
        maxLatencyMs: safeReadNumber(row.maxLatencyMs),
        pagingRequests: safeReadNumber(row.pagingRequests),
      };
    });
  };

  const rawMetrics = Array.isArray(source.metrics) ? source.metrics : [];
  const metrics = rawMetrics.map((entry) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      category: safeReadString(item.category) || '',
      signature: safeReadString(item.signature) || '',
      calls: safeReadNumber(item.calls),
      errors: safeReadNumber(item.errors),
      cacheHit: safeReadNumber(item.cacheHit),
      cacheMiss: safeReadNumber(item.cacheMiss),
      cacheRefresh: safeReadNumber(item.cacheRefresh),
      cacheStale: safeReadNumber(item.cacheStale),
      avgLatencyMs: safeReadNumber(item.avgLatencyMs),
      minLatencyMs: safeReadNumber(item.minLatencyMs),
      maxLatencyMs: safeReadNumber(item.maxLatencyMs),
      lastLatencyMs: safeReadNumber(item.lastLatencyMs),
      pagingRequests: safeReadNumber(item.pagingRequests),
      pagingLimitRequests: safeReadNumber(item.pagingLimitRequests),
      pagingOffsetRequests: safeReadNumber(item.pagingOffsetRequests),
      firstAt: safeReadString(item.firstAt) || new Date().toISOString(),
      lastAt: safeReadString(item.lastAt) || new Date().toISOString(),
    };
  });

  return {
    ok: true,
    generatedAt: safeReadString(source.generatedAt) || new Date().toISOString(),
    implementation: safeReadString(source.implementation) || 'dec-metrics-v0',
    summary: {
      metricCount: safeReadNumber(summary.metricCount),
      totalCalls: safeReadNumber(summary.totalCalls),
      totalErrors: safeReadNumber(summary.totalErrors),
      totalCacheHit: safeReadNumber(summary.totalCacheHit),
      totalCacheMiss: safeReadNumber(summary.totalCacheMiss),
      totalCacheRefresh: safeReadNumber(summary.totalCacheRefresh),
      totalCacheStale: safeReadNumber(summary.totalCacheStale),
      byCategory: parseSummaryCategoryRows(summary.byCategory),
      bySignature: parseSummarySignatureRows(summary.bySignature),
      topByCalls: parseSummarySignatureRows(summary.topByCalls),
      topByErrorRate: parseSummarySignatureRows(summary.topByErrorRate),
      totalCategories: safeReadNumber(summary.totalCategories),
      totalSignatures: safeReadNumber(summary.totalSignatures),
    },
    metrics,
    boundaries: typeof source.boundaries === 'object' && source.boundaries != null
      ? (source.boundaries as Record<string, unknown>)
      : undefined,
  };
}

function parseArtifactPayloadItem(value: unknown): DecArtifactPayloadItem {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    artifactId: safeReadString(source.artifactId) || '',
    artifactPath: safeReadString(source.artifactPath) || '',
    title: safeReadString(source.title) || '',
    kind: safeReadString(source.kind) || '',
    owner: safeReadString(source.owner) || '',
    state: safeReadString(source.state) || '',
    nextOwner: source.nextOwner == null ? null : safeReadString(source.nextOwner) || null,
    nextStep: source.nextStep == null ? null : safeReadString(source.nextStep) || null,
    resumeAction: source.resumeAction == null ? null : safeReadString(source.resumeAction) || null,
    blocker: source.blocker == null ? null : safeReadString(source.blocker) || null,
    needsCeoGate: safeReadBoolean(source.needsCeoGate) || false,
    visibilityPriority: safeReadNumber(source.visibilityPriority),
    sourceVerified: safeReadBoolean(source.sourceVerified) || false,
    handoffParsed: safeReadBoolean(source.handoffParsed) || false,
    updatedAt: safeReadString(source.updatedAt) || '',
    createdAt: safeReadString(source.createdAt) || '',
  };
}

function parseHandoffPayloadItem(value: unknown): DecHandoffPayloadItem {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    handoffId: safeReadString(source.handoffId) || '',
    artifactId: safeReadString(source.artifactId) || '',
    artifactPath: safeReadString(source.artifactPath) || '',
    artifactTitle: safeReadString(source.artifactTitle) || '',
    status: safeReadString(source.status) || '',
    fromAgent: safeReadString(source.fromAgent) || '',
    toAgentsJson: safeReadString(source.toAgentsJson) || '',
    nextOwner: source.nextOwner == null ? null : safeReadString(source.nextOwner) || null,
    reason: source.reason == null ? null : safeReadString(source.reason) || null,
    resumeAction: source.resumeAction == null ? null : safeReadString(source.resumeAction) || null,
    blocker: source.blocker == null ? null : safeReadString(source.blocker) || null,
    needsCeoGate: safeReadBoolean(source.needsCeoGate) || false,
    sourceVerified: safeReadBoolean(source.sourceVerified) || false,
    parsedAt: safeReadString(source.parsedAt) || '',
    evidenceRef: source.evidenceRef == null ? null : safeReadString(source.evidenceRef) || null,
    artifactState: safeReadString(source.artifactState) || '',
    artifactOwner: safeReadString(source.artifactOwner) || '',
    linkedArtifactTitle: safeReadString(source.linkedArtifactTitle) || '',
  };
}

function parseGatePayloadItem(value: unknown): DecGatePayloadItem {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    gateId: safeReadString(source.gateId) || '',
    artifactId: safeReadString(source.artifactId) || '',
    category: safeReadString(source.category) || '',
    status: safeReadString(source.status) || '',
    owner: safeReadString(source.owner) || '',
    reason: source.reason == null ? null : safeReadString(source.reason) || null,
    blocker: source.blocker == null ? null : safeReadString(source.blocker) || null,
    needsCeoGate: safeReadBoolean(source.needsCeoGate) || false,
    qaStatus: source.qaStatus == null ? null : safeReadString(source.qaStatus) || null,
    sourceVerified: safeReadBoolean(source.sourceVerified) || false,
    evidenceRef: source.evidenceRef == null ? null : safeReadString(source.evidenceRef) || null,
    dedupeKey: safeReadString(source.dedupeKey) || '',
    updatedAt: safeReadString(source.updatedAt) || '',
    artifactPath: safeReadString(source.artifactPath) || '',
    artifactTitle: safeReadString(source.artifactTitle) || '',
    artifactOwner: safeReadString(source.artifactOwner) || '',
    artifactState: safeReadString(source.artifactState) || '',
  };
}

function parseEventPayloadItem(value: unknown): DecEventPayloadItem {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    eventId: safeReadString(source.eventId) || '',
    moduleId: source.moduleId == null ? null : safeReadString(source.moduleId) ?? null,
    eventType: safeReadString(source.eventType) || '',
    actor: source.actor == null ? null : safeReadString(source.actor) || null,
    payloadJson: safeReadString(source.payloadJson) || '{}',
    artifactPath: source.artifactPath == null ? null : safeReadString(source.artifactPath) || null,
    createdAt: safeReadString(source.createdAt) || '',
  };
}

export async function fetchDecModules(options: FetchDecOptions = {}): Promise<DecModulesResponse> {
  const payload = await requestDecPayload<unknown>('modules', {
    format: 'full',
    ...options,
  });
  return parseDecModulesPayload(payload);
}

export async function fetchDecArtifacts(options: FetchDecOpsOptions = {}): Promise<DecArtifactPayload> {
  const payload = await requestDecPayload<unknown>('artifacts', options);
  return parseDecOpsPayload('artifacts', payload, parseArtifactPayloadItem);
}

export async function fetchDecHandoffs(options: FetchDecOpsOptions = {}): Promise<DecHandoffPayload> {
  const payload = await requestDecPayload<unknown>('handoffs', options);
  return parseDecOpsPayload('handoffs', payload, parseHandoffPayloadItem);
}

export async function fetchDecGates(options: FetchDecOpsOptions = {}): Promise<DecGatePayload> {
  const payload = await requestDecPayload<unknown>('gates', options);
  return parseDecOpsPayload('gates', payload, parseGatePayloadItem);
}

export async function fetchDecEvents(options: FetchDecOpsOptions = {}): Promise<DecEventPayload> {
  const payload = await requestDecPayload<unknown>('events', options);
  return parseDecOpsPayload('events', payload, parseEventPayloadItem);
}

export async function fetchDecUsageMetrics(options: FetchDecOptions = {}): Promise<DecUsageMetricsResponse | DecFailureResponse> {
  const payload = await requestDecPayload<unknown>('metrics', options);
  return parseDecMetricsPayload(payload);
}

export async function fetchDecUsageMetricsSummary(
  options: FetchDecOptions = {},
): Promise<DecUsageMetricsResponse | DecFailureResponse> {
  const payload = await requestDecPayload<unknown>('metrics', {
    summary: true,
    ...options,
  });
  return parseDecMetricsPayload(payload);
}

export async function fetchDecCatalog(): Promise<DecCatalogResponse | DecCatalogFailureResponse> {
  try {
    const response = await fetch(DEC_BASE_PATH, {
      cache: 'no-store',
    });
    if (!response.ok) {
      const reason = await response.text().catch(() => response.statusText);
      return {
        ok: false,
        reason: `DEC catalog request failed (${response.status} ${response.statusText}): ${reason}`,
      };
    }
    const source = (await response.json()) as unknown;
    if (!source || typeof source !== 'object') {
      return {
        ok: false,
        reason: 'DEC catalog payload parse error',
      };
    }
    const raw = source as Record<string, unknown>;
    if (raw.ok === false) {
      return {
        ok: false,
        reason: safeReadString(raw.reason) || 'DEC catalog returned an error response',
      };
    }
    if (raw.ok !== true) {
      return {
        ok: false,
        reason: 'DEC catalog payload missing ok flag',
      };
    }

    return {
      ok: true,
      generatedAt: safeReadString(raw.generatedAt) || new Date().toISOString(),
      implementation: safeReadString(raw.implementation) || 'dec-catalog-v0',
      basePath: safeReadString(raw.basePath) || DEC_BASE_PATH,
      requestPattern: safeReadString(raw.requestPattern) || '/api/data/v1/dec/{category}',
      paging: raw.paging != null && typeof raw.paging === 'object'
        ? {
          defaultLimit: safeReadNumber((raw.paging as Record<string, unknown>).defaultLimit, 25),
          maxLimit: safeReadNumber((raw.paging as Record<string, unknown>).maxLimit, 200),
          maxOffset: safeReadNumber((raw.paging as Record<string, unknown>).maxOffset, 2000),
          preferredStrategy: safeReadString((raw.paging as Record<string, unknown>).preferredStrategy) || 'cursor',
          cursorSupportedCategories: Array.isArray((raw.paging as Record<string, unknown>).cursorSupportedCategories)
            ? ((raw.paging as Record<string, unknown>).cursorSupportedCategories as unknown[])
              .map((item) => normalizeCategory(item))
              .filter((item): item is DecCategory => Boolean(item))
            : [],
        }
        : undefined,
      accessBoundary: normalizeAccessBoundary(raw.accessBoundary),
      boundaries: {
        readsRealData: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { readsRealData?: unknown }).readsRealData) || false
          : false,
        writesRealData: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { writesRealData?: unknown }).writesRealData) || false
          : false,
        writesNotion: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { writesNotion?: unknown }).writesNotion) || false
          : false,
        sendsNotifications: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { sendsNotifications?: unknown }).sendsNotifications) || false
          : false,
        authorizesExternalServices: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { authorizesExternalServices?: unknown }).authorizesExternalServices) || false
          : false,
        executesActions: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { executesActions?: unknown }).executesActions) || false
          : false,
        productionDeploy: raw.boundaries != null && typeof raw.boundaries === 'object'
          ? safeReadBoolean((raw.boundaries as { productionDeploy?: unknown }).productionDeploy) || false
          : false,
      },
      categories: Array.isArray(raw.categories)
        ? raw.categories.map((item) => {
          const sourceItem = (item as Record<string, unknown>) || {};
          return {
            category: (safeReadString(sourceItem.category) || 'network') as DecCategory,
            path: safeReadString(sourceItem.path) || '/api/data/v1/dec/network',
            intent: Array.isArray(sourceItem.intent) ? sourceItem.intent.filter((entry) => typeof entry === 'string') as string[] : [],
            query: Array.isArray(sourceItem.query) ? sourceItem.query.filter((entry) => typeof entry === 'string') as string[] : [],
            returns: Array.isArray(sourceItem.returns) ? sourceItem.returns.filter((entry) => typeof entry === 'string') as string[] : [],
            readOnly: safeReadBoolean(sourceItem.readOnly) !== false,
          };
        })
        : [],
    };
  } catch (error) {
    return {
      ok: false,
      reason: readDecDataError(error),
    };
  }
}
