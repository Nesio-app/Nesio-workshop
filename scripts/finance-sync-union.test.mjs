/**
 * 行为契约:银行流水/账户是**集合**,云端那份只能并进来(2026-07-30,bug #29)。
 *
 * 用户报的:同一个账号、同一个财务入口,不同时间点打开看到**三种互不相干的状态** ——
 * 「收入 $10,672.93 / 支出 $4,273.21」、「支出 $259.69」、「还没有银行流水」。
 * 他自己的定性是对的:缓存 / 本机 / 云之间的同步问题。
 *
 * 查下来根因在通用模块同步的冲突语义:它对每个 key 做「模块级 last-write-wins」,
 * **云端赢的时候是整键替换**。
 *   · 快照型数据(预算、报告设置)这样没问题;
 *   · 但银行流水/账户在本机就是**并集语义** —— 每台设备各自从 Plaid 增量拉、
 *     按 id upsert(mergeBankTxForSync),账户更是只增合并(saveBankAccounts);
 *   · 两台设备的 Plaid 窗口、绑定的 item、拉取进度都可能不同。
 *     A 有 500 笔、B 有 300 笔,谁后写谁赢,对方独有的那些就没了 —— 数字就这么跳。
 *
 * life-graph 早就因为**同一个理由**被排除在通用同步之外(那边注释写着
 * 「避免双写 + replace 冲掉其 union 合并语义」)。银行流水是同一类东西,漏在了里面。
 *
 * 这条契约钉四件事:
 *   ① 本机独有的记录,不许被云端那份抹掉;
 *   ② 云端独有的记录要并进来(换端才看得到);
 *   ③ 合并结果必须**确定性** —— 两台设备拿到同一批记录要产出逐字节相同的 JSON,
 *      否则哈希对不上,pull→push→pull 会无限互推;
 *   ④ 并集之后**不许写 state** —— 写了就等于说「已经和云端一致」,
 *      本机独有的那些再也传不出去。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, JSON, Map, Set, String, Object, Array, Number });
  return mod.exports;
}

const { mergeIdSets, idFieldFor, ID_SET_MODULES, MERGE_CAP } = loadTs('lib/portal/module-merge.ts');

/* ══ ① 哪些 key 走并集 ═══════════════════════════════════════════ */
{
  assert.equal(idFieldFor('nesio-bank-tx-v1'), 'id',
    '银行流水在本机就是按 id upsert 的并集 —— 云端整键替换会把本机独有的抹掉');
  assert.equal(idFieldFor('nesio-bank-accounts-v1'), 'id',
    '账户本机写入就是「只增合并」,整键替换直接毁掉这个语义');
  assert.equal(idFieldFor('nesio-fin-budget-v1'), null,
    '预算是一张**快照**,不是集合 —— 它按原来的 last-write-wins 走,别顺手改语义');
  assert.equal(idFieldFor('nesio-life-graph-v1'), null,
    '记忆图另有专属引擎,不该出现在这张表里(两套合并语义抢同一份数据就是换端横跳的根因)');
  assert.ok(Object.keys(ID_SET_MODULES).length >= 2);
}

/* ══ ② 本机独有的不许丢,云端独有的要并进来 ═════════════════════ */
{
  const local = JSON.stringify([
    { id: 'a', date: '2026-07-10', amount: -12 },
    { id: 'b', date: '2026-07-09', amount: -34 },
  ]);
  const cloud = JSON.stringify([
    { id: 'b', date: '2026-07-09', amount: -34 },
    { id: 'c', date: '2026-07-08', amount: -56 },
  ]);
  const m = mergeIdSets(local, cloud, 'id');
  const ids = JSON.parse(m.json).map((r) => r.id).sort().join(',');
  assert.equal(ids, 'a,b,c',
    '截图里那三种状态就是这么来的:A 有 a、B 有 c,谁后写谁赢,另一边就没了');
  assert.equal(m.addedFromCloud, 1, 'c 是云端带进来的');
  assert.equal(m.keptOnlyLocal, 1, 'a 是本机独有的 —— 原来它会被整键替换直接抹掉');

  // 本机为空(换端第一次):云端那份全填进来
  const fresh = mergeIdSets(undefined, cloud, 'id');
  assert.equal(JSON.parse(fresh.json).length, 2, '换端关键路径:本机没有就全填进来');
  assert.equal(fresh.keptOnlyLocal, 0);

  // 云端为空(那台设备还没同步过):本机一条都不能少
  const cloudEmpty = mergeIdSets(local, '[]', 'id');
  assert.equal(JSON.parse(cloudEmpty.json).length, 2,
    '一台空浏览器的空状态**永远不许**把本机的流水清掉 —— 那正是「还没有银行流水」那一屏');
}

