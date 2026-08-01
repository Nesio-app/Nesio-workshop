/**
 * 歌词(2026-08-01,用户:「歌词从哪来 —— 和网易一起。本地没歌词的,
 * 都用网易歌词,即使是本地歌曲」)。
 *
 * 两件事:把 LRC 变成能逐行高亮的数组(纯函数,在这里),
 * 以及去哪儿要这份 LRC(见 lyrics-source.ts)。
 *
 * ── 三个不显然的地方 ────────────────────────────────────────────────────────
 *
 * ① **一行可以挂好几个时间戳**。`[00:12.00][01:30.00]副歌` 是 LRC 里省重复的
 *    常规写法。只认第一个的话,第二遍副歌整段不亮 —— 而且是**静默**地不亮:
 *    没有报错,只有用户觉得「歌词好像跟不上」。
 *
 * ② **元数据行不是歌词**。`[ti:晴天]` `[ar:周杰伦]` `[by:某某]` 长得和时间戳一样,
 *    不认出来就会在正片开始前先滚三行乱码似的东西。而 `[offset:-500]` 还得**用**上 ——
 *    它就是给那些整体早半拍/晚半拍的词做校正的。
 *
 * ③ **不保证有序**。同上,合并翻译时更是如此。所以解析完一定要排。
 */

export interface LyricLine {
  /** 毫秒。 */
  at: number;
  text: string;
  /** 翻译。没有就空串。 */
  translated: string;
}

/** `[ti:]` `[ar:]` `[al:]` `[by:]` `[offset:]` 这类。 */
const META_RE = /^\[(ti|ar|al|by|offset|re|ve|length|kana):(.*)\]$/i;
/** `[mm:ss.xx]` / `[mm:ss.xxx]` / `[mm:ss]`。 */
const STAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * LRC → 逐行。**空输入给空数组,不抛** —— 「这一首没有歌词」是常态
 * (纯音乐、冷门曲),不是异常。
 */
export function parseLrc(lrc: string): LyricLine[] {
  const src = String(lrc ?? '');
  if (!src.trim()) return [];

  let offsetMs = 0;
  const out: LyricLine[] = [];

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 元数据行。`[ti:]`/`[ar:]`/`[by:]` 这些**本来就走不到下面**(它们不匹配
    // 时间戳,stamps 会是空的),所以这里不为它们写「跳过」—— 写了也是一行
    // 永远为真、注入进去也不会红的死代码。这一段真正在做的只有一件事:
    // **把 offset 读出来**。它是整体早/晚半拍的词的校正值,不读就用不上。
    const meta = META_RE.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') {
        const v = Number(String(meta[2]).trim());
        if (Number.isFinite(v)) offsetMs = v;
      }
      continue;
    }

    STAMP_RE.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = STAMP_RE.exec(line)) !== null) {
      // 时间戳只在行首那一串里有效。正片里出现的 `[...]`(有些词里真有)不算。
      if (m.index !== lastEnd) break;
      lastEnd = m.index + m[0].length;
      const min = Number(m[1]) || 0;
      const sec = Number(m[2]) || 0;
      // `.5` 是 500ms,`.50` 也是 500ms,`.500` 还是 —— 补齐到三位再读
      const frac = m[3] ? Number(String(m[3]).padEnd(3, '0')) : 0;
      stamps.push(min * 60_000 + sec * 1000 + frac);
    }
    if (!stamps.length) continue;

    const text = line.slice(lastEnd).trim();
    // 空文本行(只有时间戳)照样留着 —— 那是间奏,留着才有「这里没词」的呼吸感,
    // 删掉的话上一句会一直亮到下一句,看着像卡住了。
    for (const at of stamps) out.push({ at, text, translated: '' });
  }

  if (offsetMs) for (const l of out) l.at = Math.max(0, l.at + offsetMs);
  // 一行挂多个时间戳时,展开出来的天然是乱的
  out.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * 把翻译并进主歌词。按**时间戳**配对,不按行号 ——
 * 翻译那份常常少几行(间奏行不翻),按行号配会整段错位,
 * 而错位的表现是「翻译对不上」,比没有翻译更糟。
 */
