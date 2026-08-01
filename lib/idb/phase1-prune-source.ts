/**
 * phase1-prune-source —— 迁移的**最后一步**:确认无误之后,删掉 localStorage 里的原件。
 *
 * ## 为什么单独写一个模块
 *
 * `executePhase1Migration()` 做了三件事:拷进 IDB → 校验 → 清旧备份。
 * **唯独没有删源。** 所以它是「拷贝」,不是「搬家」——
 * 迁完之后 IDB 里多了一份,localStorage 里那份**原封不动**。
 *
 * 而 localStorage 那 5MB 配额正是会爆的那个(IDB 通常有几百 MB 到几 GB)。
 * 也就是说这轮迁移解决的正是它没解决的那个问题:
 * 报告会写「✓ 成功迁移 N 项」,而实际可用空间**一个字节都没多**。
 *
 * 这种失败特别难发现,因为每一层都是绿的:迁移成功、校验通过、报告漂亮,
 * 只有配额没动。所以补这一步,并且让它自己报出「腾出了多少字节」——
 * 这个数字才是这件事有没有真做成的证据。
 *
 * ## 顺序不能反
 *
 * **拷 → 校验 → 删**,而且只删「校验通过的那些类别」。
 * 校验没过的类别原件必须留着 —— 那是唯一一份了。
 * 宁可白占空间,不可删完发现 IDB 那份是坏的。
 *
 * 同一台设备上重复跑是安全的:原件已经删了的话 `removeItem` 是空操作。
 */

import type { Phase1MigrationResult } from './phase1-migration';

export interface PruneResult {
  /** 真的删掉了几个 key。 */
  removed: number;
  /** 腾出来多少字节(按 UTF-16 估:JS 字符串每字符 2 字节)。 */
  freedBytes: number;
  /** 因为校验没过而**故意留着**的类别。留着是对的,不是遗漏。 */
  keptCategories: string[];
}

/**
 * 按迁移结果删源。
 *
 * @param result `executePhase1Migration()` 的返回值。
 */
export function pruneMigratedSources(result: Phase1MigrationResult): PruneResult {
  const out: PruneResult = { removed: 0, freedBytes: 0, keptCategories: [] };
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return out;

  for (const m of result.migrations) {
    // 只有 'success' 才删。'warning' 是校验有出入 —— 那正是最不该删源的情况。
    if (m.status !== 'success') {
      out.keptCategories.push(m.category);
      continue;
    }
    for (const key of m.keys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;         // 已经删过了(重复跑),不算数
        localStorage.removeItem(key);
        out.removed += 1;
        out.freedBytes += key.length * 2 + raw.length * 2;
      } catch {
        // 删不掉不是灾难:原件还在,IDB 那份也在,下次开机再试。
        // 不 logDropped —— 这里没有任何数据处于「可能丢失」的状态,
        // 而 logDropped 是给「用户的东西可能没存上」用的,别稀释它。
      }
    }
  }
  return out;
}
