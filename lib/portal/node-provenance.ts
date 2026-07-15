/**
 * 节点 provenance / 不确定性 —— 单一真源(批次210,AI 幻觉信任横切)。
 *
 * 「不确定」= AI 抽取的低置信项(confidence<0.6):记忆卡标「待确认」交人核对,而不是把猜的当准的。
 * 此前该判定只活在 MemoryTab(UI 局部),而 guidance 层把聚焦卡 confidence 写死(88/85/90)、
 * 丢掉了节点真实抽取置信度 → AI 推断的到期能冒充「用户确认」发确信提醒(幻觉信任漏洞)。
 * 抽到这里当**横切一等公民**:记忆徽章与 guidance 置信度共用同一条「什么算不确定」的定义。
 *
 * 结构化入参(只看 confidence)—— LifeNode / FocusNode 都能传。
 */
export function isNodeUncertain(node: { confidence?: number }): boolean {
  return typeof node.confidence === 'number' && node.confidence > 0 && node.confidence < 0.6;
}

/** 节点抽取置信度(0-1)映射到 guidance 事件置信度(0-100)。缺失按较保守的 0.7 处理。 */
export function nodeConfidenceToGuidance(node: { confidence?: number }): number {
  const c = typeof node.confidence === 'number' ? node.confidence : 0.7;
  return Math.round(Math.max(0, Math.min(1, c)) * 100);
}
