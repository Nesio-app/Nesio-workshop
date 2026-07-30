/**
 * 卡片跳转 resolver —— 目标由源指纹确定性推导,**不让 AI 决定**(设计定稿 2026-07-29)。
 *
 * AI 自由生成路径 = 幻觉死链(车页三条死链的教训)。指纹前缀写明了来源,来源写明了归宿:
 *   calendar/memory → 记忆节点详情(日历事件本就是节点)
 *   email           → 该邮件的记忆节点详情(里面有「阅读原文」)
 *   inventory       → 收纳(nesio-open-inventory)
 *   plaid           → 洞察·财务
 *   domain:<域>-…   → 洞察对应板块(深链已覆盖全部 MainTab)
 *   天气等无归宿    → null(合法:渲染为无按钮纯信息卡)
 *
 * 硬契约:解析不出目标就不渲染按钮 —— 死按钮比没按钮糟。
 * 指纹格式(ai-judge.judgeFingerprint):`source:id:hash`。
 */

export type CardTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'insights'; tab: string }
  | { kind: 'module'; event: string; detail?: Record<string, unknown> };

/** InsightDomain → 洞察 MainTab(nesio-open-insights 深链已支持全部)。 */
const DOMAIN_TAB: Record<string, string> = {
  health: 'health',
  finance: 'finance',
  location: 'timeline',
  inventory: 'inventory',
  mood: 'reflection',
  relationship: 'relationships',
  reading: 'growth',
};

/** `source:id:hash` → { source, id }。id 里可能有冒号,故掐头去尾。 */
function parseFp(fp: string): { source: string; id: string } | null {
  const first = fp.indexOf(':');
  const last = fp.lastIndexOf(':');
  if (first < 0 || last <= first) return null;
  return { source: fp.slice(0, first), id: fp.slice(first + 1, last) };
}

/**
 * 从卡的指纹推导跳转目标。优先级:最具体的赢(节点详情 > 模块直开 > 洞察板块)。
 * anchorNodeIds:email id → 记忆节点 id 的映射(collector 随信号带出)。
 */
export function resolveCardTarget(
  fingerprints: readonly string[],
  anchorNodeIds?: Readonly<Record<string, string>>,
): CardTarget | null {
  const parsed = fingerprints.map(parseFp).filter((p): p is { source: string; id: string } => p !== null);

  for (const p of parsed) {
    if (p.source === 'calendar' || p.source === 'memory') {
      const nodeId = anchorNodeIds?.[p.id] ?? p.id;
      return { kind: 'node', nodeId };
    }
    if (p.source === 'email') {
      const nodeId = anchorNodeIds?.[p.id];
      if (nodeId) return { kind: 'node', nodeId };
    }
  }
  for (const p of parsed) {
    if (p.source === 'inventory') {
      return { kind: 'module', event: 'nesio-open-inventory', detail: { itemId: p.id } };
    }
    if (p.source === 'plaid') {
      return { kind: 'insights', tab: 'finance' };
    }
    if (p.source === 'domain') {
      const domain = p.id.split('-')[0];
      const tab = DOMAIN_TAB[domain];
      if (tab) return { kind: 'insights', tab };
    }
  }
  return null;
}

/** 执行跳转(浏览器侧)。node 目标由调用方处理(需要就地挂 MemoryNodeDetail);这里只发全局事件。 */
export function openCardTarget(target: CardTarget): boolean {
  if (typeof window === 'undefined') return false;
  if (target.kind === 'insights') {
    window.dispatchEvent(new CustomEvent('nesio-open-insights', { detail: { tab: target.tab } }));
    return true;
  }
  if (target.kind === 'module') {
    window.dispatchEvent(new CustomEvent(target.event, { detail: target.detail }));
    return true;
  }
  return false; // node:调用方就地打开详情
}
