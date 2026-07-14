/**
 * Canonical Signal write path.
 *
 * All new real-world inputs must enter Nesio through createSignal() —
 * or, for LifeNode-shaped inputs (connector/AI extraction outputs),
 * through lib/life-domain/ingest-node.ingestLifeNode(). Signal is the
 * main fact table (accumulating in IndexedDB, see signal-store-idb.ts);
 * LifeGraph and Memory are compatibility projections until read paths
 * switch over (migration M3).
 */

import { addLifeNode, type LifeNode, type LifeNodeSource, type LifeNodeType } from '../portal/life-graph';
import { lifeNodeToSignal, type RetentionPolicy, type Signal, type SignalSensitivity, type SignalSource, type SignalType } from './signal';
import type { SignalContext } from './context';
import { appendSignalIdb } from './signal-store-idb';
import { logDropped } from '../portal/storage-health';

export const SIGNAL_SCHEMA_VERSION = 'Signal@v1';
export type SignalWriteMode = 'local_first' | 'cloud_mirror_attempted' | 'cloud_mirror_pending';

export interface CreateSignalInput {
  source: SignalSource;
  type: SignalType;
  occurredAt?: string | Date;
  capturedAt?: string | Date;
  title: string;
  payload?: Record<string, unknown>;
  confidence?: number;
  sensitivity?: SignalSensitivity;
  retentionPolicy?: RetentionPolicy;
  tags?: string[];
  raw?: string;
  externalId?: string;
  /** Structured semantics (domain / people / places / objects / intent). */
  context?: SignalContext;
}

function iso(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

export function buildSignalId(input: Pick<CreateSignalInput, 'source' | 'type' | 'occurredAt' | 'payload' | 'externalId'>): string {
  const occurredAt = iso(input.occurredAt);
  const stamp = occurredAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  const seed = JSON.stringify({
    source: input.source,
    type: input.type,
    occurredAt,
    externalId: input.externalId || '',
    payload: input.payload || {},
  });
  return `${input.source}_${stamp}_${hashText(seed)}`;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function lifeNodeSource(source: SignalSource): LifeNodeSource {
  if (source === 'photo') return 'photo';
  if (source === 'calendar') return 'calendar';
  if (source === 'gmail') return 'email';
  if (source === 'voice') return 'voice';
  if (source === 'manual') return 'manual';
  return 'system';
}

function lifeNodeType(input: CreateSignalInput): LifeNodeType {
  if (input.source === 'calendar' || input.type === 'event') return 'event';
  // 批次 31 QA:裸 'task'(说一句 growth 域)此前漏网落到 preference —— 「洗衣服」被拍成⭐偏好
  if (input.source === 'task' || input.type === 'commitment' || input.type === 'task' || String(input.type).startsWith('task.')) return 'commitment';
  if (input.source === 'health' || String(input.type).startsWith('health.')) return 'health_state';
  if (String(input.type).includes('location')) return 'place';
  if (input.source === 'photo' || String(input.type).includes('object')) return 'object';
  // 批次 183(用户实锤「记忆类别很混乱」):兜底从 preference 改 note。
  // preference 应留给"真偏好"(喜欢/口味),没匹配上的随手记(粘贴URL/一句话)是 note,不是偏好。
  return 'note';
}

function primitivePayload(payload: Record<string, unknown> = {}): LifeNode['attributes'] {
  const attrs: LifeNode['attributes'] = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function inferSensitivity(input: CreateSignalInput): SignalSensitivity {
  if (input.sensitivity) return input.sensitivity;
  if (input.source === 'health') return 'health';
  if (String(input.type).startsWith('finance.')) return 'financial';
  if (input.source === 'calendar' || input.source === 'gmail' || input.source === 'task') return 'work';
  return 'normal';
}

function inferRetention(input: CreateSignalInput): RetentionPolicy {
  if (input.retentionPolicy) return input.retentionPolicy;
  if (input.source === 'weather' || input.source === 'hardware_pulse') return 'Disposable';
  if (input.source === 'health' || input.source === 'gmail') return 'LongLiving';
  return 'Normal';
}

export function signalWriteMode(): SignalWriteMode {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return 'local_first';
  return 'cloud_mirror_pending';
}

// 匿名会话云镜像降噪(2026-07-04 QA P2 修复):未登录时镜像注定 401,
// 收到一次后本会话不再发(登录流程会导航/刷新页面,标志自然复位)。
let cloudMirrorAuthBlocked = false;

export async function writeCloudSignal(signal: Signal): Promise<{ ok: boolean; status: string }> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { ok: false, status: 'server_or_no_fetch' };
  }
  if (cloudMirrorAuthBlocked) {
    return { ok: false, status: 'skipped_not_signed_in' };
  }
  try {
    const response = await fetch('/api/cloud/signals', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal: { ...signal, schemaVersion: SIGNAL_SCHEMA_VERSION } }),
    });
    if (response.status === 401) {
      cloudMirrorAuthBlocked = true;
      return { ok: false, status: 'http_401' };
    }
    if (!response.ok) return { ok: false, status: `http_${response.status}` };
    return { ok: true, status: 'cloud_mirror_attempted' };
  } catch (err) {
    logDropped('signal.cloud_mirror', err); // B3 可观测:云镜像失败别哑吞
    return { ok: false, status: 'cloud_mirror_failed' };
  }
}

export function createSignal(input: CreateSignalInput): Signal {
  const occurredAt = iso(input.occurredAt);
  const capturedAt = iso(input.capturedAt);
  const signalId = buildSignalId({ ...input, occurredAt });
  const node = addLifeNode({
    type: lifeNodeType(input),
    name: input.title,
    attributes: {
      ...primitivePayload(input.payload),
      signalId,
      signalSource: input.source,
      signalType: input.type,
      occurredAt,
      capturedAt,
      externalId: input.externalId || null,
      retentionPolicy: inferRetention(input),
      sensitivity: inferSensitivity(input),
      ...(input.context ? { context: JSON.stringify(input.context) } : {}),
    },
    source: lifeNodeSource(input.source),
    confidence: clampConfidence(input.confidence),
    relations: [],
    tags: Array.from(new Set([...(input.tags || []), input.source, String(input.type)])),
    rawInput: input.raw,
  });
  const signal = lifeNodeToSignal(node);
  // M2:IDB 事实库双写(读路径未切,见 signal-store-idb.ts)。B3:此前 fire-and-forget
  // 无 catch → 写失败静默丢事实;加日志,别再哑吞(离线记的事实进不了库要看得见)。
  void appendSignalIdb(signal).catch((err) => logDropped('signal.idb_write', err));
  if (signalWriteMode() === 'cloud_mirror_pending') {
    void writeCloudSignal(signal);
  }
  return signal;
}
