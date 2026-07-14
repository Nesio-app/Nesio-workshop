import {
  deriveCloudIdentity,
  getCloudConfig,
  getSignedInUser,
  serviceRoleRestHeaders,
  type CloudRuntimeConfig,
} from '@/lib/portal/cloud-server-runtime';
import { embedSignalText } from '@/lib/life-domain/signal-embedding';
import type { Signal } from '@/lib/life-domain/signal';

export type CloudSignalWriteResult = {
  ok: boolean;
  writesCloud: boolean;
  savedCount: number;
  error?: string;
  status?: number;
};

const SIGNAL_SCHEMA_VERSION = 'Signal@v1';

function restHeaders(config: CloudRuntimeConfig) {
  return serviceRoleRestHeaders(config, {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

function buildSignalSearchText(signal: Signal): string {
  return [
    signal.title,
    signal.source,
    signal.type,
    ...(signal.tags || []),
    JSON.stringify(signal.payload || {}),
    signal.evidence?.raw || '',
  ].join(' ').slice(0, 8000);
}

async function signalRow(identityKey: string, userId: string | null, signal: Signal) {
  const embeddingText = buildSignalSearchText(signal);
  const embedding = await embedSignalText(embeddingText);

  return {
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
    // 逻辑修改时间(编辑时刻),不是同步时刻。多端并发编辑时,谁的编辑更新谁胜,
    // 而非「谁最后同步」—— 否则旧副本批量回传会盖掉新编辑(数据审计 #3)。
    // DB 端 supabase-signals-conflict-guard-v1.sql 触发器据此拒绝严格更旧的写入。
    updated_at: signal.modifiedAt || signal.capturedAt || new Date().toISOString(),
    deleted_at: null,
  };
}

export async function writeCloudSignalsForCurrentUser(signals: readonly Signal[]): Promise<CloudSignalWriteResult> {
  if (!signals.length) return { ok: true, writesCloud: false, savedCount: 0 };

  const config = getCloudConfig();
  if (!config.configured) {
    return { ok: false, writesCloud: false, savedCount: 0, error: 'cloud_not_configured' };
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    return { ok: false, writesCloud: false, savedCount: 0, error: 'not_signed_in', status: 401 };
  }

  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'identity_key,signal_id');
  const rows = await Promise.all(signals.map((signal) => signalRow(cloudIdentity.identityKey, cloudIdentity.userId, signal)));
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: restHeaders(config),
    body: JSON.stringify(rows),
    cache: 'no-store',
  });

  if (!response.ok) {
    return { ok: false, writesCloud: false, savedCount: 0, error: 'cloud_write_failed', status: response.status };
  }
  return { ok: true, writesCloud: true, savedCount: signals.length };
}
