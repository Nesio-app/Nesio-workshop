/**
 * schedule-search —— 日程页(日历 / 收件 / 发件)的搜索(2026-07-30 用户要求:
 * 「日历和邮件增加搜索,模糊搜索,包括全文和 title」)。
 *
 * 「模糊」在这里的定义是**可预测的宽松**,不是语义联想:
 *   · 不区分大小写;
 *   · 全角字母数字先折成半角(中文输入法下打出的「Ａmazon」「１２３」照样命中);
 *   · 按空格切词,**每个词都要命中**(AND)—— 「学校 通知」是两个条件,不是一个短语;
 *   · 每个词是**子串**匹配,不需要整词对齐(这就是「模糊」的那一半);
 *   · 命中面 = 标题 + 副行(发件人/地点/日历名)+ 正文预览,再加上调用方补的本机全文。
 *
 * 刻意**不做**同义词、拼音、编辑距离纠错。这个仓库在「猜用户的意思」上翻过车
 * (「健身」被认成健康打卡),搜索尤其不能猜 —— 用户搜不到东西时,第一反应是
 * 「我记错了」还是「这软件坏了」,取决于规则他能不能在脑子里复现。
 *
 * 纯函数,不碰存储/DOM。
 */

/** 全角 ASCII(！~ ～)折半角。中文输入法下敲出来的字母数字很常见。 */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

export function normalizeForSearch(s: string): string {
  return toHalfWidth(s || '').toLowerCase();
}

/** 一次最多认 8 个词 —— 再多是误粘贴,不是搜索。 */
const MAX_TOKENS = 8;

/** 把输入框里的一串字切成词。空输入 → 空数组(= 不筛)。 */
export function searchTokens(q: string): string[] {
  return normalizeForSearch(q).split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
}

/** 一条日程/邮件在搜索眼里长什么样。 */
export interface SearchTarget {
  title: string;
  /** 副行:发件人 / 地点 / 日历名 / 收件人 */
  meta: string;
  /** 节点上带的正文预览(summary + article)。本机全文另走 fulltextHas。 */
  body: string;
}

/**
 * 每个词都要命中(AND)。
 *
 * fulltextHas 是「这个词在本机全文里有没有」——邮件全文只存本机 IndexedDB,
 * 不在节点上,所以由调用方注入。**没传 = 没有全文可查**,不是「算命中」:
 * 索引还没水合好的时候宁可少给结果,也不能给一个「明明搜不到却显示出来」的行。
 */
export function matchesSearch(
  t: SearchTarget,
  tokens: readonly string[],
  fulltextHas?: (token: string) => boolean,
): boolean {
  if (!tokens.length) return true;
  const hay = normalizeForSearch(`${t.title} ${t.meta} ${t.body}`);
  return tokens.every((tk) => hay.includes(tk) || Boolean(fulltextHas?.(tk)));
}
