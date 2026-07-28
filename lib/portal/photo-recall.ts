/**
 * photo-recall — 「拍一下 → 这东西我是不是已经记过」的召回。
 *
 * 2026-07-28,用户标注 图8/图9:「图片无法识别,刚存了一个笔,再拍一下就不认识了」。
 * 两个毛病叠在一起:
 *   ① 服务端抽取把「桌上一支笔」判成没有生命图谱条目 → nodes 为空(已在
 *      lib/extraction/extraction.ts 的图片专用指令里修);
 *   ② 就算认出来了,客户端只拿 nodes[].name 各查一次 searchLifeGraphFuzzy(name, 2) ——
 *      识别说「黑色钢笔」,记忆里存的是「笔」,长词查短名对不上(模糊搜索为防单字误命中,
 *      反向包含要求名字 ≥2 字),于是「记忆库里暂时没有找到相关记录」。
 *
 * 这里把召回口径放宽:识别出的**名字 + 标签 + 一句话描述**都当查询词,逐个查、按命中次数合并。
 * 纯本地(searchLifeGraphFuzzy 读本机图谱),不额外花钱,也不上传任何东西。
 */
import { searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';

export interface RecognizedThing {
  name: string;
  type?: string;
  tags?: string[];
}

/** 「黑色钢笔」→ ['黑色钢笔','钢笔','笔'];英文按词切。给短名字留一条命中路。 */
function widen(term: string): string[] {
  const t = term.trim();
  if (!t) return [];
  const out = [t];
  if (/[一-龥]/.test(t)) {
    // 中文:从右往左取后缀(中心词多在词尾 —— 钢笔/水笔/笔)。留到 1 字为止,
    // 单字词交给 searchLifeGraphFuzzy 自己的评分去压,不在这里放大。
    for (let i = 1; i < t.length && i <= 3; i += 1) out.push(t.slice(i));
  } else {
    for (const w of t.split(/[\s,/-]+/)) if (w.length >= 3) out.push(w);
  }
  return out;
}

/**
 * 按识别结果在本机记忆里找相关条目。
 * @param things 识别出的物件(name/tags)
 * @param summary 识别的一句话描述,兜底查询词
 * @param limit 最多返回几条
 */
export function recallByRecognition(things: RecognizedThing[], summary?: string, limit = 6): LifeNode[] {
  const terms: string[] = [];
  for (const t of things) {
    terms.push(...widen(t.name));
    for (const tag of t.tags || []) terms.push(...widen(tag));
  }
  if (summary) terms.push(summary);
  // 词长的先查(更精确),命中次数多的排前面。
  const seen = new Set<string>();
  const hits = new Map<string, { node: LifeNode; score: number }>();
  for (const term of terms.sort((a, b) => b.length - a.length)) {
    const key = term.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const node of searchLifeGraphFuzzy(term, 4)) {
      const prev = hits.get(node.id);
      // 长查询词命中更值钱(「黑色钢笔」命中 > 「笔」命中)。
      const weight = 1 + Math.min(term.length, 6) / 6;
      if (prev) prev.score += weight;
      else hits.set(node.id, { node, score: weight });
    }
  }
  return Array.from(hits.values())
    .sort((a, b) => b.score - a.score || new Date(b.node.createdAt).getTime() - new Date(a.node.createdAt).getTime())
    .slice(0, limit)
    .map((h) => h.node);
}
