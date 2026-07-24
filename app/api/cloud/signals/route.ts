import { NextRequest, NextResponse } from 'next/server';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import * as cloudRuntime from '@/lib/portal/cloud-server-runtime';
import { embedSignalText, signalEmbeddingModel, signalVectorSearchEnabled } from '@/lib/life-domain/signal-embedding';
import { encryptSignalRowColumns, decryptSignalRowColumns } from '@/lib/portal/cloud/field-encryption';
import { sortRowsForQuery } from '@/lib/portal/cloud/signal-search';
import type { Signal, SignalSensitivity, SignalSource, RetentionPolicy } from '@/lib/life-domain/signal';

const SIGNAL_SCHEMA_VERSION = 'Signal@v1';
const ALLOWED_SOURCES = new Set<SignalSource>([
  'voice',
  'photo',
  'calendar',
  'gmail',
  'health',
  'task',
  'weather',
  'hardware_pulse',
  'manual',
  'ai_observation',
  'flomo',
  'notion',
  'toggl',
  'reminder',
  'keep',
  'wechat_reading',
  'device',
]);
const ALLOWED_RETENTION = new Set<RetentionPolicy>(['AlwaysAlive', 'LongLiving', 'Normal', 'Disposable']);
const ALLOWED_SENSITIVITY = new Set<SignalSensitivity>(['normal', 'private', 'health', 'financial', 'family', 'work']);

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudSignalsSnapshot: true,
      ...body,
    },
    { status },
  );
}

function getCloudConfig() {
  return cloudRuntime.getCloudConfig();
}

type CloudUserSession = Awaited<ReturnType<typeof cloudRuntime.getSignedInUser>>;

function setRefreshedAuthCookies(response: NextResponse, session?: CloudUserSession['refreshedSession']) {
  return cloudRuntime.setRefreshedAuthCookies(response, session);
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>) {
  return cloudRuntime.getSignedInUser(config);
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return cloudRuntime.serviceRoleRestHeaders(config);
}

function sanitizeString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function sanitizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 80) : [];
}

