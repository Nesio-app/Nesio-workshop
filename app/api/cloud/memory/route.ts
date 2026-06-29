import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  normalizeSupabaseRuntimeUrl,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
};

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type CloudMemoryNode = {
  id: string;
  schemaVersion: 'LifeNode@v1';
  type: 'person' | 'object' | 'place' | 'event' | 'commitment' | 'health_state' | 'preference';
  name: string;
  attributes: Record<string, string | number | boolean | null>;
  source: 'manual' | 'photo' | 'calendar' | 'email' | 'system' | 'voice';
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
  lastConfirmedAt?: string;
  relations: Array<{ targetId: string; relation: string }>;
  tags?: string[];
  rawInput?: string;
};

type CloudMemoryAsset = {
  id: string;
  nodeId?: string;
  kind: 'image' | 'file' | 'audio' | 'text';
  storagePath?: string;
  mimeType?: string;
  label?: string;
  analysisSummary?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

const MEMORY_NODE_SCHEMA_VERSION = 'LifeNode@v1';

const allowedMemoryNodeKeys = [
  'id',
  'schemaVersion',
  'type',
  'name',
  'attributes',
  'source',
  'confidence',
  'createdAt',
  'updatedAt',
  'lastConfirmedAt',
  'relations',
  'tags',
  'rawInput',
] as const;

const allowedMemoryTypes = new Set<CloudMemoryNode['type']>([
  'person',
  'object',
  'place',
  'event',
  'commitment',
  'health_state',
  'preference',
]);

const allowedMemorySources = new Set<CloudMemoryNode['source']>([
  'manual',
  'photo',
  'calendar',
  'email',
  'system',
  'voice',
]);

const allowedAssetKinds = new Set<CloudMemoryAsset['kind']>(['image', 'file', 'audio', 'text']);

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudMemorySnapshot: true,
      ...body,
    },
    { status },
  );
}

