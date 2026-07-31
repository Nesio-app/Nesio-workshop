/**
 * 播放队列(2026-07-30)。纯函数,不碰 audio 元素、不碰存储 ——
 * 「下一首是哪首」这件事必须能单独测,不然只能靠手动点着听来验。
 *
 * 一条明确的取舍:随机是**确定性洗牌**(种子决定顺序),不是每次现掷骰子。
 * 理由不是洁癖:
 *   · 现掷骰子会重复(刚放过的又来),用户会觉得「随机坏了」;
 *   · 「上一首」在真随机下无法回退到刚才那首 —— 那是最常被点的键之一。
 * 有了序列,上一首/下一首都只是在序列里挪一格。
 */

export type RepeatMode = 'off' | 'one' | 'all';

/**
 * 确定性洗牌(Fisher-Yates + 线性同余)。同一个 seed 永远得到同一个顺序 ——
 * 换页回来接着放的是同一条队列,不会莫名其妙重排。
 */
export function shuffleOrder(len: number, seed: number): number[] {
  const out = Array.from({ length: Math.max(0, len) }, (_, i) => i);
  let s = (Math.floor(seed) || 1) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 顺序播时的队列就是自然顺序 —— 两种模式共用同一套「在序列里挪一格」的逻辑。 */
export function playOrder(len: number, shuffle: boolean, seed: number): number[] {
  return shuffle ? shuffleOrder(len, seed) : Array.from({ length: Math.max(0, len) }, (_, i) => i);
}

/**
 * 下一首的曲目下标。返回 null = **到头了,该停**。
 *
 * 这个 null 是有意义的:不返回 null 就只能让调用方猜「是不是该停」,
 * 而猜错的表现是列表放完又从头开始,用户睡前放的歌一整夜没停过。
 *
 * @param current 当前曲目在**原始列表**里的下标(不是序列下标)
 * @param order   playOrder() 给出的序列
 * @param mode    'one' 由播放器自己处理(同一首重来),这里只管 off/all
 * @param auto    true = 一首放完自动续;false = 用户按了「下一首」。
 *   两者不同:单曲循环时**自动**应该原地重来,而**手动**按下一首必须真的换歌 ——
 *   否则用户按十次都在听同一首,像按键坏了。
 */
export function nextIndex(
  current: number,
  order: readonly number[],
  mode: RepeatMode,
  auto: boolean,
): number | null {
  if (!order.length) return null;
  if (mode === 'one' && auto) return current;
  const pos = order.indexOf(current);
  if (pos < 0) return order[0] ?? null;
  if (pos + 1 < order.length) return order[pos + 1];
  return mode === 'all' ? (order[0] ?? null) : null;
}

/**
 * 上一首。永远返回一个下标(不返回 null)——「上一首」在列表头按下去时
 * 回到最后一首是所有播放器的通行做法,停住反而像卡了。
 */
export function prevIndex(current: number, order: readonly number[]): number | null {
  if (!order.length) return null;
  const pos = order.indexOf(current);
  if (pos <= 0) return order[order.length - 1] ?? null;
  return order[pos - 1];
}
