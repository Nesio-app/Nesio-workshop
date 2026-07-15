/**
 * 开放世界 Layer ③ 客户端编排:每日一次巡查 + findings ledger 缓存(块3,客户端)。
 *
 * - loadSweepEvents(nodes, now):从 ledger 读缓存 findings → 本地重算窗口 → GuidanceEvent[]。
 *   **同步、免费**,每次渲染都跑;窗口判定不调模型。
 * - maybeRunSweep(nodes):每设备每天一次(lastRunDate 幂等);选新低置信候选(sweptIds 记账,
 *   每节点这辈子只送一次)→ POST 付费路由 → 合并进 ledger。fire-and-forget。
 *
 * 私据门:调用方保证仅在 canUsePrivateData(已登录)时调 maybeRunSweep(与日报同契约)。
 * 付费门在路由端(requirePaidCloudAi);无权益时路由返回空 findings,这里照常记 lastRunDate,
 * 不会每次渲染空转重试。
 */
import {
  selectSweepCandidates,
  sweepFindingsToGuidanceEvents,
  type SweepFinding,
  type SweepNode,
} from '@/lib/platform/guidance-engine/llm-sweep';
import type { GuidanceEvent } from '@/lib/platform/guidance-engine/types';

const LEDGER_KEY = 'nesio-llm-sweep-ledger-v1';

interface Ledger {
  findings: SweepFinding[];
  sweptIds: string[];
  lastRunDate: string | null;
}

const EMPTY: Ledger = { findings: [], sweptIds: [], lastRunDate: null };

function readLedger(): Ledger {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Partial<Ledger>;
    return {
      findings: Array.isArray(p.findings) ? p.findings : [],
      sweptIds: Array.isArray(p.sweptIds) ? p.sweptIds : [],
      lastRunDate: typeof p.lastRunDate === 'string' ? p.lastRunDate : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeLedger(l: Ledger): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(l));
  } catch {
    /* 写失败无害:下次至多重跑一天巡查 */
  }
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 同步:从 ledger 读缓存 findings → 今天在窗口内的 GuidanceEvent[]。免费,渲染路径可直接调。 */
export function loadSweepEvents(nodes: readonly SweepNode[], now: Date = new Date()): GuidanceEvent[] {
  const { findings } = readLedger();
  if (findings.length === 0) return [];
  const live = new Set(nodes.map((n) => n.id));
  return sweepFindingsToGuidanceEvents(findings, live, now);
}

/** 异步:每天一次巡查新低置信候选,合并进 ledger。fire-and-forget(调用方不必 await)。 */
export async function maybeRunSweep(
  nodes: readonly SweepNode[],
  opts: { now?: Date } = {},
): Promise<'ran' | 'skipped'> {
  if (typeof window === 'undefined') return 'skipped';
  const now = opts.now ?? new Date();
  const today = dateKey(now);
  const ledger = readLedger();
  if (ledger.lastRunDate === today) return 'skipped'; // 今天已跑

  const swept = new Set(ledger.sweptIds);
  const candidates = selectSweepCandidates(nodes, { sweptIds: swept });
  if (candidates.length === 0) {
    // 无新候选也记 lastRunDate,避免每次渲染重复选/空转
    writeLedger({ ...ledger, lastRunDate: today });
    return 'skipped';
  }

  try {
    const res = await fetch('/api/portal/llm-sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    const data = res.ok ? await res.json() : null;
    const findings: SweepFinding[] = Array.isArray(data?.findings) ? data.findings : [];
    // 记账:所有送去的候选都标 swept(含没抽出结果的 —— 这辈子不再送,省 token)。
    const newSwept = Array.from(new Set([...swept, ...candidates.map((c) => c.id)]));
    // 合并:同 nodeId 的旧 finding 让位新结果。
    const merged = [
      ...ledger.findings.filter((f) => !findings.some((nf) => nf.nodeId === f.nodeId)),
      ...findings,
    ];
    writeLedger({ findings: merged, sweptIds: newSwept, lastRunDate: today });
    return 'ran';
  } catch {
    // 网络失败:不记 lastRunDate、不标 swept —— 候选保留,回前台可重试。
    return 'skipped';
  }
}

export interface SweepRunResult {
  ok: boolean;
  candidates: number; // 送去巡查的低置信候选数
  findings: number; // LLM 抽出的确定到期/续期 finding 数
  note?: string; // 失败原因 / 空态提示
}

/**
 * 手动「立即巡查」(设置→同步诊断的测试按钮,批次208)。
 * 与 maybeRunSweep 的差别:① 不受每天一次闸限制;② 忽略 sweptIds、重扫**当前所有**低置信候选
 * (诊断「现在能翻出什么」,便于当场反复测)。结果合并进 ledger 并标 swept + 记 lastRunDate,
 * 与自动路径对齐。返回可读诊断(送了几条 / 抽出几条)。
 */
export async function runSweepNow(nodes: readonly SweepNode[]): Promise<SweepRunResult> {
  if (typeof window === 'undefined') return { ok: false, candidates: 0, findings: 0, note: 'no window' };
  const now = new Date();
  const ledger = readLedger();
  const candidates = selectSweepCandidates(nodes, { sweptIds: new Set() });
  if (candidates.length === 0) {
    return { ok: true, candidates: 0, findings: 0, note: 'no-candidates' };
  }
  try {
    const res = await fetch('/api/portal/llm-sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    if (!res.ok) return { ok: false, candidates: candidates.length, findings: 0, note: `route ${res.status}` };
    const data = await res.json();
    const findings: SweepFinding[] = Array.isArray(data?.findings) ? data.findings : [];
    const newSwept = Array.from(new Set([...ledger.sweptIds, ...candidates.map((c) => c.id)]));
    const merged = [
      ...ledger.findings.filter((f) => !findings.some((nf) => nf.nodeId === f.nodeId)),
      ...findings,
    ];
    writeLedger({ findings: merged, sweptIds: newSwept, lastRunDate: dateKey(now) });
    return { ok: true, candidates: candidates.length, findings: findings.length };
  } catch {
    return { ok: false, candidates: candidates.length, findings: 0, note: 'network' };
  }
}