function sanitizeStringArray(value: unknown, maxLength = 240): string[] {
  return sanitizeJsonArray(value).flatMap((entry) => {
    const item = sanitizeString(entry, maxLength);
    return item ? [item] : [];
  });
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function iso(value: unknown): string {
  if (typeof value === 'string' || value instanceof Date) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function buildSignalSearchText(signal: Pick<Signal, 'title' | 'source' | 'type' | 'payload' | 'tags' | 'evidence'>): string {
  return [
    signal.title,
    signal.source,
    signal.type,
    ...(signal.tags || []),
    JSON.stringify(signal.payload || {}),
    signal.evidence?.raw || '',
  ].join(' ').slice(0, 8000);
}

function sanitizeSignal(input: unknown): Signal | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = sanitizeString(raw.id, 240);
  const source = sanitizeString(raw.source, 80) as SignalSource | undefined;
  const type = sanitizeString(raw.type, 120);
  const title = sanitizeString(raw.title, 600);
  if (!id || !source || !type || !title || !ALLOWED_SOURCES.has(source)) return null;
  const retentionPolicy = sanitizeString(raw.retentionPolicy || raw.retention_policy, 80) as RetentionPolicy | undefined;
  const sensitivity = sanitizeString(raw.sensitivity, 80) as SignalSensitivity | undefined;
  return {
    id,
    source,
    type,
    occurredAt: iso(raw.occurredAt),
    capturedAt: iso(raw.capturedAt),
    title,
    payload: sanitizeJsonObject(raw.payload),
    content: sanitizeJsonObject(raw.payload),
    entities: sanitizeJsonArray(raw.entities) as Signal['entities'],
    confidence: clampConfidence(raw.confidence),
    sensitivity: sensitivity && ALLOWED_SENSITIVITY.has(sensitivity) ? sensitivity : 'normal',
    retentionPolicy: retentionPolicy && ALLOWED_RETENTION.has(retentionPolicy) ? retentionPolicy : 'Normal',
    evidence: sanitizeJsonObject(raw.evidence) as unknown as Signal['evidence'],
    tags: sanitizeJsonArray(raw.tags).flatMap((tag) => {
      const value = sanitizeString(tag, 80);
      return value ? [value.replace(/^#/, '')] : [];
    }),
  };
}

function sanitizeSignals(input: unknown): { signals: Signal[]; rejectedCount: number } {
  const rawSignals = Array.isArray(input) ? input : [];
  const signals: Signal[] = [];
  let rejectedCount = 0;
  for (const rawSignal of rawSignals) {
    const signal = sanitizeSignal(rawSignal);
    if (signal) signals.push(signal);
    else rejectedCount += 1;
  }
  return { signals, rejectedCount };
}

async function signalRow(identityKey: string, userId: string | null, signal: Signal) {
  const embeddingText = buildSignalSearchText(signal);
  const embedding = await embedSignalText(embeddingText);
  // 敏感内容列静态加密(数据审计 #2);休眠时原样返回。
  return encryptSignalRowColumns({
    identity_key: identityKey,
    user_id: userId,
    signal_id: signal.id,
    schema_version: SIGNAL_SCHEMA_VERSION,
    source: signal.source,
    type: signal.type,
    occurred_at: signal.occurredAt,
    captured_at: signal.capturedAt,
    title: signal.title,
    payload: signal.payload || {},
    entities: signal.entities || [],
    evidence: signal.evidence || {},
    confidence: signal.confidence,
    sensitivity: signal.sensitivity,
    retention_policy: signal.retentionPolicy,
    embedding_text: embeddingText,
    embedding_model: embedding.ok ? embedding.model : null,
    embedding_vector: embedding.ok ? embedding.values : null,
    embedding_updated_at: embedding.ok ? new Date().toISOString() : null,
    feedback: {},
    updated_at: new Date().toISOString(),
    deleted_at: null,
  });
}

async function searchRowsByVector(
  config: ReturnType<typeof getCloudConfig>,
  identityKey: string,
  query: string,
  limit: number,
): Promise<{ rows: Array<Record<string, unknown>>; ok: boolean; error?: string }> {
  if (!query || !signalVectorSearchEnabled()) return { rows: [], ok: false, error: 'vector_search_disabled' };
  const embedding = await embedSignalText(query);
  if (!embedding.ok || !embedding.values) return { rows: [], ok: false, error: embedding.error || 'query_embedding_failed' };

  const url = new URL('/rest/v1/rpc/match_own_signals', config.supabaseUrl);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: restHeaders(config),
    body: JSON.stringify({
      match_identity_key: identityKey,
      query_embedding: embedding.values,
      match_count: limit,
    }),
    cache: 'no-store',
  });
  if (!response.ok) return { rows: [], ok: false, error: `vector_rpc_${response.status}` };
  const rows = await response.json() as Array<Record<string, unknown>>;
  return { rows, ok: true };
}

export async function GET(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) return safeJson({ ok: false, error: 'cloud_not_configured', readsCloud: false, writesCloud: false }, 503);
  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) return safeJson({ ok: false, error: 'not_signed_in', readsCloud: false, writesCloud: false }, 401);

  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('select', 'signal_id,source,type,occurred_at,captured_at,title,payload,entities,evidence,confidence,sensitivity,retention_policy,feedback,embedding_text,embedding_model,embedding_updated_at');
  url.searchParams.set('order', 'captured_at.desc');
  const query = sanitizeString(request.nextUrl.searchParams.get('q') || request.nextUrl.searchParams.get('query'), 300) || '';
  const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '200', 10);
  const resultLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 200;
  url.searchParams.set('limit', query ? String(Math.max(resultLimit, 200)) : String(resultLimit));

  let vectorSearch: { ok: boolean; error?: string; rows: Array<Record<string, unknown>> } = {
    ok: false,
    error: query ? 'vector_search_not_attempted' : '',
    rows: [],
  };
  if (query) {
    vectorSearch = await searchRowsByVector(config, cloudIdentity.identityKey, query, resultLimit);
  }
  // 敏感内容列静态加密(数据审计 #2):读回后先解密再评分/返回 —— 服务端持密钥,
  // 故文本回退检索、向量结果都能正常工作。旧明文行逐列探测原样透传(混合模式)。
  let signals: Array<Record<string, unknown>>;
  if (vectorSearch.ok) {
    signals = vectorSearch.rows.map((row) => decryptSignalRowColumns(row));
  } else {
    const response = await fetch(url.toString(), { headers: restHeaders(config), cache: 'no-store' });
    if (!response.ok) return safeJson({ ok: false, error: 'cloud_read_failed', readsCloud: false, writesCloud: false }, 502);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const decrypted = rows.map((row) => decryptSignalRowColumns(row));
    signals = sortRowsForQuery(decrypted, query, resultLimit);
  }
  return setRefreshedAuthCookies(safeJson({
    ok: true,
    readsCloud: true,
    writesCloud: false,
    signals,
    signalCount: signals.length,
    search: {
      query: query || null,
      mode: query ? (vectorSearch.ok ? 'signal_vector_pgvector' : 'signal_text_scoring') : 'recent_signals',
      pgvectorSchemaReady: true,
      embeddingVectorRuntimeReady: signalVectorSearchEnabled(),
      embeddingModel: signalEmbeddingModel(),
      vectorFallbackReason: query && !vectorSearch.ok ? vectorSearch.error : null,
      scope: 'own_user_signals_only',
    },
  }), userSession.refreshedSession);
}

