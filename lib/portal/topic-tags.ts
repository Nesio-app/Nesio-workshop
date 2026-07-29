/**
 * topic-tags — 「这个标签算不算一个主题」的唯一判据(2026-07-29 QA #15)。
 *
 * 记忆详情底部的「主题门」(同标签 ≥3 条就出现,可点跳搜索)本来是个好东西,
 * 但它对所有 tag 一视同仁,于是用户在一条笔记下面看到的是:
 *   「Flomo · 1917 条」「主题 · 21 条」
 * 这两个都不是主题:
 *   · `Flomo` 是**导入来源标记** —— 点进去是「所有从 flomo 同步来的东西」,等于没筛;
 *   · `主题` 是 flomo 的层级标签 `#主题/健身` 被拆出来的第一段,是个分类前缀。
 * 用户的原话是「原始导入元数据没有清洗就直接暴露在用户可见的记忆详情里」——准确。
 *
 * 判据放这里一份:洞察页的主题统计和详情页的主题门都用它,不再各写一份名单。
 */

/** 系统标记(normalizer 系统标 / 采集方式标),不是主题。 */
const SYSTEM_TAGS = new Set(['联系人', '手动记录', '月报', 'Voice', '手写', '文件', 'file']);

/** 来源标记(哪个连接器同步来的),不是主题 —— 它命中的是「全部导入内容」。 */
const SOURCE_TAGS = new Set([
  'flomo', 'notion', 'keep', 'gmail', 'email', '邮件', 'calendar', '日历',
  'tesla', 'plaid', 'apple-health', 'wechat', '微信读书', 'drive',
]);

/** 层级标签被拆开后剩下的分类前缀(flomo 的 `#主题/健身` → `主题`),不是主题本身。 */
const PREFIX_TAGS = new Set(['主题', '分类', '标签', 'topic', 'category', 'tag']);

export function isTopicTag(tag: string): boolean {
  const t = String(tag || '').trim();
  if (!t) return false;
  if (SYSTEM_TAGS.has(t)) return false;
  if (SOURCE_TAGS.has(t.toLowerCase())) return false;
  if (PREFIX_TAGS.has(t.toLowerCase())) return false;
  return true;
}
