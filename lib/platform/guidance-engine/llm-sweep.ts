/**
 * 开放世界 Layer ③:LLM 巡查(先窄 · 日报搭车)。
 *
 * 定位:① 兜底把「分不出类」的输入低置信存下(永不丢),② 能靠 tags 召回;但用户不会天天主动查。
 * ③ 每天替用户翻一遍**低置信捕捉**,把其中确定的到期/续期信号(deterministic extractor 漏掉、
 * 只躺在 rawInput 里的)抽成结构化 finding,当 expiry/renewal 卡顶出来。把「暂时没提醒的 miss」补回。
 *
 * 先窄(用户选定的第一版灰度):只认高价值确定模式(证件/保修/有效期/带没带),客户端先用
 * SWEEP_HINT_RE 预筛,只把**可能**含此信号的低置信节点送 LLM —— 省 token、好坏易评估。
 *
 * 反馈/保守(④):产出 source='llm_sweep'(interrupt-evaluator 里 relevance 更低)+ 中等 confidence,
 * 天然比确定性卡更容易被 per-user 反馈压制,不夺确定性卡的位。
 *
 * 成本闸:每个节点这辈子最多被送 LLM 一次(客户端 sweptIds 记账);findings 缓存进 ledger,
 * 之后每天「到没到窗口」的判定在本地免费重算,不再调模型。
 *
 * 本模块是纯逻辑(无 window / 无网络),可单测。网络/缓存编排在 lib/portal/llm-sweep-auto.ts。
 */
import type { GuidanceEvent } from './types';

export interface SweepNode {
  id: string;
  name?: string;
  rawInput?: string;
  tags?: string[];
  confidence?: number;
  createdAt?: string;
  attributes?: Record<string, unknown>;
}

/** 送去巡查的最小载荷:节点 id + 可检索文本(name+rawInput+tags 拼接、截断)。 */
export interface SweepCandidate { id: string; text: string; }

export interface SweepFinding {
  nodeId: string;
  kind: 'expiry' | 'renewal';
  title: string;
  dueDate: string; // ISO
  detail?: string;
}

/** 先窄预筛:低置信节点里,文本**可能**含到期/续期/带没带信号的才值得送 LLM。 */
export const SWEEP_HINT_RE =
  /到期|过期|有效期|保质期|截止|失效|expir|valid\s*(until|through|till)|续(期|签|保|费)|renew|保修|保固|warrant|护照|签证|驾照|身份证|居留|车牌|年检|passport|visa|licen[cs]e|带上?|别忘|记得带/i;

/** 低置信阈值 —— 与 extraction Layer ① 兜底捕捉的 confidence≤0.5 对齐(只巡查「没分清」的碎片)。 */
const LOW_CONF = 0.5;
/** ≤3 卡/天(开放世界报告的硬顶):单次巡查最多产出 3 条 finding。 */
export const MAX_FINDINGS_PER_RUN = 3;

function candidateText(n: SweepNode): string {
  return [n.name, n.rawInput, ...(n.tags || [])].filter(Boolean).join(' ');
}

/**
 * 选巡查候选:低置信 + 命中 hint 预筛 + 未曾巡查过,按新近排序取前 limit。
 * sweptIds 保证每节点这辈子最多送一次 LLM。
 */
export function selectSweepCandidates(
  nodes: readonly SweepNode[],
  opts: { sweptIds?: ReadonlySet<string>; limit?: number } = {},
): SweepCandidate[] {
  const swept = opts.sweptIds ?? new Set<string>();
  const limit = opts.limit ?? 12;
  return nodes
    .filter((n) => n && n.id && !swept.has(n.id))
    .filter((n) => typeof n.confidence === 'number' && n.confidence <= LOW_CONF)
    .map((n) => ({ n, text: candidateText(n) }))
    .filter(({ text }) => text.length > 0 && SWEEP_HINT_RE.test(text))
    .sort((a, b) => String(b.n.createdAt || '').localeCompare(String(a.n.createdAt || '')))
    .slice(0, limit)
    .map(({ n, text }) => ({ id: n.id, text: text.slice(0, 400) }));
}

/**
 * 解析巡查响应 —— 严格:只留指向真候选 id、kind∈{expiry,renewal}、有可解析日期、有标题的 finding;
 * 防「幻觉出一个不存在的 nodeId / 含糊没日期的感想」。容忍 ```json 围栏。硬顶 ≤3。
 */
export function parseSweepResponse(raw: string, candidateIds: ReadonlySet<string>): SweepFinding[] {
  let arr: unknown;
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end < start) return [];
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: SweepFinding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const nodeId = String(o.nodeId ?? '');
    const kind = String(o.kind ?? '');
    const dueDate = String(o.dueDate ?? '');
    const title = String(o.title ?? '').trim().slice(0, 80);
    if (!candidateIds.has(nodeId)) continue; // 必须指向真候选(防幻觉节点)
    if (kind !== 'expiry' && kind !== 'renewal') continue;
    if (Number.isNaN(new Date(dueDate).getTime())) continue; // 必须有确定日期
    if (!title) continue;
    out.push({
      nodeId,
      kind,
      title,
      dueDate,
      detail: o.detail ? String(o.detail).slice(0, 120) : undefined,
    });
    if (out.length >= MAX_FINDINGS_PER_RUN) break;
  }
  return out;
}

/**
 * 缓存的 finding → 今天该出的 GuidanceEvent[]。窗口与确定性路径一致(source-adapters.focusNodes):
 * renewal 提前 180 天催,expiry 0-2 天。到窗口才出卡,否则静默持有(miss,不是 error)。
 * 节点已删则弃 finding。source='llm_sweep' + confidence 68(低于确定性 85-90,≥50 不被自动压制)。
 */
export function sweepFindingsToGuidanceEvents(
  findings: readonly SweepFinding[],
  liveNodeIds: ReadonlySet<string>,
  now: Date = new Date(),
): GuidanceEvent[] {
  const events: GuidanceEvent[] = [];
  for (const f of findings) {
    if (!liveNodeIds.has(f.nodeId)) continue;
    const due = new Date(f.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const days = (due.getTime() - now.getTime()) / 86_400_000;
    const inWindow = f.kind === 'renewal' ? days >= 0 && days <= 180 : days >= 0 && days <= 2;
    if (!inWindow) continue;
    events.push({
      id: `sweep-${f.nodeId}`,
      type: f.kind,
      title: f.title,
      scheduledAt: due,
      source: 'llm_sweep',
      confidence: 68,
      payload: {
        nodeId: f.nodeId,
        viaSweep: true,
        expiryDate: f.dueDate,
        ...(f.detail ? { detail: f.detail } : {}),
      },
    });
  }
  return events;
}
