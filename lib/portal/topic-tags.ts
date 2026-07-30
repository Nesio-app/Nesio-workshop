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

/**
 * 这段文字**只有标签、没有正文**吗(2026-07-30,bug #16)。
 *
 * flomo 里很常见:建标签时随手留的一行 `#主题/健身`。导进来就是一条
 * 名字叫「#主题/健身」、正文也是「#主题/健身」的「记忆」——
 * 用户在记忆库搜「健身」,第一条命中的就是这个内部分类标签本身。
 *
 * 同步侧的门 2026-07-29 已经加了,但**已经导进来的还在图里**,
 * 每次搜索照样再出现一次 —— 修了源头不等于修了现场。
 * 所以这条判据要能被两处共用:入库时挡,展示时也认得出来。
 *
 * 判据:去掉所有 `#标签` 之后**什么都不剩**。
 * 没有 # 的文本天然剩下它自己,所以这一条已经蕴含了「得真的是标签写法」——
 * 不用再单加一句 `includes('#')`(那句永远不会改变结果,是测不出来的死判断)。
 * 反过来必须守住的是另一边:有正文的**一定要留着**,那是真笔记,
 * 把它一起滤掉是另一种数据丢失。
 */
export function isTagOnlyText(text: string): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  return s.replace(/#[^\s#]+/g, '').trim() === '';
}
