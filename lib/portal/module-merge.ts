/**
 * module-merge —— 通用模块同步里**并集语义**那几个 key 的合并规则。
 *
 * ## 病灶
 *
 * `cloud-module-sync` 对每个 key 做**模块级 last-write-wins**,云端赢的时候是**整键替换**。
 * 快照型数据(设置、当前体重、主题)这样没问题 —— 那种数据的语义就是「最新的那份是对的」。
 *
 * 但银行流水/账户在本机是**并集语义**:按 id upsert、账户只增合并。两台设备的 Plaid
 * 拉取窗口和游标进度不同 —— A 有 500 笔、B 有 300 笔。谁后写谁赢,**对方独有的那部分
 * 直接没了**。而且没有任何界面会报错:你只会发现「上个月的交易怎么少了一截」。
 *
 * `life-graph` 早就因为同一个理由被排除在通用同步外(它有自己的 union 合并),
 * 银行流水漏在了里面。
 *
 * ## 三条规矩(缺一条就不收敛)
 *
 *   ① **只并不替换** —— 两边的记录按 id 取并集。本机独有的、云端独有的,一条都不能少。
 *
 *   ② **结果确定性重排** —— 合并完必须按同一个全序重排、字段顺序也归一。
 *      两台设备算出的 JSON 必须**逐字节相同**,否则内容哈希对不上:
 *      A 觉得自己改过 → 推给云;B 拉下来觉得自己改过 → 推给云 …… **无限互推**,
 *      流量和电量白烧,而且数据其实一模一样。
 *
 *   ③ **并完不写 state** —— 合并出来的是「本机原来没有的超集」,必须让它被当成
 *      「本机改过」,下一轮 push 才会把超集推上去。写了 state 就等于告诉系统
 *      「本机和云端一致」,超集永远上不去,另一台设备也就永远拿不到。
 *
 * ## 字段冲突怎么办
 *
 * 同一个 id 两边都有、但某个字段不一样(A 富化出了商户 logo,B 还没有)。
 * 规则:**有值的赢空的;两边都有值且不同,取序列化后字典序小的那个**。
 *
 * 后半条看起来武断,但它是**对称**的 —— 两台设备算出同一个结果,所以一轮就收敛。
 * 换成「本机赢」就不对称了:A 留自己的、B 留自己的,永远谈不拢,又回到无限互推。
 * 对 BankTx 来说冲突字段本来就少(Plaid 是同一个权威源),代价可以接受。
 */

/** 需要并集合并的 key → 用哪个字段当身份。不在表里的 key 走原来的 LWW。 */
export const MERGE_KEYS: Readonly<Record<string, string>> = {
  // 银行流水:按 id upsert(与本机 mergeBankTxForSync 同一语义)
  'nesio-bank-tx-v1': 'id',
  // 账户:只增合并 —— 一台设备连了 Chase、另一台连了 BoA,两个都该留着
  'nesio-bank-accounts-v1': 'id',
  // 持仓:按 id(accountId|ticker|name)。⚠️ 历史数据可能没写 id 字段 ——
  // rowIdentity 会合成;若仍拿不到身份,绝不能 silently skip 成 [](那会清空投资页)。
  'nesio-fin-holdings-v1': 'id',
};

type Row = Record<string, unknown>;

export function needsUnionMerge(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(MERGE_KEYS, key);
}

/**
 * 取一行的并集身份。持仓历史上没有 id(Plaid 落库只写 accountId/name/ticker),
 * 若只认 row.id,两边全被 skip → merge 出 `[]` → 云同步 replace 本机 →
 * 再 push 把云也盖空。这就是「退出/回前台后投资持仓消失」。
 */
export function rowIdentity(key: string, row: Row, idField: string): string {
  const direct = String(row[idField] ?? '');
  if (direct) return direct;
  if (key === 'nesio-fin-holdings-v1') {
    const acct = String(row.accountId ?? '').trim();
    const ticker = String(row.ticker ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (acct && (ticker || name)) return `${acct}|${ticker}|${name}`;
  }
  return '';
}

/** 字段级合并:有值赢空值;都有值且不同 → 字典序小的赢(**对称**,两端算出同一个结果)。 */
function mergeRow(a: Row, b: Row): Row {
  const out: Row = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k]; const vb = b[k];
    const aEmpty = va == null || va === '';
    const bEmpty = vb == null || vb === '';
    if (aEmpty && bEmpty) { out[k] = va ?? vb; continue; }
    if (aEmpty) { out[k] = vb; continue; }
    if (bEmpty) { out[k] = va; continue; }
    const sa = JSON.stringify(va); const sb = JSON.stringify(vb);
    out[k] = sa === sb ? va : (sa < sb ? va : vb);
  }
  return out;
}

