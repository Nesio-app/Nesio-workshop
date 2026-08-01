/**
 * 自动往下找一首能放的(2026-08-01,用户:「网易歌现在不能自动切换源,我要一个个点。
 * 可以后台自动切换源,哪都没有,自动播放下一个」)。
 *
 * 在这之前:点一首受限的歌 → 弹一句「这一首有版权限制,换一首」→ 用户手动点下一首
 * → 又受限 → 再点。一批搜索结果里能放的常常只有三分之一,于是听一首歌要点五六次。
 * 这句话本身没错(受限确实只能换一首),错在**让人替机器做重试**。
 *
 * ── 这里最要紧的一条:blocked 必须立刻停 ────────────────────────────────────
 * 「这一首受限」和「整台被风控」的下一步完全相反:
 *   · restricted → 换一首**有用**,继续往下试;
 *   · blocked    → 换一首**一点用都没有**,每一首都会取不到。
 * 不区分的话,风控时这个函数会替用户把整个列表刷一遍 —— 五十个请求、几十秒的转圈,
 * 结果还是放不出来,而且这一串请求本身会让风控更严。
 * 所以 blocked 见一次就停,如实说「不是这一首的问题」。
 *
 * 这一层**不碰网络也不碰 audio**:探一首歌能不能放由调用方传进来(probe)。
 * 「往下试到哪儿为止」这件事必须能单独测 —— 不然只能靠手点着听来验,
 * 而它的错法(多试了几十次 / 该试的时候停了)恰恰是手点很难发现的。
 */

export type ProbeOutcome =
  | { kind: 'ok'; url: string }
  | { kind: 'restricted' }
  | { kind: 'blocked' }
  | { kind: 'failed' };

export interface AutoAdvanceOptions {
  /** 最多试几首。默认 12 —— 一屏搜索结果的量级。 */
  maxTries?: number;
  /**
   * 连续几次网络故障就停。默认 2。
   * 1 太急(偶发抖动就放弃),不设上限则是网断了还在那儿刷。
   */
  maxConsecutiveFailures?: number;
  /** 用户中途点了别的歌 —— 返回 true 就立刻收手。 */
  isCancelled?: () => boolean;
  /** 每试一首报一次,界面据此说「正在找能放的…(第 3 首)」。 */
  onTry?: (index: number, attempt: number) => void;
}

export interface AutoAdvanceResult {
  /** 放成的那一首在原列表里的下标。-1 = 一首都没放成。 */
  index: number;
  url: string;
  /** 跳过了几首受限的 —— 界面据此说「跳过了 4 首受限的」,而不是默默换了首歌。 */
  skipped: number;
  /**
   * 为什么停在这里。四种,四句不同的话:
   *   played    → 放上了
   *   blocked   → 整台被风控:换歌没用(**不是**「这些歌都受限」)
   *   offline   → 网络连着断了几次:该重试
   *   exhausted → 试完了都不能放:这就是用户说的「哪都没有」
   *   cancelled → 用户自己点了别的,什么都不用说
   */
  stop: 'played' | 'blocked' | 'offline' | 'exhausted' | 'cancelled';
}

/**
 * 从 order 给出的顺序里,从 startPos 开始往下找第一首能放的。
 *
 * @param order  播放顺序(queue.playOrder 的输出)。传的是**下标序列**,
 *               所以随机播放下自动往下试走的也是随机那条队列,不会突然按原顺序走。
 * @param startPos order 里的位置(不是曲目下标)。
 * @param probe  探一首能不能放。只有它碰网络。
 */
export async function findPlayable(
  order: readonly number[],
  startPos: number,
  probe: (index: number) => Promise<ProbeOutcome>,
  opts: AutoAdvanceOptions = {},
): Promise<AutoAdvanceResult> {
  const maxTries = Math.max(1, Math.trunc(opts.maxTries ?? 12));
  const maxFails = Math.max(1, Math.trunc(opts.maxConsecutiveFailures ?? 2));
  const none = (stop: AutoAdvanceResult['stop'], skipped: number): AutoAdvanceResult =>
    ({ index: -1, url: '', skipped, stop });

  if (!order.length) return none('exhausted', 0);
  let pos = Math.max(0, Math.trunc(startPos) || 0);
  let skipped = 0;
  let fails = 0;

  for (let attempt = 0; attempt < maxTries && pos < order.length; attempt++, pos++) {
    if (opts.isCancelled?.()) return none('cancelled', skipped);
    const index = order[pos];
    opts.onTry?.(index, attempt + 1);

    let r: ProbeOutcome;
    try {
      r = await probe(index);
    } catch {
      r = { kind: 'failed' };
    }
    // probe 期间用户点了别的 —— 这一首的结果已经不作数了,绝不能抢过去放
    if (opts.isCancelled?.()) return none('cancelled', skipped);

    if (r.kind === 'ok' && r.url) return { index, url: r.url, skipped, stop: 'played' };

    // 风控:换一首一点用都没有,立刻停。**这是这个函数存在的主要理由之一**
    if (r.kind === 'blocked') return none('blocked', skipped);

    if (r.kind === 'failed') {
      fails += 1;
      if (fails >= maxFails) return none('offline', skipped);
      continue;   // 网络抖了一下,不算「这一首受限」
    }

    fails = 0;
    skipped += 1;   // restricted(或 ok 但没给 url)
  }

  return none('exhausted', skipped);
}

/**
 * 停在这儿该说哪句话。抽成纯函数是为了**能真跑** ——
 * 这四句话的分歧点正是这一层的全部意义,埋在组件里就只能靠读源码确认。
 */
export function autoAdvanceMessage(r: AutoAdvanceResult, locale: 'zh' | 'en' = 'zh'): string {
  const zh = locale === 'zh';
  if (r.stop === 'played') {
    if (!r.skipped) return '';
    // 跳过了几首要说 —— 默默换一首,用户会以为自己点错了
    return zh
      ? `跳过了 ${r.skipped} 首取不到音频的,放的是往下第一首能放的`
      : `Skipped ${r.skipped} unavailable ${r.skipped === 1 ? 'track' : 'tracks'} and played the next one that works`;
  }
  if (r.stop === 'cancelled') return '';
  if (r.stop === 'blocked') {
    return zh
      ? '网易这会儿不接受这台服务器的请求 —— 跟具体哪一首没关系,换歌也一样。先用别的源,或者过一阵再来。'
      : 'NetEase is not accepting requests from this server right now — this is not about any one track, so switching tracks will not help. Use another source, or come back later.';
  }
  if (r.stop === 'offline') {
    return zh ? '网络连着几次没通,先停在这儿了。网好了再点一次。'
      : 'The network failed a few times in a row, so this stopped here. Try again once you are back online.';
  }
  return zh
    ? '往下找了一圈,这些都取不到音频。换个词搜搜看,或者把文件导进本地歌曲。'
    : 'Looked through the next few and none of them have audio. Try a different search, or import the file into local music.';
}
