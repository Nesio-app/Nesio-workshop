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
import { isPrivateExternalNode, type LifeNode } from './life-graph';
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
 * 用户**看得见**的记忆。
 * @param canUse 能否使用私密数据(未登录/未确认账户时,私密外部节点一律不出现)。
 */
export function visibleMemoryNodes(nodes: readonly LifeNode[], canUse: boolean): LifeNode[] {
  const base = nodes.filter((n) => !isWeatherNode(n) && !isTagOnlyImport(n));
  return canUse ? base : base.filter((n) => !isPrivateExternalNode(n));
}