export function mergeTranslation(lines: readonly LyricLine[], translatedLrc: string): LyricLine[] {
  const tr = parseLrc(translatedLrc);
  if (!tr.length) return lines.map((l) => ({ ...l }));
  const byTime = new Map<number, string>();
  for (const t of tr) if (t.text) byTime.set(t.at, t.text);
  return lines.map((l) => ({ ...l, translated: byTime.get(l.at) || '' }));
}

/**
 * 当前该亮哪一行。返回 -1 = **还没开始**(前奏)。
 *
 * 这个 -1 是有意义的:前奏时高亮第一行,用户会以为词已经跟丢了。
 * 界面拿到 -1 就显示歌名/封面,等第一句真的来了再亮。
 */
export function activeLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  const t = Number(positionMs);
  if (!lines.length || !Number.isFinite(t)) return -1;
  // 二分:歌词行可以到几百行,而这个函数每帧都在跑。
  // **前奏(还没到第一句)自然落到 -1** —— 没有一行的时间戳 <= t,ans 保持初值。
  // 不另写一句 `if (t < lines[0].at) return -1`:那是一行永远和二分同结论的
  // 死代码,删掉它行为不变,留着只会让人以为前奏是被特判出来的。
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].at <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/* ── 本地 mp3 自带的词(ID3v2 USLT)────────────────────────────────────────── */

function readSynchsafe(b: Uint8Array, i: number): number {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function readUint32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 0) return new TextDecoder('latin1').decode(bytes);
    if (encoding === 1) return new TextDecoder('utf-16').decode(bytes);
    if (encoding === 2) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/**
 * 从 mp3 的字节里读内嵌歌词(ID3v2 的 USLT 帧)。读不到就空串。
 *
 * 为什么值得读:这是**本地曲目唯一自带**的词。用户从别处拷过来的 mp3
 * 常常是带词的,而带词的那一首去网易搜同名反而可能搜到另一个版本(时长对不上、
 * 词跟不上)。所以顺序是「自己带的优先,没有才去网易」。
 *
 * 只认 ID3v2.3 / v2.4(v2.2 的帧 id 是三个字母,极少见,不值当为它多一套解析)。
 * 任何一步不认得就返回空串 —— 解析 tag 失败绝不该把这首歌的播放一起打翻。
 */
export function readEmbeddedLyrics(bytes: Uint8Array): string {
  try {
    if (!bytes || bytes.length < 20) return '';
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return '';   // "ID3"
    const major = bytes[3];
    if (major !== 3 && major !== 4) return '';
    const tagSize = readSynchsafe(bytes, 6);
    const end = Math.min(bytes.length, 10 + tagSize);

    let p = 10;
    while (p + 10 <= end) {
      const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      // 帧 id 全零 = 走到了填充区
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      // v2.4 的帧长是 synchsafe,v2.3 是普通 32 位。用错的那个会把长度读大好几倍,
      // 于是当场走出 tag 外面 —— 表现是「有些 mp3 读得到词,有些读不到」。
      const size = major === 4 ? readSynchsafe(bytes, p + 4) : readUint32(bytes, p + 4);
      const body = p + 10;
      if (size <= 0 || body + size > end) break;

      if (id === 'USLT') {
        const encoding = bytes[body];
        // encoding(1) + language(3),然后是一段以 null 结尾的描述,再才是正文
        let q = body + 4;
        const wide = encoding === 1 || encoding === 2;
        const frameEnd = body + size;
        while (q < frameEnd) {
          if (wide) {
            if (bytes[q] === 0 && bytes[q + 1] === 0) { q += 2; break; }
            q += 2;
          } else {
            if (bytes[q] === 0) { q += 1; break; }
            q += 1;
          }
        }
        const text = decodeText(bytes.slice(q, frameEnd), encoding).replace(/\0+$/, '');
        if (text.trim()) return text;
      }
      p = body + size;
    }
    return '';
  } catch {
    return '';
  }
}
