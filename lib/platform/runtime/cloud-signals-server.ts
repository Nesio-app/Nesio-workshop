import {
  deriveCloudIdentity,
  getCloudConfig,
  getSignedInUser,
  serviceRoleRestHeaders,
  type CloudRuntimeConfig,
} from '@/lib/portal/cloud-server-runtime';
import { embedSignalText } from '@/lib/life-domain/signal-embedding';
import { encryptSignalRowColumns, decryptSignalRowColumns } from '@/lib/portal/cloud/field-encryption';
import { envValue } from '@/lib/portal/env';
import type { CloudIdentity } from '@/lib/portal/cloud-identity';
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

  // 敏感内容列静态加密(数据审计 #2)。休眠(未开 NESIO_FIELD_ENCRYPTION)时
  // encryptSignalRowColumns 原样返回 —— 现网行为零变化。embedding_vector 不加密
  // (不可逆数值,服务端向量检索必需)。
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
    // 逻辑修改时间(编辑时刻),不是同步时刻。多端并发编辑时,谁的编辑更新谁胜,
    // 而非「谁最后同步」—— 否则旧副本批量回传会盖掉新编辑(数据审计 #3)。
    // DB 端 supabase-signals-conflict-guard-v1.sql 触发器据此拒绝严格更旧的写入。
    updated_at: signal.modifiedAt || signal.capturedAt || new Date().toISOString(),
    deleted_at: null,
  });
}

/**
 * 单用户自用入口(Alexa/Shortcuts secret 路径)的归属身份:
 * NESIO_OWNER_ID = owner 的 Supabase user id(UUID)→ deriveCloudIdentity 得到
 * `supabase:<uuid>`,与 owner 登录后 App 写云用的 identity_key 完全一致 ——
 * 于是语音随口记 / 随口问 都落在、读自「和 App 同一片记忆」。
 */
export function resolveOwnerIdentity(): CloudIdentity | null {
  const ownerId = envValue('NESIO_OWNER_ID').trim();
  if (!ownerId) return null;
  return deriveCloudIdentity({ id: ownerId });
}

async function writeSignalsForIdentity(
  config: CloudRuntimeConfig,
  identity: CloudIdentity,
  signals: readonly Signal[],
): Promise<CloudSignalWriteResult> {
  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'identity_key,signal_id');
  const rows = await Promise.all(signals.map((signal) => signalRow(identity.identityKey, identity.userId, signal)));
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

export async function writeCloudSignalsForCurrentUser(signals: readonly Signal[]): Promise<CloudSignalWriteResult> {
  if (!signals.length) return { ok: true, writesCloud: false, savedCount: 0 };

  const config = getCloudConfig();
  if (!config.configured) {
    return { ok: false, writesCloud: false, savedCount: 0, error: 'cloud_not_configured' };
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    // 有 cookie 会话时按会话归属;无会话(如 Alexa secret 路径)回落 owner 身份,
    // 否则单用户语音捕获会静默丢失(top-level ok 却 not_signed_in)。
    const owner = resolveOwnerIdentity();
    if (!owner) return { ok: false, writesCloud: false, savedCount: 0, error: 'not_signed_in', status: 401 };
    return writeSignalsForIdentity(config, owner, signals);
  }

  return writeSignalsForIdentity(config, cloudIdentity, signals);
}

/**
 * 读回某身份的云 signals(服务端 service-role),解密后原始行返回。
 * 供 /api/alexa 语音召回排序用。deleted_at is null,按 captured_at 倒序取近 N 条。
 */
export async function readCloudSignalRowsForIdentity(
  config: CloudRuntimeConfig,
  identityKey: string,
  limit = 200,
): Promise<{ ok: boolean; rows: Array<Record<string, unknown>>; error?: string }> {
  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('select', 'signal_id,source,type,occurred_at,captured_at,title,payload,entities,evidence,confidence,sensitivity,retention_policy,feedback,embedding_text');
  url.searchParams.set('order', 'captured_at.desc');
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 500))));
  const response = await fetch(url.toString(), { headers: restHeaders(config), cache: 'no-store' });
  if (!response.ok) return { ok: false, rows: [], error: `cloud_read_${response.status}` };
  const raw = await response.json() as Array<Record<string, unknown>>;
  return { ok: true, rows: raw.map((row) => decryptSignalRowColumns(row)) };
}