/* ══ ③ 同 id 时本机赢;结果必须确定性 ═══════════════════════════ */
{
  const local = JSON.stringify([{ id: 'a', date: '2026-07-10', amount: -12, category: '餐饮' }]);
  const cloud = JSON.stringify([{ id: 'a', date: '2026-07-10', amount: -12, category: '' }]);
  const m = mergeIdSets(local, cloud, 'id');
  assert.equal(JSON.parse(m.json)[0].category, '餐饮',
    '同一笔在两边都有时本机赢 —— 这台设备刚从 Plaid 拉过,它那份更新');

  // 两台设备顺序不同,合并结果必须逐字节相同。
  // 关键:**日期必须相同** —— 日期不同的话是 date 比较在决定顺序,
  // 根本走不到 id 那一层,这条断言就成了空的(自查变异抓到过一次)。
  const A = JSON.stringify([{ id: 'z', date: '2026-07-10' }, { id: 'a', date: '2026-07-10' }]);
  const B = JSON.stringify([{ id: 'a', date: '2026-07-10' }, { id: 'z', date: '2026-07-10' }]);
  assert.equal(
    mergeIdSets(A, B, 'id').json,
    mergeIdSets(B, A, 'id').json,
    '同一天的两笔,两台设备的原始顺序不同 —— 排序不确定的话内容哈希就对不上,' +
    'pull→push→pull 会无限互推。这比原来的 bug 更糟(它会一直烧流量和电)',
  );
  assert.equal(
    JSON.parse(mergeIdSets(A, B, 'id').json).map((r) => r.id).join(','), 'a,z',
    '同日按 id 升序,不靠输入顺序',
  );

  // 同日期时按 id 升序兜底,不靠输入顺序
  const sameDay = mergeIdSets(
    JSON.stringify([{ id: 'z', date: '2026-07-10' }]),
    JSON.stringify([{ id: 'a', date: '2026-07-10' }]),
    'id',
  );
  assert.equal(JSON.parse(sameDay.json).map((r) => r.id).join(','), 'a,z', '同日按 id 升序');
}

/* ══ ④ 脏数据不崩,不认识的格式回落原判据 ═══════════════════════ */
{
  assert.equal(mergeIdSets('{}', '[]', 'id'), null, '本机不是数组 → 交回原来的 LWW 判据,不硬来');
  assert.equal(mergeIdSets('[]', '不是 json', 'id'), null, '云端解析不了 → 同上');
  const noId = mergeIdSets(JSON.stringify([{ date: '2026-07-10' }]), '[]', 'id');
  assert.equal(JSON.parse(noId.json).length, 0, '没有 id 的记录并不进来 —— 认不出是谁就不能 upsert');
  assert.equal(mergeIdSets('[]', '[]', 'id').json, '[]');

  // 并集有上限,不让多设备无限长大
  const big = (n, pre) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `${pre}${i}`, date: '2026-07-10' })));
  const capped = mergeIdSets(big(MERGE_CAP, 'L'), big(MERGE_CAP, 'C'), 'id');
  assert.equal(JSON.parse(capped.json).length, MERGE_CAP, `并集也要封顶在 ${MERGE_CAP}`);
}

/* ══ ⑤ 接线:pull 真的走并集,而且并完不写 state ═══════════════ */
{
  const sync = read('lib/portal/cloud-module-sync.ts');
  assert.match(sync, /const idField = idFieldFor\(key\);/, 'pull 要先问这个 key 是不是集合');
  assert.match(sync, /const m = mergeIdSets\(localVal, json, idField\);/, '是的话就并,不走整键替换');
  assert.match(sync, /\/\/ \*\*故意不写 state\*\*/,
    '并集通常是双方的超集,得让接下来的 push 把它带上去。' +
    '写了 state 就等于说「已经和云端一致」,本机独有的记录再也传不出去');

  // 并集分支必须在 LWW 分支**之前**,否则永远走不到
  const idAt = sync.indexOf('const idField = idFieldFor(key);');
  const lwwAt = sync.indexOf('const cloudWouldShrink');
  assert.ok(idAt > 0 && lwwAt > idAt, '并集分支要在 last-write-wins 判据之前');

  // 本机侧的并集语义还在(它们是这条判据的前提)
  assert.match(read('lib/portal/providers/bank-tx.ts'), /export function mergeBankTxForSync/,
    '本机按 id upsert —— 云端也必须按同一种语义来');
  assert.match(read('lib/portal/providers/bank-tx.ts'), /byId\.set\(a\.id, \{ \.\.\.byId\.get\(a\.id\), \.\.\.a \}\)/,
    '账户只增合并');
}

console.log('finance-sync-union: OK(集合走并集 / 本机独有不丢 / 云端空不清库 / 结果确定性 / 并完不写 state)');
