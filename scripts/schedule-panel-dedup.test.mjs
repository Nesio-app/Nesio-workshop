/**
 * 行为契约:日程页(洞察 → 日程)的重复与日期(真机实锤 2026-07-29,截图两条同名会议)。
 *
 * 三个病灶,每条都钉死修法:
 *  ① **富化抹字段**:ingestLifeNode 的 externalKey upsert 走 updateLifeNode,而后者是
 *     顶层浅合并 —— patch.attributes 会整块盖掉旧的。Gmail 先用本地抽取落节点
 *     (带 date/summary/article/store/eta/amount/orderNo/trackingNo),随后云 AI 富化
 *     只带 AI 那几个字段 → 上述全没了,日程页邮件日期集体退回 createdAt。
 *     修:upsert 时 attributes 合并(新值优先、旧值补位)。
 *  ② **无主富化节点**:AI 富化认不出源邮件时没有 emailId → 客户端 externalKey 为 null →
 *     每轮富化都新建一个节点(去重不掉的重复)。修:认不出就丢弃这条富化。
 *  ③ **跨日历同一场会**:订阅了同一场会的多个日历,start 字符串时区写法不同
 *     (Z / +08:00),同步侧按原文比对认不出 → 两个节点。修:展示层按「标题|绝对时刻」再收一次。
 *
 * 外加:日程页必须**优先用 Gmail 官方分类**(mailCategory,由 labelIds 归一而来),
 * 而不是自己猜关键词 —— 数据源自带的判定比本地正则准。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── ① upsert 合并 attributes(不整体替换) ──
const ingest = read('../lib/life-domain/ingest-node.ts');
assert.match(
  ingest,
  /attributes: \{ \.\.\.existing\.attributes, \.\.\.\(input\.attributes \|\| \{\}\) \}/,
  'externalKey upsert 必须合并 attributes —— 整体替换会让云 AI 富化抹掉本地抽取的 date/summary/article',
);
assert.ok(
  !/updateLifeNode\(existing\.id, input\);/.test(ingest),
  '不能再把原始 input 直接交给 updateLifeNode(顶层浅合并 = attributes 整块被盖)',
);

// ── ② 富化认不出源邮件就丢弃 ──
const gmail = read('../app/api/portal/gmail/route.ts');
assert.match(gmail, /if \(!emailId\) return null;/, 'AI 富化节点没有 emailId 就不落库(否则每轮建一个重复)');
assert.match(gmail, /date: header\(src, 'date'\)/, '富化节点的时间以邮件头为准(AI 抽取常不带 date)');

// ── ③ 展示层去重 + 官方分类 ──
const panel = read('../components/portal/insights/SchedulePanel.tsx');
assert.match(panel, /const k = `\$\{r\.title\}\|\$\{ms\(r\)\}`/, '日历项按「标题|绝对时刻」去重(抹平跨日历的时区写法差异)');
assert.match(panel, /o\.node\.attributes\?\.emailId === eid/, '邮件按 emailId 去重(兜住历史重复节点)');
assert.match(panel, /a\.mailCategory/, '必须消费 Gmail 官方分类字段(mailCategory),不能只靠本地正则猜广告');
assert.match(panel, /cat === 'promotions' \|\| cat === 'social'/, 'promotions/social 用 Google 的判定直接毙');
assert.match(panel, /!cat && AD_RE\.test\(hay\)/, '本地广告正则降级为「没有官方分类时」的兜底');

// 邮件排序必须按时刻,不能按字符串(RFC2822 头「Tue, 29 Jul…」字符串比大小是错的)
assert.match(panel, /new Date\(x\.dateIso\)\.getTime\(\)/, '邮件按绝对时刻排序,不按日期字符串');

// gmail 路由确实在读 labelIds(分类字段的来源)
assert.match(gmail, /CATEGORY_PROMOTIONS/, 'labelIds 里的 Gmail 系统分类是 mailCategory 的来源');
assert.match(gmail, /mailCategory: cat/, '分类结果要落到节点 attributes 供下游消费');

console.log('schedule-panel-dedup: OK(富化不抹字段 / 无主节点丢弃 / 跨日历去重 / 用 Gmail 官方分类)');
