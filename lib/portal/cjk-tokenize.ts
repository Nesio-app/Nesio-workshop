/**
 * 共享检索分词器 —— 中文自然语句没有空格,整句会被当成一个 token,
 * 导致「充电宝在哪」匹配不到记忆名「充电宝」(问一问被用户实测抓包)。
 * CJK 连续段拆 2/3-gram 作子词 token,「充电宝」「植物」「浇水」「编号」都能命中。
 *
 * 单一事实源:smart-search(深问/搜一搜)与 searchLifeGraphFuzzy(端上简答)共用,
 * 避免一处修了另一处漏(此前 smart-search 修过、life-graph 漏了 → 端上中文全灭)。
 */

// 批次 64:纯虚词字 —— 两个字都是虚词的 bigram(我的/是不/了吗)只添噪,不进 token
const CJK_STOP_CHARS = new Set('的了是我你他她它们在有不这那么吗呢吧就都也和跟给对把被让向从到要会能可还很挺再又');

export function tokenizeCJK(query: string): string[] {
  const out = new Set<string>();
  const base = query
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'""''()[\]{}]/g, ' ');
  for (const t of base.split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
    out.add(t);
    for (const run of t.match(/[一-鿿]{2,}/g) || []) {
      for (let i = 0; i < run.length - 1; i++) {
        const bi = run.slice(i, i + 2);
        if (!(CJK_STOP_CHARS.has(bi[0]) && CJK_STOP_CHARS.has(bi[1]))) out.add(bi);
      }
      for (let i = 0; i + 3 <= run.length; i++) out.add(run.slice(i, i + 3));
    }
    // 数字串(商品编号/订单号)单独成 token
    for (const d of t.match(/\d{3,}/g) || []) out.add(d);
  }
  return [...out];
}
