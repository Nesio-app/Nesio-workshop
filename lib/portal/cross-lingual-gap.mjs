/**
 * 跨语言检索缺口检测(可见失败纪律)。
 *
 * 检索的候选只来自 smartSearch 的"文本/实体命中"。中文问句("我的会议")在文本上
 * 匹配不到英文笔记("Team Meeting"),所以那些笔记根本进不了候选池;semanticRerank
 * 只重排候选池、且在没有 GEMINI_API_KEY 时静默退回文本序 —— 于是跨语言记忆被漏掉,
 * 而聊天却像"全都搜过了"一样作答。这违反项目自己的"可见失败纪律"。
 *
 * 这里不假装修好召回(那需要整库向量检索),而是诚实地告诉用户:另一种语言的记忆
 * 这次可能没被检索到。只在真的存在跨语言缺口时提示,避免噪音。
 */

/**
 * 一段文本的主导书写系统。只区分对召回真正重要的两类:汉字 vs 拉丁字母。
 * @param {string} text
 * @returns {'han' | 'latin' | 'none'}
 */
export function dominantScript(text) {
  const s = typeof text === 'string' ? text : '';
  let han = 0;
  let latin = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    // CJK 统一表意文字(含扩展 A 常用区)
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) han += 1;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
  }
  if (han === 0 && latin === 0) return 'none';
  return han >= latin ? 'han' : 'latin';
}

/**
 * 判断这次检索是否存在"跨语言召回缺口"。
 *
 * 触发条件(全部满足):
 *  1. 语义/向量重排本次没真正生效(embeddingsApplied=false),即文本召回是唯一召回;
 *  2. 问句有明确主导语言(han 或 latin);
 *  3. 记忆库里有相当比例(≥ minShare 且 ≥ minCount)的笔记是"另一种"语言 ——
 *     这些笔记纯文本召回够不到。
 *
 * @param {object} p
 * @param {string} p.query
 * @param {string[]} p.corpusTexts  记忆库节点的代表文本(名字/原文)采样
 * @param {boolean} p.embeddingsApplied  semanticRerank 是否真的用上了向量
 * @param {number} [p.minShare=0.15]
 * @param {number} [p.minCount=3]
 * @returns {{ gap: boolean; queryLang: 'han' | 'latin' | 'none'; otherCount: number }}
 */
export function detectCrossLingualGap({ query, corpusTexts, embeddingsApplied, minShare = 0.15, minCount = 3 }) {
  const queryLang = dominantScript(query || '');
  const texts = Array.isArray(corpusTexts) ? corpusTexts : [];

  // 向量重排生效时,语义至少有机会把已进池的跨语言笔记提上来;这里只管"文本召回是
  // 唯一召回"的退化情形。
  if (embeddingsApplied || queryLang === 'none') {
    return { gap: false, queryLang, otherCount: 0 };
  }

  const other = queryLang === 'han' ? 'latin' : 'han';
  let otherCount = 0;
  let scored = 0;
  for (const t of texts) {
    const lang = dominantScript(t);
    if (lang === 'none') continue;
    scored += 1;
    if (lang === other) otherCount += 1;
  }
  if (scored === 0) return { gap: false, queryLang, otherCount: 0 };

  const gap = otherCount >= minCount && otherCount / scored >= minShare;
  return { gap, queryLang, otherCount };
}