export async function PATCH(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) return safeJson({ ok: false, error: 'cloud_not_configured', readsCloud: false, writesCloud: false }, 503);
  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) return safeJson({ ok: false, error: 'not_signed_in', readsCloud: false, writesCloud: false }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return safeJson({ ok: false, error: 'invalid_json', readsCloud: false, writesCloud: false }, 400);
  }

  const directSignalId = sanitizeString(body.signalId || body.signal_id, 240);
  const signalIds = Array.from(new Set([
    ...(directSignalId ? [directSignalId] : []),
    ...sanitizeStringArray(body.signalIds || body.signal_ids, 240),
  ])).slice(0, 40);
  if (!signalIds.length) return safeJson({ ok: false, error: 'empty_signal_ids', readsCloud: false, writesCloud: false }, 400);

  const feedback = sanitizeJsonObject(body.feedback);
  const preferencePatch = sanitizeJsonObject(body.preferencePatch || body.preference_patch);
  const decEngineId = sanitizeString(body.decEngineId || body.dec_engine_id, 160);
  const feedbackValue = sanitizeString(body.feedbackValue || body.feedback_value, 80);
  const feedbackRecord = {
    latest: {
      value: feedbackValue || feedback.value || null,
      decEngineId: decEngineId || feedback.decEngineId || null,
      preferencePatch,
      feedback,
      recordedAt: new Date().toISOString(),
    },
  };

  let updatedCount = 0;
  for (const signalId of signalIds) {
    const url = new URL('/rest/v1/signals', config.supabaseUrl);
    url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
    url.searchParams.set('signal_id', `eq.${signalId}`);
    url.searchParams.set('deleted_at', 'is.null');
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        ...restHeaders(config),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        feedback: feedbackRecord,
        updated_at: new Date().toISOString(),
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      return safeJson({
        ok: false,
        error: 'feedback_update_failed',
        updatedCount,
        readsCloud: false,
        writesCloud: false,
      }, 502);
    }
    updatedCount += 1;
  }

  return setRefreshedAuthCookies(safeJson({
    ok: true,
    readsCloud: false,
    writesCloud: true,
    feedbackUpdated: true,
    updatedCount,
  }), userSession.refreshedSession);
}

export async function POST(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) return safeJson({ ok: false, error: 'cloud_not_configured', readsCloud: false, writesCloud: false }, 503);
  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) return safeJson({ ok: false, error: 'not_signed_in', readsCloud: false, writesCloud: false }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return safeJson({ ok: false, error: 'invalid_json', readsCloud: false, writesCloud: false }, 400);
  }

  const input = body.signals || (body.signal ? [body.signal] : []);
  const { signals, rejectedCount } = sanitizeSignals(input);
  if (!signals.length) return safeJson({ ok: false, error: 'empty_signals', rejectedCount, readsCloud: false, writesCloud: false }, 400);

  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'identity_key,signal_id');
  const rows = await Promise.all(signals.map((signal) => signalRow(cloudIdentity.identityKey, cloudIdentity.userId, signal)));
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...restHeaders(config),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
    cache: 'no-store',
  });
  if (!response.ok) return safeJson({ ok: false, error: 'cloud_write_failed', rejectedCount, readsCloud: false, writesCloud: false }, 502);
  return setRefreshedAuthCookies(safeJson({
    ok: true,
    readsCloud: false,
    writesCloud: true,
    savedCount: signals.length,
    rejectedCount,
  }), userSession.refreshedSession);
}
