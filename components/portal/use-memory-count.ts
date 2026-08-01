'use client';

/**
 * useMemoryCount —— 「我有多少条记忆」的**唯一**口径。
 *
 * ## 为什么需要这个 hook
 *
 * 之前每个要显示条数的地方各自算:有的 `getLifeGraph().length`、
 * 有的过滤一遍、有的读事实库。结果就是同一台设备上,
 * 体检卡说 2541 条、记忆库首页说 2534 条 —— 用户当场就发现了(2026-07-30 bug #14)。
 *
 * 那次的处理是把两个数**都**报出来并解释区别,那是对的(两个数各有各的用处:
 * 同步要比对全部节点,天气快照也得上云;记忆库报的是人会当成记忆的那些)。
 * 但「给人看的那个条数」只能有一个来源,不能每处重算一遍。这个 hook 就是那个来源。
 *
 * ## 口径 = `visibleMemoryNodes`
 *
 * 和记忆库列表**完全同一个谓词** —— 这条最重要:用户能翻到的东西,
 * 和数字说的必须是同一批。天气快照、纯标签导入不算;
 * 私密外部节点在无权限时不算(和列表一致)。
 *
 * ## `settled` 是干什么的
 *
 * 事实库(IDB)是异步水合的。水合前读到的是投影,水合后是「事实 ∪ 投影」——
 * 可能**更多**。也就是说开机头几秒里这个数字**注定会变一次**。
 *
 * 所以这里不掩饰,而是把「还会不会变」如实交出去:
 * `settled === false` 时调用方应当显示骨架,而不是先摆一个待会儿会变的数。
 *
 * 先给一个错的数再改,比转圈更伤信任 —— 用户会以为自己看错了,
 * 或者以为 App 弄丢了东西。这正是「打开头十秒数据跳来跳回」的观感来源。
 */

import { useCallback, useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { visibleMemoryNodes } from '@/lib/portal/memory-visibility';
import {
  isFactStoreHydrated,
  SIGNAL_FACT_STORE_HYDRATED_EVENT,
} from '@/lib/life-domain/signal-read-cache';

export interface MemoryCount {
  /** 给人看的条数。和记忆库列表同一个谓词。 */
  count: number;
  /**
   * 落定了没有。`false` = 事实库还在水合,这个数**待会儿可能变**。
   * UI 该显示骨架而不是这个数。
   */
  settled: boolean;
}

/**
 * @param canUsePrivate 有没有权限看私密外部节点。传法和记忆库列表保持一致 ——
 *   不一致的话数字和列表又会对不上,等于把 bug #14 换个地方重演一遍。
 */
export function useMemoryCount(canUsePrivate: boolean): MemoryCount {
  const read = useCallback(
    (): MemoryCount => {
      if (typeof window === 'undefined') return { count: 0, settled: false };
      try {
        return {
          count: visibleMemoryNodes(getLifeGraph(), canUsePrivate).length,
          settled: isFactStoreHydrated(),
        };
      } catch {
        // 读不出来时报 0 但标 settled —— 「读不到」和「还在读」要分开:
        // 前者是终态,后者会自己好。混在一起用户只会一直等。
        return { count: 0, settled: true };
      }
    },
    [canUsePrivate],
  );

  const [state, setState] = useState<MemoryCount>(() => ({ count: 0, settled: false }));

  useEffect(() => {
    const sync = () => setState(read());
    sync();
    // 两个事件都要听:
    //   · life-graph-updated —— 增删改
    //   · fact-store-hydrated —— 水合落定(这一下会让 settled 翻成 true)
    window.addEventListener('nesio-life-graph-updated', sync);
    window.addEventListener(SIGNAL_FACT_STORE_HYDRATED_EVENT, sync);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', sync);
      window.removeEventListener(SIGNAL_FACT_STORE_HYDRATED_EVENT, sync);
    };
  }, [read]);

  return state;
}
