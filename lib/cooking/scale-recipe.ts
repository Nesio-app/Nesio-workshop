/**
 * scale-recipe — 把菜谱里的用量按人数缩放(2026-07-28,用户标注 图26:
 *「步骤里的克数是餐厅出餐量,自家做按人数缩着来」)。
 *
 * 营养那一栏早就按份算了(nutrition.ts 用 edibleG/450 估份数再除),但**配料和步骤的
 * 正文**一直是原样照抄的餐厅出餐量 —— 照着做就是一次做四人份。
 *
 * 这里只做一件事:把文本里的**用量**乘以一个系数,别的一个字不动。
 *
 * 最容易做错的是「什么算用量」。菜谱正文里全是数字:
 *   · 「约 15 分钟」「小火 3 分钟」   —— 时间,缩了就变成乱教人
 *   · 「180°C」「油温六成热」          —— 温度,缩了危险
 *   · 「切成 3 段」「分 2 次下锅」      —— 次数/份数,缩了语义就错
 *   · 「1/2 茶匙」                      —— 分数量,能缩但要保持可读
 * 所以走**白名单**:只有紧跟在数字后面的单位在 SCALABLE_UNITS 里才缩,其余一律不碰。
 * 宁可少缩几个,不能把时间和温度缩了。
 *
 * 纯函数,不碰 DOM/存储。契约测试:scripts/cooking-scale-recipe.test.mjs。
 */

/** 会跟着人数变的量。注意没有「分钟/秒/小时/度/成/次/段/根」—— 那些缩了就错。 */
const SCALABLE_UNITS = [
  'g', 'kg', 'ml', 'l', 'L',
  '克', '千克', '公斤', '毫升', '升',
  '汤匙', '茶匙', '大勺', '小勺', '勺', '杯',
  '个', '只', '片', '瓣', '颗', '把', '条', '块',
] as const;

// 拉丁和中文单位要分开匹配,前瞻规则不一样:
//   · 拉丁(g/kg/ml/l):后面不能再跟字母,否则「300 grams」里的 g 会被当成克;
//   · 中文(克/个/片…):后面**本来就接食材名**(「400 克胡萝卜」),不能加汉字前瞻 ——
//     第一版就是栽在这:给中文也加了 (?![\u4e00-\u9fa5]),结果一个中文用量都没缩到,
//     测试当场抓住。时间/温度/次数靠的是「不在白名单里」被挡掉,不靠前瞻。
const LATIN_UNITS = ['kg', 'g', 'ml', 'l', 'L'] as const;
const CJK_UNITS = SCALABLE_UNITS.filter((u) => !(LATIN_UNITS as readonly string[]).includes(u));
const byLenDesc = (arr: readonly string[]) => [...arr].sort((a, b) => b.length - a.length).join('|');

const LATIN_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${byLenDesc(LATIN_UNITS)})(?![a-zA-Z])`, 'g');
const CJK_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${byLenDesc(CJK_UNITS)})`, 'g');

/** 数字缩放后的可读写法:整数就整数;小数最多一位;小于 0.1 的托到 0.1(别出现 0 克)。 */
export function prettyAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 10) return String(Math.round(n));
  if (n >= 1) return String(Math.round(n * 10) / 10);
  const one = Math.round(n * 10) / 10;
  return String(one >= 0.1 ? one : 0.1);
}

/**
 * 把一段文本里的用量乘以 factor。factor<=0 或 ≈1 时原样返回(不做无谓改写)。
 *
 * 只改「数字 + 白名单单位」,时间/温度/次数一律不碰 —— 见文件头。
 */
export function scaleAmountsInText(text: string, factor: number): string {
  if (!text || !Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 0.01) return text;
  const rewrite = (whole: string, num: string, unit: string) => {
    const scaled = Number(num) * factor;
    if (!Number.isFinite(scaled)) return whole;
    return `${prettyAmount(scaled)} ${unit}`;
  };
  return text.replace(LATIN_RE, rewrite).replace(CJK_RE, rewrite);
}

/**
 * 目标人数 / 菜谱原本份数 = 缩放系数。
 * 两边都夹在合理区间:份数至少 1,人数 1–12(再多是办席,不是自家做)。
 */
export function servingFactor(targetServings: number, recipeServings: number): number {
  const target = Math.max(1, Math.min(12, Math.round(targetServings || 1)));
  const base = Math.max(1, Math.round(recipeServings || 1));
  return target / base;
}
