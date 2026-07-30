/**
 * module-merge —— 有些模块是「一堆按 id 的记录」,不是一张快照(2026-07-30,bug #29)。
 *
 * 用户报的现象:同一个账号,同一个财务入口,不同时间点打开会看到**三种互不相干的状态** ——
 * 一次是「收入 $10,672.93 / 支出 $4,273.21」,一次是「支出 $259.69」,还有一次是
 * 「还没有银行流水」。他自己的定性是对的:这是缓存 / 本机 / 云之间的同步问题。
 *
 * 查下来根因在通用模块同步(cloud-module-sync)的**冲突语义**上:
 * 它对每个 key 做「模块级 last-write-wins」—— 云端赢的时候,是**整键替换**。
 * 这对「一张快照」型的数据没问题(预算、报告设置),但银行流水/账户是**集合**:
 *
 *   · 每台设备各自从 Plaid 增量拉,`mergeBankTxForSync` 按 id upsert —— 本机是并集语义;
 *   · 两台设备的 Plaid 窗口、绑定的 item、拉取进度都可能不同;
 *   · 于是 A 有 500 笔、B 有 300 笔,谁后写谁赢,整键盖掉对方 —— 数字就这么跳。
 *
 * 这正是 life-graph 被排除在通用同步之外的同一个理由(那边的注释写着
 * 「避免双写 + replace 冲掉其 union 合并语义」)。银行流水是同一类东西,却漏在了里面。
 *
 * 所以:**这些 key 的云端那份只能并进来,不能整键替换**。
 *
 * 一个必须守住的细节:合并结果要**确定性**。两台设备拿到同一批记录必须产出
 * 逐字节相同的 JSON,否则内容哈希对不上,pull→push→pull 会无限互推。
 * 所以合并后一律按固定顺序重排,不保留任何一边的原始顺序。
 *
 * 权衡说在明处:并集意味着「一台设备删掉的记录,只要另一台还留着,就会被并回来」。
 * 但现在的整键替换**同样**会把它带回来(云端那份就是另一台的全量),
 * 而且还会顺手删掉本机独有的那些。并集在这条轴上不更差,在丢数据这条轴上明显更好。
 *
 * 纯函数,不碰存储、不碰网络。
 */

/** 这些模块是「按 id 的集合」。值 = 用哪个字段当 id。 */
export const ID_SET_MODULES: Record<string, string> = {
  // 银行流水:每台设备各自增量拉、按 id upsert(见 bank-tx.mergeBankTxForSync)
  'nesio-bank-tx-v1': 'id',
  // 银行账户:本机写入就是「只增合并」(见 bank-tx.saveBankAccounts),整键替换直接毁掉这个语义
  'nesio-bank-accounts-v1': 'id',
};

/** 并集上限,与 mergeBankTxForSync 的 cap 对齐 —— 不让多设备并集无限长大。 */
export const MERGE_CAP = 5000;

export interface MergeResult {
  json: string;
  /** 云端带进来、本机原本没有的条数。 */
  addedFromCloud: number;
  /** 本机独有、云端没有的条数(它们原来会被整键替换直接抹掉)。 */
  keptOnlyLocal: number;
}

/** 排序键:有 date 的按 date 降序,再按 id 升序。**两台设备必须排出一模一样的顺序**。 */
function sortKey(rec: Record<string, unknown>, idField: string): [string, string] {
  const date = typeof rec.date === 'string' ? rec.date : '';
  const id = String(rec[idField] ?? '');
  return [date, id];
}

/**
 * 把云端那份并进本机那份。
 *
 * @returns 解析不出数组(格式变了 / 不是这类数据)→ null,调用方回落到原来的判据。
 */
export function mergeIdSets(localJson: string | undefined, cloudJson: string, idField: string): MergeResult | null {
  let local: unknown;
  let cloud: unknown;
  try { local = localJson === undefined ? [] : JSON.parse(localJson); } catch { return null; }
  try { cloud = JSON.parse(cloudJson); } catch { return null; }
  if (!Array.isArray(local) || !Array.isArray(cloud)) return null;

  const byId = new Map<string, Record<string, unknown>>();
  const localIds = new Set<string>();
  // 先放云端,再放本机 —— 同 id 时**本机赢**:这台设备刚从 Plaid 拉过,它那份更新。
  for (const r of cloud as Record<string, unknown>[]) {
    const id = r && typeof r === 'object' ? String(r[idField] ?? '') : '';
    if (id) byId.set(id, r);
  }
  let addedFromCloud = byId.size;
  for (const r of local as Record<string, unknown>[]) {
    const id = r && typeof r === 'object' ? String(r[idField] ?? '') : '';
    if (!id) continue;
    localIds.add(id);
    if (byId.has(id)) addedFromCloud -= 1;
    byId.set(id, r);
  }
  const cloudIds = new Set((cloud as Record<string, unknown>[]).map((r) => (r && typeof r === 'object' ? String(r[idField] ?? '') : '')).filter(Boolean));
  let keptOnlyLocal = 0;
  for (const id of localIds) if (!cloudIds.has(id)) keptOnlyLocal += 1;

  const merged = [...byId.values()]
    .sort((a, b) => {
      const [da, ia] = sortKey(a, idField);
      const [db, ib] = sortKey(b, idField);
      if (da !== db) return da < db ? 1 : -1;   // date 降序(空 date 排最后)
      return ia < ib ? -1 : ia > ib ? 1 : 0;    // id 升序,保证确定性
    })
    .slice(0, MERGE_CAP);

  return { json: JSON.stringify(merged), addedFromCloud, keptOnlyLocal };
}

/** 这个 key 要不要走并集。 */
export function idFieldFor(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(ID_SET_MODULES, key) ? ID_SET_MODULES[key] : null;
}