/** 键排序后重建 —— JSON.stringify 按插入顺序输出,不归一的话两端字节不同。 */
function canonicalRow(r: Row): Row {
  const out: Row = {};
  for (const k of Object.keys(r).sort()) out[k] = r[k];
  return out;
}

/**
 * 全序比较:先按 date 降序(新的在前,和本机 mergeBankTxForSync 一致),
 * 再按 id 升序兜底。**必须是全序** —— 只按 date 排的话同一天的多笔顺序不定,
 * 两端字节就不同了。
 */
function compareRows(idField: string, a: Row, b: Row): number {
  const da = typeof a.date === 'string' ? a.date : '';
  const db = typeof b.date === 'string' ? b.date : '';
  if (da !== db) return da < db ? 1 : -1;
  const ia = String(a[idField] ?? ''); const ib = String(b[idField] ?? '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

export interface MergeOutcome {
  /** 合并后的 JSON。**两端逐字节相同** —— 这是收敛的前提。 */
  json: string;
  /** 本机原来就是这个结果吗(是 → 什么都不用做,可以正常写 state)。 */
  unchanged: boolean;
  /** 本机独有、云端没有的条数(> 0 说明「整键替换」本来会吃掉它们)。 */
  localOnly: number;
  /** 云端独有、本机没有的条数。 */
  cloudOnly: number;
}

/**
 * 并集合并一个模块 key。
 *
 * @param localJson 本机的值(undefined = 本机没有这个 key)
 * @param cloudJson 云端的值
 * @param cap       上限,与本机 store 对齐(流水 5000)。截断在**排序之后**做,
 *                  所以两端截的是同一批 —— 先截后排会让两端留下不同的子集。
 *
 * 解析不出数组就返回 null,调用方退回原来的 LWW —— 猜一个格式去合并比不合并更危险。
 */
export function mergeModuleJson(
  key: string, localJson: string | undefined, cloudJson: string, cap = 5000,
): MergeOutcome | null {
  const idField = MERGE_KEYS[key];
  if (!idField) return null;
  let localArr: unknown; let cloudArr: unknown;
  try { localArr = localJson === undefined ? [] : JSON.parse(localJson); } catch { return null; }
  try { cloudArr = JSON.parse(cloudJson); } catch { return null; }
  if (!Array.isArray(localArr) || !Array.isArray(cloudArr)) return null;

  const byId = new Map<string, Row>();
  let localOnly = 0;
  for (const r of localArr as Row[]) {
    if (!r || typeof r !== 'object') continue;
    const id = rowIdentity(key, r, idField);
    if (!id) continue;
    // 把合成身份写回行,后续 push / 再合都稳定(持仓历史无 id 的自愈)。
    byId.set(id, r[idField] ? r : { ...r, [idField]: id });
    localOnly += 1;
  }
  let cloudOnly = 0;
  for (const r of cloudArr as Row[]) {
    if (!r || typeof r !== 'object') continue;
    const id = rowIdentity(key, r, idField);
    if (!id) continue;
    const stamped = r[idField] ? r : { ...r, [idField]: id };
    const prev = byId.get(id);
    if (prev) { byId.set(id, mergeRow(prev, stamped)); localOnly -= 1; }
    else { byId.set(id, stamped); cloudOnly += 1; }
  }

  const merged = [...byId.values()]
    .sort((a, b) => compareRows(idField, a, b))
    .slice(0, cap)          // 排完再截 —— 先截后排两端会留下不同的子集
    .map(canonicalRow);

  // 保险丝:输入非空却合成不出任何身份 → 绝不能返回 [] 让调用方 replace 清空本机。
  // 退回 null → 走 LWW,cloudWouldShrink 还能挡住「空云盖本地」。
  if (merged.length === 0 && (localArr.length > 0 || cloudArr.length > 0)) return null;

  const json = JSON.stringify(merged);
  return { json, unchanged: json === localJson, localOnly: Math.max(0, localOnly), cloudOnly };
}
