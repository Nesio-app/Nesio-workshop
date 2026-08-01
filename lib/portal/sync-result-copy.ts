/**
 * 「立即同步」之后那一句话(2026-08-01,用户:「点了同步,总显示 1000,
 * 不知道数字,数据是否准确」)。
 *
 * 原来这句是在组件的 async 里现拼的,而且只有一个数 —— importedNodeCount。
 * 问题是那个数当时数的是**云端快照里的全部条数**,句子却写着
 * 「从云端取回 N 条**这台设备还没有的**记忆」。数字准确,回答的却是另一个问题;
 * 用户每次点同步都看到同一个大数,唯一能得出的结论就是「数据不准」。
 *
 * 抽出来是为了能**真跑**:埋在组件 async 里的字符串拼接,契约只能拿正则去
 * 源码里找「提到了这个字段没有」——而 `void mem.updatedNodeCount;` 这种
 * 一样能骗过它(第一版就是这么被注入回归抓出来的)。
 */

export interface SyncCounts {
  /** 这台设备**原本没有**、这次才取回来的。 */
  fresh: number;
  /** 本地已有、被云端那份更新覆盖过的。 */
  updated: number;
  /** 云端这次一共给了多少条。和上面两个不是一回事。 */
  total: number;
}

export function describeSyncResult(c: SyncCounts, zh: boolean): string {
  const fresh = Math.max(0, Math.trunc(c.fresh || 0));
  const updated = Math.max(0, Math.trunc(c.updated || 0));
  const total = Math.max(0, Math.trunc(c.total || 0));

  const parts: string[] = [];
  if (fresh > 0) {
    parts.push(zh
      ? `取回 ${fresh} 条这台设备还没有的记忆`
      : `pulled ${fresh} ${fresh === 1 ? 'memory' : 'memories'} this device didn't have`);
  }
  if (updated > 0) {
    parts.push(zh ? `${updated} 条按云端那份更新了` : `${updated} updated from the cloud`);
  }
  // 一条新的、一条更新的都没有,也要给个结局 —— 不许静默(「按了没反应」的根)
  if (!parts.length) {
    parts.push(zh ? '本机和云端本来就一致,没有新增' : 'already up to date, nothing new');
  }

  // 总数**永远说** —— 用户问的「数据是否准确」,要的就是一个能和记忆库对得上的数。
  const head = zh ? '✓ 已同步' : '✓ Synced';
  const tail = zh ? `云端一共 ${total} 条` : `${total} in cloud`;
  const refresh = fresh > 0 ? (zh ? ' · 下拉刷新看结果' : ' · pull to refresh') : '';
  return `${head} · ${parts.join(' · ')} · ${tail}${refresh}`;
}
