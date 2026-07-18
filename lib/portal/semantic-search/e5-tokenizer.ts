/**
 * XLM-RoBERTa / multilingual-e5 分词器移植(SentencePiece Unigram)。
 *
 * 管线(对齐 HF tokenizer.json,29+5 条中英/符号/emoji/空白边界黄金用例全过):
 *   1. 归一化:NFKC —— 近似 SentencePiece 的 Precompiled charsmap(对 CJK+拉丁足够,
 *      浏览器原生 String.normalize 与 Python unicodedata 在这些用例上一致)。
 *   2. Replace:连续 2+ 空格折成 1(tokenizer.json 的 Replace 规则)。
 *   3. Metaspace:空格→▁,且序列以单个 ▁ 开头(已以▁开头就不再补,避免双▁)。
 *   4. Unigram Viterbi:在词表上找总分最高的切分;切不出的位置退化为单步 <unk>。
 *   5. 合并连续 <unk>(SentencePiece 把整段未知折成一个 unk;顺带修代理对被按码元拆开)。
 *   6. 包 <s> … </s>。
 *
 * ⚠️ NFKC 是近似而非字节级复刻 Precompiled;对罕见字符可能与 HF 有个别分歧 → 少数 token
 *    偏差 → 嵌入轻微不同。检索(非生成)对此鲁棒;selfTest 覆盖常见面,回归有黄金用例兜。
 */

export interface E5TokenizerData {
  /** 词表:index 即 token id(unigram 有序),值为 [piece, score]。 */
  vocab: Array<[string, number]>;
  unkId: number;
  bosId: number;
  eosId: number;
}

export interface E5GoldenCase {
  text: string;
  ids: number[];
}

export class E5Tokenizer {
  private id = new Map<string, number>();
  private score = new Map<string, number>();
  private maxLen = 1;
  private readonly unkId: number;
  private readonly bosId: number;
  private readonly eosId: number;

  constructor(data: E5TokenizerData) {
    data.vocab.forEach(([piece, s], i) => {
      this.id.set(piece, i);
      this.score.set(piece, s);
      if (piece.length > this.maxLen) this.maxLen = piece.length;
    });
    this.unkId = data.unkId;
    this.bosId = data.bosId;
    this.eosId = data.eosId;
  }

  encode(text: string): number[] {
    let t = text.normalize('NFKC').replace(/ {2,}/g, ' ');
    t = t.replace(/ /g, '▁');
    if (!t.startsWith('▁')) t = '▁' + t;

    const n = t.length;
    const bestScore = new Array<number>(n + 1).fill(-1e30);
    const bestPrev = new Array<number>(n + 1).fill(-1);
    bestScore[0] = 0;
    for (let i = 1; i <= n; i++) {
      const from = Math.max(0, i - this.maxLen);
      for (let j = from; j < i; j++) {
        const sc = this.score.get(t.slice(j, i));
        if (sc !== undefined && bestScore[j] + sc > bestScore[i]) {
          bestScore[i] = bestScore[j] + sc;
          bestPrev[i] = j;
        }
      }
      if (bestPrev[i] === -1) { bestScore[i] = bestScore[i - 1] - 1e4; bestPrev[i] = i - 1; } // 单步 <unk> 兜底
    }

    const raw: number[] = [];
    let i = n;
    while (i > 0) {
      const j = bestPrev[i];
      const piece = t.slice(j, i);
      const hit = this.id.get(piece);
      raw.push(hit === undefined ? this.unkId : hit);
      i = j;
    }
    raw.reverse();

    const ids: number[] = [];
    for (const x of raw) {
      if (x === this.unkId && ids[ids.length - 1] === this.unkId) continue; // 合并连续 unk
      ids.push(x);
    }
    return [this.bosId, ...ids, this.eosId];
  }

  /** 黄金用例对拍:返回分词与标准答案不一致的 text 列表(空=全过)。 */
  selfTest(golden: E5GoldenCase[]): string[] {
    const bad: string[] = [];
    for (const g of golden) {
      const got = this.encode(g.text);
      if (got.length !== g.ids.length || got.some((v, k) => v !== g.ids[k])) bad.push(g.text);
    }
    return bad;
  }
}
