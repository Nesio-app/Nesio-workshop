/**
 * memory-visibility — 「一条记忆算不算数」的唯一判据(2026-07-29 QA)。
 *
 * 用户在同一时刻看到两个不一样的记忆总数:
 *   · 记忆库首页「全部记忆 · 2534 条」
 *   · 设置 → 数据与隐私「2541 条记忆,全在本机」
 * 差的 7 条是天气快照 —— 记忆页早就把它们滤掉了(环境信号,进 Memory 只是噪音),
 * 而隐私页直接读了 getLifeGraph().length 的原始长度。两处各写各的口径,
 * 于是同一个「我有多少条记忆」给出两个答案,用户第一眼就发现了。
 *
 * 判据收到这里一份,谁要报数就调它。
 */
import type { LifeNode } from './life-graph';
import { isTagOnlyText } from './topic-tags';

/** 天气快照是环境信号,进 Memory 只会制造噪音(用户反馈「存在意义不明」)。 */
export function isWeatherNode(n: LifeNode): boolean {
  const tags = n.tags || [];
  return tags.includes('weather') || tags.includes('weather.forecast') || /天气信号$|^天气$/.test(n.name);
}

/**
 * 只有标签、没有正文的**导入**条目(bug #16)。
 * 同步侧的门只管**以后**;这些是**已经进来的**,得在展示这一层也认出来。
 * 不删数据 —— 万一判重了,原文还在图里,换个判据它就回来了。
 *
 * 2026-07-30 自查收窄:上一版对**所有**节点生效 —— 那意味着用户自己手打的一条
 * 「#健身 #跑步」也会被藏起来。而这条 bug 说的是**导入产生的空壳**,
 * 不是用户写的东西。判据里必须带上「它是导进来的」这一半:
 * 有导入来源标记(attributes.source / 连接器标签)才算。
 * 少了这一半,就是拿修 bug 当借口藏用户的字。
 */
const IMPORT_SOURCES = new Set(['flomo', 'notion', 'keep', 'weread', '微信读书']);

export function isTagOnlyImport(n: LifeNode): boolean {
  const src = String((n.attributes as Record<string, unknown> | undefined)?.source || '').toLowerCase();
  const tagged = (n.tags || []).some((t) => IMPORT_SOURCES.has(String(t || '').toLowerCase()));
  if (!IMPORT_SOURCES.has(src) && !tagged) return false;
  return isTagOnlyText(String(n.rawInput || '') || String(n.name || ''));
}

/**
 * 内部记账,不是用户的记忆(2026-08-01 用户实锤截图:「反馈:today/card_type/财务」
 * 「2026-07 · 训练」这类节点混进了记忆列表,显示成一堆生 key)。三类都验过零功能
 * 消费者读 visibleMemoryNodes/getLifeGraph 的展示路径 —— 各自的真实读口是
 * readFeedbackLog()(读 getSignals)、finance-aggregate/tesla-finance/domain-insights
 * (读 getLifeGraph 全量),藏起来不影响它们:
 *   · 反馈信号 —— feedback-log/retrieval-feedback/signal-feedback 统一盖
 *     `epistemic:'feedback'`,本来就是「元评价,不当记忆证据」。
 *   · 系统月报/摘要(健身训练次数等) —— monthly-digest 统一盖 `digestKind`。
 *   · 特斯拉行车/充电 —— normalizeTeslaDriveToSignal/ChargeToSignal 统一带
 *     `vehicleId`(source 落地后是 'system',和月报/财务报告同源,不能拿 source 分)。
 */
export function isInternalBookkeepingNode(n: LifeNode): boolean {
  const attrs = n.attributes as Record<string, unknown> | undefined;
  return attrs?.epistemic === 'feedback' || Boolean(attrs?.digestKind) || Boolean(attrs?.vehicleId);
}

/**
 * 用户**看得见**的记忆。
 * @param canUse 能否使用私密数据。
 *   · true  → 过滤天气/空壳导入/内部记账后返回
 *   · false → **一律空**(未登录/未知态)。旧行为只藏邮件/日历、仍露手记/照片,
 *             在共享设备或会话过期未登出时就是数据泄露;演示种子由 MemoryTab 另行注入。
 */
export function visibleMemoryNodes(nodes: readonly LifeNode[], canUse: boolean): LifeNode[] {
  if (!canUse) return [];
  return nodes.filter((n) => !isWeatherNode(n) && !isTagOnlyImport(n) && !isInternalBookkeepingNode(n));
}
