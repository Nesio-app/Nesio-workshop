/**
 * signal-epistemic — Signal 可信度分层(学 claude-obsidian 哲学,不引进其库)。
 *
 * 核心纪律(对齐 `.raw` vs `wiki/`):
 *  - observation / user_asserted / extraction = 可当作「地面事实」检索与举证
 *  - derived / system_summary = AI/规则蒸馏,可重建、默认可 lint、默认不进 ground 检索
 *  - feedback = 对事实的元评价,一等公民但永不作为答问证据
 *
 * 字段 additive:旧信号缺省时由 resolveEpistemic() 按 type/source 推断,不炸读路径。
 */

import type { Signal, SignalSource, SignalType } from './signal';

/** 认识论层级:这条 Signal「算不算事实」。 */
export type SignalEpistemic =
  | 'observation'     // 世界事件/连接器原文(天气、日历、流水…)
  | 'user_asserted'   // 用户亲口确认或亲笔写下的判断/回看
  | 'extraction'      // AI/规则从原料抽出,待确认
  | 'derived'         // 从其他事实蒸馏(镜像信、洞察卡落库…)
  | 'feedback'        // 对推荐/检索的反馈
  | 'system_summary'; // 日报/月报等系统汇总

export const GROUND_EPISTEMICS: ReadonlySet<SignalEpistemic> = new Set([
  'observation',
  'user_asserted',
  'extraction',
]);

export const EPISTEMIC_VALUES: ReadonlySet<string> = new Set([
  'observation',
  'user_asserted',
  'extraction',
  'derived',
  'feedback',
  'system_summary',
]);

export function isSignalEpistemic(value: unknown): value is SignalEpistemic {
  return typeof value === 'string' && EPISTEMIC_VALUES.has(value);
}

/** 缺省推断:旧数据 / 未打标写入的兼容路径。 */
export function inferEpistemic(input: {
  type?: SignalType | string;
  source?: SignalSource | string;
  confidence?: number;
  kind?: string;
}): SignalEpistemic {
  const type = String(input.type || '');
  const source = String(input.source || '');
  const kind = String(input.kind || '');
  if (type.startsWith('feedback.')) return 'feedback';
  if (type === 'growth.reflection') return 'user_asserted';
  if (kind === 'mirror-letter' || type.includes('mirror')) return 'derived';
  if (kind === 'daily-report' || kind === 'monthly-report' || kind === 'finance-report' || kind === 'health-report'
    || kind === 'finance-monthly-report' || kind === 'health-monthly-report') {
    return 'system_summary';
  }
  if (type.startsWith('report.') || type.endsWith('.summary')) return 'system_summary';
  if (source === 'photo' && typeof input.confidence === 'number' && input.confidence > 0 && input.confidence < 0.9) {
    return 'extraction';
  }
  if (source === 'ai_observation') return 'derived';
  return 'observation';
}

export type EpistemicStamp = {
  epistemic: SignalEpistemic;
  generator?: string;
  derivedFrom?: string[];
};

/** 写入门统一盖章:显式字段优先,否则推断。 */
export function stampEpistemic(input: {
  epistemic?: SignalEpistemic;
  generator?: string;
  derivedFrom?: string[];
  type?: SignalType | string;
  source?: SignalSource | string;
  confidence?: number;
  payload?: Record<string, unknown>;
}): EpistemicStamp {
  const kind = typeof input.payload?.kind === 'string' ? input.payload.kind : undefined;
  const epistemic = input.epistemic || inferEpistemic({
    type: input.type,
    source: input.source,
    confidence: input.confidence,
    kind,
  });
  const derivedFrom = Array.isArray(input.derivedFrom)
    ? input.derivedFrom.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : undefined;
  let generator = input.generator;
  if (!generator) {
    if (epistemic === 'feedback') generator = 'user';
    else if (epistemic === 'user_asserted') generator = 'user';
    else if (epistemic === 'extraction') generator = 'ai:extract';
    else if (epistemic === 'derived') generator = 'ai:derive';
    else if (epistemic === 'system_summary') generator = 'rule:summary';
    else generator = String(input.source || 'unknown');
  }
  // 信任缺口:derived / system_summary 缺证据链时弱标(不拦写入,供契约/UI 警示)。
  if (needsEvidenceChain(epistemic) && (!derivedFrom || derivedFrom.length === 0)) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[epistemic] derived/system_summary missing derivedFrom', {
        type: input.type,
        epistemic,
        generator,
      });
    }
  }
  return { epistemic, generator, derivedFrom };
}

/** 契约/UI:派生主张是否挂了证据链(缺则为弱标)。 */
export function hasWeakEvidenceChain(stamp: EpistemicStamp): boolean {
  return needsEvidenceChain(stamp.epistemic) && !(stamp.derivedFrom && stamp.derivedFrom.length > 0);
}

/** 从已落库 Signal / 节点属性读回(含旧数据推断)。 */
export function resolveEpistemic(signal: Pick<Signal, 'type' | 'source' | 'confidence' | 'payload'> & {
  epistemic?: SignalEpistemic;
}): SignalEpistemic {
  if (isSignalEpistemic(signal.epistemic)) return signal.epistemic;
  const fromPayload = signal.payload?.epistemic;
  if (isSignalEpistemic(fromPayload)) return fromPayload;
  const kind = typeof signal.payload?.kind === 'string' ? signal.payload.kind : undefined;
  return inferEpistemic({
    type: signal.type,
    source: signal.source,
    confidence: signal.confidence,
    kind,
  });
}

/** 地面事实:可进检索答问 / DEC 举证的默认池。 */
export function isGroundFact(signal: Pick<Signal, 'type' | 'source' | 'confidence' | 'payload'> & {
  epistemic?: SignalEpistemic;
}): boolean {
  if (String(signal.type || '').startsWith('feedback.')) return false;
  return GROUND_EPISTEMICS.has(resolveEpistemic(signal));
}

/** 派生主张应挂证据链;缺 derivedFrom 时 lint 为弱。 */
export function needsEvidenceChain(epistemic: SignalEpistemic): boolean {
  return epistemic === 'derived' || epistemic === 'system_summary' || epistemic === 'extraction';
}

export function parseDerivedFromAttr(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
    } catch { /* comma list */ }
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

export function serializeDerivedFrom(ids: string[] | undefined): string | null {
  if (!ids?.length) return null;
  return JSON.stringify(ids);
}
