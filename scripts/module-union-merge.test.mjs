/**
 * module-union-merge —— 银行流水/账户在多设备之间**不许被整键替换**。
 *
 * 病灶:通用模块同步做模块级 last-write-wins,云端赢的时候整键替换。
 * 快照型数据没问题,但银行流水在本机是并集语义(按 id upsert)——
 * A 有 500 笔、B 有 300 笔,谁后写谁赢,对方独有的直接没了,没有任何界面会报错。
 *
 * 所以这里的断言重点是三条:**不丢**、**收敛**、**会推上去**。
 * 尤其收敛 —— 两端算出的 JSON 必须逐字节相同,否则内容哈希对不上会无限互推。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function runSource(rel) {
  const src = read(rel).replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports, JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp,
    console, require: () => ({}),
  });
  return m.exports;
}

const M = runSource('lib/portal/module-merge.ts');
const KEY = 'nesio-bank-tx-v1';
const tx = (id, date, extra = {}) => ({ id, date, name: `商户${id}`, amount: 10, ...extra });

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── ① 不丢 ────────────────────────────────────────────────────────────────
check('①a A 有 500、B 有 300 → 并集 800,一条不少', () => {
  const a = Array.from({ length: 500 }, (_, i) => tx(`a${i}`, '2026-07-01'));
  const b = Array.from({ length: 300 }, (_, i) => tx(`b${i}`, '2026-07-02'));
  const m = M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b));
  const out = JSON.parse(m.json);
  assert.strictEqual(out.length, 800, `整键替换会只剩一边(得到 ${out.length})`);
  assert.strictEqual(m.localOnly, 500, '本机独有条数没数对 —— 这个数就是「本来会丢多少」');
  assert.strictEqual(m.cloudOnly, 300);
});

check('①b 本机没有这个 key → 全量填充(换端首次拉取)', () => {
  const b = [tx('b1', '2026-07-02')];
  const m = M.mergeModuleJson(KEY, undefined, JSON.stringify(b));
  assert.strictEqual(JSON.parse(m.json).length, 1);
  assert.strictEqual(m.unchanged, false);
});

check('①c 云端是空数组也不许把本机清空', () => {
  const a = [tx('a1', '2026-07-01'), tx('a2', '2026-07-02')];
  const m = M.mergeModuleJson(KEY, JSON.stringify(a), '[]');
  assert.strictEqual(JSON.parse(m.json).length, 2, '空云端把本机流水清空了 —— 这正是最恶劣的那种丢法');
  // unchanged 是 false:输出是**规范化**过的(字段排序、全序重排),本机原来的写法不是。
  // 第一次合并会把本机也规范化,之后 unchanged 就是 true 了 —— 会收敛,不会每轮重写。
  // (自查时先写成期待 true,是我搞错了语义:unchanged 比的是字节,不是内容。)
  const again = M.mergeModuleJson(KEY, m.json, '[]');
  assert.strictEqual(again.unchanged, true, '规范化之后再合一次还变 → 不收敛,会每轮重写');
});

// ── ② 收敛(最容易漏的一条)──────────────────────────────────────────────
check('②a 两端方向相反地合并 → 结果**逐字节相同**(否则无限互推)', () => {
  const a = [tx('t2', '2026-07-02'), tx('t1', '2026-07-01')];
  const b = [tx('t3', '2026-07-03'), tx('t1', '2026-07-01')];
  const onA = M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b)).json;
  const onB = M.mergeModuleJson(KEY, JSON.stringify(b), JSON.stringify(a)).json;
  assert.strictEqual(onA, onB,
    '两端算出的 JSON 不同 → 内容哈希对不上 → A 推给云、B 拉下来又推给云,无限互推,数据其实一模一样');
});

check('②b 同一天的多笔要有全序 —— 只按日期排会让两端顺序不定', () => {
  const a = [tx('z', '2026-07-01'), tx('a', '2026-07-01')];
  const b = [tx('a', '2026-07-01'), tx('z', '2026-07-01')];
  const onA = M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b)).json;
  const onB = M.mergeModuleJson(KEY, JSON.stringify(b), JSON.stringify(a)).json;
  assert.strictEqual(onA, onB, '同日多笔的顺序在两端不一致 —— 同样会无限互推');
  assert.strictEqual(JSON.parse(onA).map((r) => r.id).join(','), 'a,z', 'id 升序兜底没生效');
});

check('②c 字段顺序要归一 —— JSON.stringify 按插入顺序输出', () => {
  const a = [{ id: 't1', date: '2026-07-01', name: 'X' }];
  const b = [{ name: 'X', date: '2026-07-01', id: 't1' }];
  const onA = M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b)).json;
  const onB = M.mergeModuleJson(KEY, JSON.stringify(b), JSON.stringify(a)).json;
  assert.strictEqual(onA, onB, '同一条记录字段顺序不同 → 字节不同 → 哈希不同 → 互推');
});

check('②d 字段冲突的解法必须**对称**(本机赢就永远谈不拢)', () => {
  const a = [tx('t1', '2026-07-01', { merchantLogo: 'AAA' })];
  const b = [tx('t1', '2026-07-01', { merchantLogo: 'BBB' })];
  const onA = M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b)).json;
  const onB = M.mergeModuleJson(KEY, JSON.stringify(b), JSON.stringify(a)).json;
  assert.strictEqual(onA, onB, '「本机赢」是不对称的:A 留 AAA、B 留 BBB,永远收敛不了');
});

check('②e 有值赢空值 —— 一端富化出来的字段不能被另一端的空盖掉', () => {
  const a = [tx('t1', '2026-07-01', { merchantLogo: 'LOGO' })];
  const b = [tx('t1', '2026-07-01', { merchantLogo: '' })];
  const out = JSON.parse(M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b)).json);
  assert.strictEqual(out[0].merchantLogo, 'LOGO', '空字符串把富化好的 logo 盖掉了');
  const out2 = JSON.parse(M.mergeModuleJson(KEY, JSON.stringify(b), JSON.stringify(a)).json);
  assert.strictEqual(out2.map ? out2[0].merchantLogo : null, 'LOGO', '反方向应该得到同一个结果');
});

check('②f 截断在排序**之后** —— 先截后排两端会留下不同的子集', () => {
  const a = Array.from({ length: 5 }, (_, i) => tx(`a${i}`, `2026-07-0${i + 1}`));
  const b = Array.from({ length: 5 }, (_, i) => tx(`b${i}`, `2026-07-1${i}`));
  const onA = M.mergeModuleJson(KEY, JSON.stringify(a), JSON.stringify(b), 3).json;
  const onB = M.mergeModuleJson(KEY, JSON.stringify(b), JSON.stringify(a), 3).json;
  assert.strictEqual(onA, onB, '截断前没排序 → 两端留下不同的三条');
  assert.strictEqual(JSON.parse(onA).length, 3);
  // 留的是最新的三笔
  assert.strictEqual(JSON.parse(onA)[0].date, '2026-07-14');
});

// ── ③ 会推上去(并完不写 state)────────────────────────────────────────────
check('③a 并集分支**不写 state** —— 写了的话超集永远推不上云,另一台永远拿不到', () => {
  const c = strip(read('lib/portal/cloud-module-sync.ts'));
  const at = c.indexOf('if (needsUnionMerge(key))');
  assert.ok(at > 0, '并集分支不在了');
  const branch = c.slice(at, c.indexOf('const localMissing =', at));
  assert.ok(!/state\[key\] =/.test(branch),
    '并集分支里写了 state —— 等于告诉系统「两边一致」,合并出来的超集永远上不去');
  assert.ok(/continue;/.test(branch), '并集处理完要 continue,不能再落到下面的 LWW');
});

check('③b 并集分支要在 LWW **之前** —— 在后面就永远轮不到它', () => {
  const c = strip(read('lib/portal/cloud-module-sync.ts'));
  assert.ok(c.indexOf('needsUnionMerge(key)') < c.indexOf('localUnchangedSinceSync'),
    '并集判断排在 LWW 之后 —— 整键替换已经发生了');
});

check('③c 银行三个 key 都在并集表里', () => {
  for (const k of ['nesio-bank-tx-v1', 'nesio-bank-accounts-v1', 'nesio-fin-holdings-v1']) {
    assert.strictEqual(M.needsUnionMerge(k), true, `${k} 不在并集表 —— 它会被整键替换`);
  }
  assert.strictEqual(M.needsUnionMerge('treasurebox-theme'), false, '快照型数据不该走并集');
});

// ⚠️ 反向的一条同样重要:**life-graph 不许进并集表**。
// 它有自己那套 union 合并(所以早就被排除在通用模块同步之外);
// 再在这里并一次就是两套语义叠加,冲突解法还不一样。
// (这条是从另一个分支的 finance-sync-union 测试里搬过来的 —— 那份测的是
//  被合并时删掉的重复实现,但它这条断言我这边原来缺。)
check('③c2 life-graph 不在并集表里 —— 它有自己的 union,别并两遍', () => {
  assert.strictEqual(M.needsUnionMerge('nesio-life-graph-v1'), false);
  assert.strictEqual(M.needsUnionMerge('nesio-fin-budget-v1'), false, '预算是快照型,并集会把删掉的项并回来');
});

check('③d 格式漂移(不是数组)→ 返回 null 让调用方退回 LWW,不猜格式硬合', () => {
  assert.strictEqual(M.mergeModuleJson(KEY, '{"a":1}', '[]'), null);
  assert.strictEqual(M.mergeModuleJson(KEY, '不是 json', '[]'), null);
  assert.strictEqual(M.mergeModuleJson('treasurebox-theme', '[]', '[]'), null, '不在表里的 key 不该被合并');
});

const bad = results.filter((r) => r[0] === 'FAIL');
if (bad.length) {
  console.error(`module-union-merge 有 ${bad.length} 条不过:`);
  for (const [, name, msg] of bad) console.error(`  - ${name} → ${msg}`);
  process.exit(1);
}
console.log(`module-union-merge: OK(${results.length} 条:不丢 / 两端逐字节收敛 / 超集能推上去)`);
