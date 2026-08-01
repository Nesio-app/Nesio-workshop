/**
 * 「问念念」的取材层(2026-07-31)。
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────
 * 用户这一轮把所有问念念入口都指向了真对话页(NesioChatSheet)。切完之后一核对,
 * 发现两边的**检索能力不是一档**:
 *   · 语音 sheet 的 ask 形态 —— 语义检索(Signal 事实面)+ 已登录时的云端 RAG 回溯,
 *     再和本地模糊、近期节点并轨;
 *   · 对话页 —— 只有 `searchLifeGraphFuzzy`(本地字面模糊)。
 *
 * 也就是说,光切入口的话,用户会换到一个**界面对了、答得更差**的地方 ——
 * 而这种损失他不会当场发现,是几周后「怎么问什么都想不起来」那种。
 * 所以取材这件事收到这里,两边共用同一份,不再各写各的。
 *
 * ── 为什么云端那一路只给已登录用户 ────────────────────────────────────────
 * 本地事实缓存只是全量图谱的**近端切片**;更早的、或者只落在云上的事实要回捞
 * (OPEN-WORLD ②)。未登录/未知态不打云,也不把私密外部节点(邮件主题、日程标题)
 * 带进结果 —— 这条隐私红线在**每一层**都要过一遍,不能只在最后拼字符串时才想起来。
 */

import {
  getRecentNodes, isPrivateExternalNode, searchLifeGraphFuzzy, type LifeNode,
} from './life-graph';
import { searchSignalsSemantically, searchSignalsWithCloudFallback } from '../life-domain/signal-search';
import { signalToLifeNode } from '../life-domain';

export interface AskRetrievalOptions {
  /** 已登录且允许读私密数据。false = 不打云,也不带出邮件/日程这类外部私密节点。 */
  canUsePrivateData: boolean;
  /** 最多给多少条。默认 60 —— 再多对答案没帮助,只是把 prompt 撑大。 */
  limit?: number;
}

/**
 * 给「问念念」凑一份候选材料。
 *
 * 顺序就是**可信度顺序**,不是随手排的:
 *   ① 语义命中(已登录先经云端回溯)—— 真正「跟这句话有关」的;
 *   ② 本地字面模糊 —— 语义漏掉的、但字面对得上的(人名、单号这类);
 *   ③ 最近的节点 —— 兜底的上下文,让它至少知道你最近在忙什么。
 * 去重按 id,先到先得 —— 所以①里出现过的不会被②③挤下去。
 *
 * best-effort:云端不可达时 searchSignalsWithCloudFallback 内部自己回退纯本地,
 * 这里不额外 try —— 它不抛。
 */
export async function retrieveForAsk(q: string, opts: AskRetrievalOptions): Promise<LifeNode[]> {
  const text = String(q || '').trim();
  if (!text) return [];
  const { canUsePrivateData, limit = 60 } = opts;
  const allowed = (n: LifeNode) => canUsePrivateData || !isPrivateExternalNode(n);

  const semanticSignals = canUsePrivateData
    ? await searchSignalsWithCloudFallback(text, 30)
    : searchSignalsSemantically(text, 20);
  const semanticFirst = semanticSignals.map(signalToLifeNode).filter(allowed);
  const fuzzyFirst = searchLifeGraphFuzzy(text, 20).filter(allowed);
  const recent = getRecentNodes(80).filter(allowed);

  const seen = new Set<string>();
  const merged: LifeNode[] = [];
  for (const n of [...semanticFirst, ...fuzzyFirst, ...recent]) {
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    merged.push(n);
  }
  return merged.slice(0, Math.max(1, limit));
}
