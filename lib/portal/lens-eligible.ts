/**
 * 哪些记忆该出现「镜头」入口(2026-08-01,用户:「镜头看看改为镜头 2 个字,
 * 只出现在,手记,note,flomo,阅读笔记,心情类这些详情页」)。
 *
 * 为什么要限:镜头是**把一段话看清楚**——它对着的是人写下来的字。
 * 一封银行对账单、一个日历事件、一件衣柜里的物品,底下没有话可看,
 * 给它一个「镜头」按钮就是一条点了之后发现无话可说的路。
 *
 * 判据是**正向白名单**,不是「排除掉邮件和日历」——
 * 后者每加一种新来源就漏一次,而漏的方向是「多出一个没用的按钮」,
 * 不会有人报 bug,于是永远长在那儿。
 */


/** 用户点名的五类。tags 里出现这些词就算(来源标签在这个仓里是中英混着记的)。 */
const LENS_TAGS = [
  'flomo', 'notion', 'keep',          // 笔记类外部来源
  '手记', 'note',
  '阅读笔记', '读书笔记', 'weread', '微信读书', '阅读',
  '心情', 'mood', '情绪',
];

export interface LensCandidate {
  type?: string;
  source?: string;
  tags?: readonly string[];
}

/**
 * 有结构的类型:它们的详情页是一张表(在哪、多少钱、谁、什么时候),
 * 不是一段话。手动登记的一件物品仍然是物品 —— 镜头对着它没有话可看。
 */
// 2026-08-01 改名批:Mind 合并了旧 health_state(结构化,原在这张表里,没镜头)与
// preference(是一段话,原不在这张表里,靠下面的 manual/voice 分支拿到镜头)——
// 两边行为相反,不能简单地把 Mind 塞进/踢出这张表。折中偏向"多给一个镜头"
// 而不是"少给"(丢镜头=丢功能,多一个用不上的按钮成本更低),Mind 不进这张表。
const STRUCTURED = new Set(['Thing', 'place', 'person', 'event']);

export function isLensEligible(node: LensCandidate | null | undefined): boolean {
  if (!node) return false;
  if (node.type === 'collection') return true;

  // 心情/笔记类来源:靠 tag 认(mood 在这个仓里不是独立 type)。
  // 这一支不看 type —— 一条打了「心情」的记录,不管它被归成什么,底下都是话。
  const tags = (node.tags || []).map((t: string) => String(t).toLowerCase());
  if (LENS_TAGS.some((k) => tags.includes(k.toLowerCase()))) return true;

  // 手记 = 自己说/写下来的那一条。但**手动登记的物品/地点/人不算** ——
  // 那些的详情页是一张表,不是一段话,给它镜头就是一条无话可说的路。
  if ((node.source === 'manual' || node.source === 'voice') && !STRUCTURED.has(String(node.type || ''))) return true;

  return false;
}
