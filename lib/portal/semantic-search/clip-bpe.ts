/**
 * CLIP BPE tokenizer — open_clip SimpleTokenizer 的 TS 移植(Lab 语义搜索用)。
 *
 * 数据(词表/merges)由 nesio-ml 的 export_tokenizer.py 导出到 /lab/tokenizer.json;
 * 正确性不靠信仰,靠 /lab/tokenizer-golden.json 逐 id 对拍(selfTest)。
 */

export interface TokenizerData {
  vocab: Record<string, number>;
  merges: string[];
  context_length: number;
}

export interface GoldenCase { text: string; ids: number[] }

/** GPT-2 系的 byte→unicode 可逆映射(和 Python bytes_to_unicode 逐字节一致)。 */
function bytesToUnicode(): string[] {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n += 1; }
  }
  const table = new Array<string>(256);
  bs.forEach((b, i) => { table[b] = String.fromCharCode(cs[i]); });
  return table;
}

const SPLIT_PAT = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;

export class ClipBpe {
  private vocab: Record<string, number>;
  private ranks = new Map<string, number>();
  private byteEnc = bytesToUnicode();
  private cache = new Map<string, string>();
  readonly contextLength: number;
  private sot: number;
  private eot: number;

  constructor(data: TokenizerData) {
    this.vocab = data.vocab;
    this.contextLength = data.context_length;
    data.merges.forEach((m, i) => this.ranks.set(m, i));
    this.sot = data.vocab['<|startoftext|>'];
    this.eot = data.vocab['<|endoftext|>'];
  }

  private bpe(token: string): string {
    const hit = this.cache.get(token);
    if (hit !== undefined) return hit;
    let word: string[] = [...token.slice(0, -1)].concat(token.slice(-1) + '</w>');
    if (word.length === 1) { this.cache.set(token, word[0]); return word[0]; }

    for (;;) {
      let bestRank = Infinity;
      let first = '', second = '';
      for (let i = 0; i < word.length - 1; i++) {
        const r = this.ranks.get(word[i] + ' ' + word[i + 1]);
        if (r !== undefined && r < bestRank) { bestRank = r; first = word[i]; second = word[i + 1]; }
      }
      if (bestRank === Infinity) break;
      const next: string[] = [];
      let i = 0;
      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) { next.push(...word.slice(i)); break; }
        next.push(...word.slice(i, j));
        i = j;
        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          next.push(first + second);
          i += 2;
        } else {
          next.push(word[i]);
          i += 1;
        }
      }
      word = next;
      if (word.length === 1) break;
    }
    const out = word.join(' ');
    this.cache.set(token, out);
    return out;
  }

  encode(text: string): number[] {
    const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const ids: number[] = [];
    const enc = new TextEncoder();
    for (const tok of clean.match(SPLIT_PAT) ?? []) {
      const mapped = Array.from(enc.encode(tok), (b) => this.byteEnc[b]).join('');
      for (const piece of this.bpe(mapped).split(' ')) {
        const id = this.vocab[piece];
        if (id !== undefined) ids.push(id);
      }
    }
    return ids;
  }

  /** 输出定长 [context_length] 的 int64 ids(sot…eot,零填充),给 TextEncoder.onnx。 */
  tokenize(text: string): BigInt64Array {
    let ids = [this.sot, ...this.encode(text), this.eot];
    if (ids.length > this.contextLength) {
      ids = ids.slice(0, this.contextLength);
      ids[this.contextLength - 1] = this.eot;
    }
    const out = new BigInt64Array(this.contextLength);
    ids.forEach((v, i) => { out[i] = BigInt(v); });
    return out;
  }

  /** 黄金用例对拍:全部逐 id 一致才算移植正确。返回失败清单(空=通过)。 */
  selfTest(golden: GoldenCase[]): string[] {
    const bad: string[] = [];
    for (const g of golden) {
      const got = this.tokenize(g.text);
      const want = g.ids;
      const same = got.length === want.length && want.every((v, i) => got[i] === BigInt(v));
      if (!same) bad.push(g.text);
    }
    return bad;
  }
}