function createCloudRuntimeAuditId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `cloud-memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logCloudRuntimeAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  const safePayload = {
    resource: 'memory_nodes',
    ...payload,
  };
  if (event === 'cloud_runtime_failure') {
    console.warn(event, safePayload);
    return;
  }
  console.info(event, safePayload);
}

function getCloudConfig() {
  const enabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const configured = enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey);

  return {
    configured,
    enabled,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}

function getCloudDatabaseSetupTask(request?: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: request?.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'cloud_database' && task.category === 'cloud',
  );
}

async function fetchSignedInUser(config: ReturnType<typeof getCloudConfig>, accessToken: string): Promise<SupabaseUserResponse | null> {
  if (!accessToken) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUserResponse>;
}

async function refreshSupabaseSession(config: ReturnType<typeof getCloudConfig>, refreshToken: string): Promise<SupabaseTokenResponse | null> {
  if (!refreshToken) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseTokenResponse>;
}

function setRefreshedAuthCookies(response: NextResponse, session?: SupabaseTokenResponse | null) {
  if (!session?.access_token) return response;
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60;
  response.cookies.set('baohe_auth_access', session.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  if (session.refresh_token) {
    response.cookies.set('baohe_auth_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>): Promise<{
  user: SupabaseUserResponse | null;
  refreshedSession: SupabaseTokenResponse | null;
}> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshToken = cookieStore.get('baohe_auth_refresh')?.value || '';
  const authProvider = cookieStore.get('baohe_auth_provider')?.value || '';
  const wechatOpenid = cookieStore.get('baohe_wechat_openid')?.value || '';
  const user = await fetchSignedInUser(config, accessToken);
  if (user?.id) return { user, refreshedSession: null };

  const refreshedSession = await refreshSupabaseSession(config, refreshToken);
  const refreshedUser = await fetchSignedInUser(config, refreshedSession?.access_token || '');
  if (refreshedUser?.id) {
    return { user: refreshedUser, refreshedSession };
  }

  if (authProvider === 'wechat' && wechatOpenid) {
    return {
      user: {
        id: `wechat_openid:${wechatOpenid}`,
      },
      refreshedSession: null,
    };
  }

  return { user: null, refreshedSession: null };
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
}

function sanitizeString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function sanitizeNumber(value: unknown, min = 0, max = 1): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function sanitizeAttributes(input: unknown): Record<string, string | number | boolean | null> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const safeKey = sanitizeString(key, 80);
    if (!safeKey) continue;
    if (typeof value === 'string') output[safeKey] = value.slice(0, 2000);
    else if (typeof value === 'number' && Number.isFinite(value)) output[safeKey] = value;
    else if (typeof value === 'boolean' || value === null) output[safeKey] = value;
  }
  return output;
}

function sanitizeRelations(input: unknown): Array<{ targetId: string; relation: string }> {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 40).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const targetId = sanitizeString(raw.targetId, 200);
    const relation = sanitizeString(raw.relation, 120);
    return targetId && relation ? [{ targetId, relation }] : [];
  });
}

function sanitizeTags(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const tags = Array.from(new Set(input.flatMap((tag) => {
    const value = sanitizeString(tag, 80);
    return value ? [value.replace(/^#/, '')] : [];
  }))).slice(0, 40);
  return tags.length ? tags : undefined;
}

function sanitizeMemoryNode(input: unknown): CloudMemoryNode | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<(typeof allowedMemoryNodeKeys)[number] | string, unknown>;

  const id = sanitizeString(raw.id, 220);
  const type = sanitizeString(raw.type, 80);
  const name = sanitizeString(raw.name, 400);
  const source = sanitizeString(raw.source, 80);
  if (!id || !type || !name || !source) return null;
  if (!allowedMemoryTypes.has(type as CloudMemoryNode['type'])) return null;
  if (source !== 'manual' && source !== 'photo' && source !== 'calendar' && source !== 'email' && source !== 'system' && source !== 'voice') return null;
  if (!allowedMemorySources.has(source as CloudMemoryNode['source'])) return null;

  const schemaVersion = sanitizeString(raw.schemaVersion, 80);
  if (schemaVersion && schemaVersion !== MEMORY_NODE_SCHEMA_VERSION) return null;

  const attributes = sanitizeAttributes(raw.attributes);
  if (!attributes) return null;

  const node: CloudMemoryNode = {
    id,
    schemaVersion: MEMORY_NODE_SCHEMA_VERSION,
    type: type as CloudMemoryNode['type'],
    name,
    attributes,
    source: source as CloudMemoryNode['source'],
    relations: sanitizeRelations(raw.relations),
  };

  const confidence = sanitizeNumber(raw.confidence);
  if (confidence !== undefined) node.confidence = confidence;
  for (const key of ['createdAt', 'updatedAt', 'lastConfirmedAt', 'rawInput'] as const) {
    const value = sanitizeString(raw[key]);
    if (value) node[key] = value;
  }
  const tags = sanitizeTags(raw.tags);
  if (tags) node.tags = tags;
  return node;
}

function sanitizeMemoryNodes(input: unknown): { nodes: CloudMemoryNode[]; rejectedCount: number } {
  const rawNodes = Array.isArray(input) ? input : [];
  const nodes: CloudMemoryNode[] = [];
  let rejectedCount = 0;
  for (const rawNode of rawNodes) {
    const node = sanitizeMemoryNode(rawNode);
    if (node) nodes.push(node);
    else rejectedCount += 1;
  }
  return { nodes, rejectedCount };
}

function sanitizeMemoryAsset(input: unknown): CloudMemoryAsset | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = sanitizeString(raw.id, 220);
  const kind = sanitizeString(raw.kind, 80);
  if (!id || !kind || !allowedAssetKinds.has(kind as CloudMemoryAsset['kind'])) return null;
  const asset: CloudMemoryAsset = {
    id,
    kind: kind as CloudMemoryAsset['kind'],
  };
  for (const key of ['nodeId', 'storagePath', 'mimeType', 'label', 'analysisSummary', 'createdAt', 'updatedAt'] as const) {
    const value = sanitizeString(raw[key]);
    if (value) asset[key] = value;
  }
  const tags = sanitizeTags(raw.tags);
  if (tags) asset.tags = tags;
  return asset;
}

function sanitizeMemoryAssets(input: unknown): { assets: CloudMemoryAsset[]; rejectedAssetCount: number } {
  const rawAssets = Array.isArray(input) ? input : [];
  const assets: CloudMemoryAsset[] = [];
  let rejectedAssetCount = 0;
  for (const rawAsset of rawAssets) {
    const asset = sanitizeMemoryAsset(rawAsset);
    if (asset) assets.push(asset);
    else rejectedAssetCount += 1;
  }
  return { assets, rejectedAssetCount };
}

function edgeRowsForNode(identityKey: string, userId: string | null, node: CloudMemoryNode, updatedAt: string) {
  return node.relations.map((relation) => ({
    identity_key: identityKey,
    user_id: userId,
    source_node_local_id: node.id,
    target_node_local_id: relation.targetId,
    relation: relation.relation,
    evidence: {
      source: node.source,
      sourceNodeName: node.name,
    },
    updated_at: updatedAt,
    deleted_at: null,
  }));
}

async function readMemorySnapshot(config: ReturnType<typeof getCloudConfig>, identityKey: string) {
  const nodesUrl = new URL('/rest/v1/memory_nodes', config.supabaseUrl);
  nodesUrl.searchParams.set('identity_key', `eq.${identityKey}`);
  nodesUrl.searchParams.set('deleted_at', 'is.null');
  nodesUrl.searchParams.set('select', 'local_id,node,updated_at');
  nodesUrl.searchParams.set('order', 'updated_at.desc');

  const edgesUrl = new URL('/rest/v1/memory_edges', config.supabaseUrl);
  edgesUrl.searchParams.set('identity_key', `eq.${identityKey}`);
  edgesUrl.searchParams.set('deleted_at', 'is.null');
  edgesUrl.searchParams.set('select', 'source_node_local_id,target_node_local_id,relation,evidence,updated_at');
  edgesUrl.searchParams.set('order', 'updated_at.desc');

  const assetsUrl = new URL('/rest/v1/memory_assets', config.supabaseUrl);
  assetsUrl.searchParams.set('identity_key', `eq.${identityKey}`);
  assetsUrl.searchParams.set('deleted_at', 'is.null');
  assetsUrl.searchParams.set('select', 'local_id,node_local_id,asset,updated_at');
  assetsUrl.searchParams.set('order', 'updated_at.desc');

  const [nodesResponse, edgesResponse, assetsResponse] = await Promise.all([
    fetch(nodesUrl.toString(), { headers: restHeaders(config), cache: 'no-store' }),
    fetch(edgesUrl.toString(), { headers: restHeaders(config), cache: 'no-store' }),
    fetch(assetsUrl.toString(), { headers: restHeaders(config), cache: 'no-store' }),
  ]);
  if (!nodesResponse.ok || !edgesResponse.ok || !assetsResponse.ok) {
    throw new Error('Supabase REST memory read failed');
  }

  const nodeRows = (await nodesResponse.json()) as Array<{ node?: unknown; updated_at?: string }>;
  const edgeRows = (await edgesResponse.json()) as Array<Record<string, unknown>>;
  const assetRows = (await assetsResponse.json()) as Array<{ asset?: unknown; updated_at?: string }>;
  const nodes = nodeRows.map((row) => sanitizeMemoryNode(row.node)).filter((node): node is CloudMemoryNode => Boolean(node));
  const assets = assetRows.map((row) => sanitizeMemoryAsset(row.asset)).filter((asset): asset is CloudMemoryAsset => Boolean(asset));

  return {
    nodes,
    edges: edgeRows,
    assets,
    updatedAt: nodeRows[0]?.updated_at || assetRows[0]?.updated_at || null,
  };
}

export async function GET(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  try {
    const exportOnly = request.nextUrl.searchParams.get('export') === '1' || request.nextUrl.searchParams.get('exportOnly') === 'true';
    if (exportOnly === true) {
      // Kept explicit for contract and audit readability.
    }
    const snapshot = await readMemorySnapshot(config, cloudIdentity.identityKey);
    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false, nodeCount: snapshot.nodes.length });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: true,
      writesCloud: false,
      exportOnly,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      assets: snapshot.assets,
      nodeCount: snapshot.nodes.length,
      assetCount: snapshot.assets.length,
      updatedAt: snapshot.updatedAt,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_read_failed' });
    return safeJson({ ok: false, error: 'cloud_read_failed', auditId, readsCloud: false, writesCloud: false }, 502);
  }
}

export async function POST(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'invalid_json' });
    return safeJson({ ok: false, error: 'invalid_json', auditId, readsCloud: false, writesCloud: false }, 400);
  }

  const rawBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const { nodes, rejectedCount } = sanitizeMemoryNodes(rawBody.nodes);
  const { assets, rejectedAssetCount } = sanitizeMemoryAssets(rawBody.assets);
  const updatedAt = new Date().toISOString();

  try {
    if (nodes.length > 0) {
      const nodesUrl = new URL('/rest/v1/memory_nodes', config.supabaseUrl);
      nodesUrl.searchParams.set('on_conflict', 'identity_key,local_id');
      const response = await fetch(nodesUrl.toString(), {
        method: 'POST',
        headers: {
          ...restHeaders(config),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(nodes.map((node) => ({
          identity_key: cloudIdentity.identityKey,
          user_id: cloudIdentity.userId,
          local_id: node.id,
          schema_version: MEMORY_NODE_SCHEMA_VERSION,
          source: node.source,
          node: {
            ...node,
            updatedAt: node.updatedAt || updatedAt,
          },
          updated_at: node.updatedAt || updatedAt,
          deleted_at: null,
        }))),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Supabase REST memory node write failed');

      const edgeRows = nodes.flatMap((node) => edgeRowsForNode(cloudIdentity.identityKey, cloudIdentity.userId, node, updatedAt));
      if (edgeRows.length > 0) {
        const edgesUrl = new URL('/rest/v1/memory_edges', config.supabaseUrl);
        const edgeResponse = await fetch(edgesUrl.toString(), {
          method: 'POST',
          headers: {
            ...restHeaders(config),
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(edgeRows),
          cache: 'no-store',
        });
        if (!edgeResponse.ok) throw new Error('Supabase REST memory edge write failed');
      }
    }

    if (assets.length > 0) {
      const assetsUrl = new URL('/rest/v1/memory_assets', config.supabaseUrl);
      assetsUrl.searchParams.set('on_conflict', 'identity_key,local_id');
      const response = await fetch(assetsUrl.toString(), {
        method: 'POST',
        headers: {
          ...restHeaders(config),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(assets.map((asset) => ({
          identity_key: cloudIdentity.identityKey,
          user_id: cloudIdentity.userId,
          local_id: asset.id,
          node_local_id: asset.nodeId || null,
          asset: {
            ...asset,
            updatedAt: asset.updatedAt || updatedAt,
          },
          updated_at: asset.updatedAt || updatedAt,
          deleted_at: null,
        }))),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Supabase REST memory asset write failed');
    }

    logCloudRuntimeAudit('cloud_runtime_success', {
      auditId,
      method: 'POST',
      readsCloud: false,
      writesCloud: true,
      savedCount: nodes.length,
      rejectedCount,
    });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: false,
      writesCloud: true,
      savedCount: nodes.length,
      savedAssetCount: assets.length,
      rejectedCount,
      rejectedAssetCount,
      updatedAt,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_write_failed' });
    return safeJson({ ok: false, error: 'cloud_write_failed', auditId, readsCloud: false, writesCloud: false }, 502);
  }
}

export async function DELETE(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'DELETE', readsCloud: false, writesCloud: true });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'DELETE', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'DELETE', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const deleteAll = Boolean((body as { deleteAll?: unknown })?.deleteAll);
  const nodeId = sanitizeString((body as { nodeId?: unknown })?.nodeId, 220);
  const confirmation = sanitizeString((body as { confirmation?: unknown })?.confirmation, 80);
  if (deleteAll === true && confirmation !== 'DELETE_MEMORY') {
    return safeJson({ ok: false, error: 'confirmation_required', auditId, readsCloud: false, writesCloud: false }, 400);
  }
  if (deleteAll !== true && !nodeId) {
    return safeJson({ ok: false, error: 'nodeId_or_deleteAll_required', auditId, readsCloud: false, writesCloud: false }, 400);
  }

  const updatedAt = new Date().toISOString();
  try {
    if (deleteAll === true) {
      for (const table of ['memory_nodes', 'memory_edges', 'memory_assets']) {
        const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
        url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
        const response = await fetch(url.toString(), {
          method: 'PATCH',
          headers: restHeaders(config),
          body: JSON.stringify({ deleted_at: updatedAt, updated_at: updatedAt }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Supabase REST ${table} delete failed`);
      }
    } else if (nodeId) {
      const nodesUrl = new URL('/rest/v1/memory_nodes', config.supabaseUrl);
      nodesUrl.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
      nodesUrl.searchParams.set('local_id', `eq.${nodeId}`);
      const nodesResponse = await fetch(nodesUrl.toString(), {
        method: 'PATCH',
        headers: restHeaders(config),
        body: JSON.stringify({ deleted_at: updatedAt, updated_at: updatedAt }),
        cache: 'no-store',
      });
      if (!nodesResponse.ok) throw new Error('Supabase REST memory node delete failed');

      const edgeUrl = new URL('/rest/v1/memory_edges', config.supabaseUrl);
      edgeUrl.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
      edgeUrl.searchParams.set('or', `(source_node_local_id.eq.${nodeId},target_node_local_id.eq.${nodeId})`);
      const edgeResponse = await fetch(edgeUrl.toString(), {
        method: 'PATCH',
        headers: restHeaders(config),
        body: JSON.stringify({ deleted_at: updatedAt, updated_at: updatedAt }),
        cache: 'no-store',
      });
      if (!edgeResponse.ok) throw new Error('Supabase REST memory edge delete failed');

      const assetsUrl = new URL('/rest/v1/memory_assets', config.supabaseUrl);
      assetsUrl.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
      assetsUrl.searchParams.set('node_local_id', `eq.${nodeId}`);
      const assetsResponse = await fetch(assetsUrl.toString(), {
        method: 'PATCH',
        headers: restHeaders(config),
        body: JSON.stringify({ deleted_at: updatedAt, updated_at: updatedAt }),
        cache: 'no-store',
      });
      if (!assetsResponse.ok) throw new Error('Supabase REST memory asset delete failed');
    }

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'DELETE', readsCloud: false, writesCloud: true });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: false,
      writesCloud: true,
      deleteAll,
      nodeId: nodeId || null,
      deletedAt: updatedAt,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'DELETE', reason: 'cloud_write_failed' });
    return safeJson({ ok: false, error: 'cloud_write_failed', auditId, readsCloud: false, writesCloud: false }, 502);
  }
}
