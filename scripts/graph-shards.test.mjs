/**
 * graph-shards — 按年分片存储的**数据安全**契约(地基 F3)。
 *
 * 为什么分片:整图存一个 JSON blob,每次写都 `JSON.stringify(全图)`。2500 条时
 * 靠 400ms 合并窗还压得住(那正是当初「速记提交冻结」的修法),但账本一进来就是
 * 上万条,10MB+ 的序列化会原样重演那次冻结。
 *
 * 但分片真正的价值是**安全**,不是快:
 *   · 写只碰变了的片 → 某片读不出来时它也不会被覆盖(压根不写它);
 *   · 读缺一片必须报 complete:false → 调用方不许把半张图当全量,
 *     否则一次瞬时 IDB 故障 + 一次保存 = 真丢数据;
 *   · 迁移先写后验再删 → 校验不过就保留旧 blob,数据一直在。
 *
 * 这三条各有断言,且都用假 backend 真跑(可注入失败)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
// ⚠️ vm 里造的数组/对象原型与外层不同 —— deepStrictEqual 必假失败(本仓记录过的坑,
// bug3-runtime 也栽过)。凡是比较**从 vm 出来的**结构,一律用宽松 deepEqual。
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;

function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(ROOT + rel, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports, console, JSON, Array, Object, Set, Map, Number, Math, Date,
    String, RegExp, Boolean, Promise, Error, Symbol, require: () => ({}),
  });
  return m.exports;
}
const S = load('lib/portal/life-graph-shards.ts');

/** 可注入失败的假 IDB。 */
function fakeIdb({ failGet = new Set(), failSet = new Set() } = {}) {
  const store = new Map();
  const ops = { set: [], del: [] };
  return {
    store, ops,
    async get(k) { if (failGet.has(k)) throw new Error('boom'); return store.has(k) ? store.get(k) : null; },
    async set(k, v) { if (failSet.has(k)) throw new Error('boom'); ops.set.push(k); store.set(k, v); },
    async delete(k) { ops.del.push(k); store.delete(k); },
  };
}

const node = (id, createdAt) => ({
  id, name: id, type: 'note', source: 'manual', confidence: 1,
  attributes: {}, relations: [], tags: [], createdAt,
});

const results = [];
const run = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── ① 分片规则 ────────────────────────────────────────────────────────────
await run('①a 按 createdAt 年份切片', () => {
  assert.strictEqual(S.shardOf(node('a', '2026-07-30T00:00:00.000Z')), '2026');
  assert.strictEqual(S.shardOf(node('b', '2019-01-01T00:00:00.000Z')), '2019');
});

await run('①b createdAt 坏掉的不丢,落 x 片', () => {
  // 存储层不许吃掉脏数据 —— 那是另一个问题,不该在这里变成「少了一条」
  for (const bad of ['', 'not-a-date', undefined, null]) {
    assert.strictEqual(S.shardOf({ createdAt: bad }), 'x', `createdAt=${String(bad)} 应落 x 片`);
  }
  const g = S.groupByShard([node('a', 'garbage'), node('b', '2026-01-01')]);
  assert.strictEqual(g.get('x').length, 1);
  assert.strictEqual(g.get('2026').length, 1);
});

// ── ② 写只碰变了的片(性能 + 安全的共同来源)────────────────────────────
await run('②a 改一条今年的,历史片不被重写', async () => {
  const idb = fakeIdb();
  const nodes = [node('old', '2019-05-05'), node('cur', '2026-07-30')];
  const first = await S.writeGraphShards(idb, nodes, new Map());
  looseDeepEqual([...first.written].sort(), ['2019', '2026']);

  idb.ops.set.length = 0;
  const edited = [node('old', '2019-05-05'), { ...node('cur', '2026-07-30'), name: '改过了' }];
  const second = await S.writeGraphShards(idb, edited, first.nextJson);
  looseDeepEqual([...second.written], ['2026'], '只有 2026 该被重写');
  assert.ok(!idb.ops.set.includes(S.shardStorageKey('2019')), '历史片被无谓重写了 —— 分片就白做了');
});

await run('②b 一片变空 → 删掉该片,索引跟着更新', async () => {
  const idb = fakeIdb();
  const first = await S.writeGraphShards(idb, [node('a', '2019-01-01'), node('b', '2026-01-01')], new Map());
  const second = await S.writeGraphShards(idb, [node('b', '2026-01-01')], first.nextJson);
  looseDeepEqual([...second.removed], ['2019']);
  assert.ok(!idb.store.has(S.shardStorageKey('2019')), '空片没删掉,会留成孤儿');
  looseDeepEqual(JSON.parse(idb.store.get(S.GRAPH_SHARD_INDEX_KEY)), ['2026']);
});

await run('②d 空 prev 不得把历史年从索引摘掉(同步半张图)', async () => {
  const idb = fakeIdb();
  await S.writeGraphShards(idb, [node('old', '2019-05-05'), node('cur', '2026-07-30')], new Map());
  // 新会话 lastShardJson 是空的,同步只拿到今年几条日历
  const wiped = await S.writeGraphShards(idb, [node('cal', '2026-08-01')], new Map());
  const read = await S.readGraphShards(idb);
  assert.ok(read.nodes.some((n) => n.id === 'old'), '2019 年记忆被空 prev 写盘从索引摘掉了');
  assert.ok(read.nodes.some((n) => n.id === 'cur') || read.nodes.some((n) => n.id === 'cal'), '当年片应 union 而不是整片替换');
  assert.ok(!wiped.removed.includes('2019'), '空 prev 不许删自己没见过的历史片');
});

await run('②e 空 prev 覆盖当年片时要和磁盘 union', async () => {
  const idb = fakeIdb();
  await S.writeGraphShards(idb, [node('keep-me', '2026-01-01'), node('also', '2026-06-01')], new Map());
  await S.writeGraphShards(idb, [node('fresh', '2026-08-11')], new Map());
  const read = await S.readGraphShards(idb);
  looseDeepEqual(read.nodes.map((n) => n.id).sort(), ['also', 'fresh', 'keep-me'],
    '当年片被日历同步整片换成新节点 —— 同片旧记忆丢了');
});

await run('②c 索引最后写(不能出现「索引指向还没写的片」)', async () => {
  const idb = fakeIdb();
  await S.writeGraphShards(idb, [node('a', '2026-01-01')], new Map());
  const iIndex = idb.ops.set.indexOf(S.GRAPH_SHARD_INDEX_KEY);
  const iShard = idb.ops.set.indexOf(S.shardStorageKey('2026'));
  assert.ok(iShard >= 0 && iIndex > iShard, '索引必须在片之后写,否则崩在中间会指向不存在的片');
});

// ── ③ 读缺片必须报不完整(最关键的一条)──────────────────────────────────
await run('③a 某片读失败 → complete:false', async () => {
  const idb = fakeIdb();
  await S.writeGraphShards(idb, [node('a', '2019-01-01'), node('b', '2026-01-01')], new Map());
  const broken = fakeIdb({ failGet: new Set([S.shardStorageKey('2019')]) });
  for (const [k, v] of idb.store) broken.store.set(k, v);

  const read = await S.readGraphShards(broken);
  assert.strictEqual(read.complete, false, '缺片却报 complete —— 调用方会把半张图当全量,一次保存就真丢了');
  assert.strictEqual(read.nodes.length, 1, '读得出来的那片仍要返回(供诊断),但必须带 complete:false');
});

await run('③b 某片 JSON 坏了 → 同样报不完整,不是「那片没有数据」', async () => {
  const idb = fakeIdb();
  await S.writeGraphShards(idb, [node('a', '2019-01-01'), node('b', '2026-01-01')], new Map());
  idb.store.set(S.shardStorageKey('2019'), '{坏掉的 json');
  const read = await S.readGraphShards(idb);
  assert.strictEqual(read.complete, false);
});

await run('③c 全读得到 → complete:true 且一条不少', async () => {
  const idb = fakeIdb();
  const nodes = [node('a', '2019-01-01'), node('b', '2026-01-01'), node('c', 'garbage')];
  await S.writeGraphShards(idb, nodes, new Map());
  const read = await S.readGraphShards(idb);
  assert.strictEqual(read.complete, true);
  looseDeepEqual(read.nodes.map((n) => n.id).sort(), ['a', 'b', 'c']);
});

await run('③d 没有分片存储时返回 null(区别于「有但是空的」)', async () => {
  assert.strictEqual(await S.readGraphShards(fakeIdb()), null);
});

// ── ④ 迁移:先写后验再删 ──────────────────────────────────────────────────
const LEGACY = 'nesio-life-graph-v1';

await run('④a 正常迁移:片写好、校验过、旧 blob 才删', async () => {
  const idb = fakeIdb();
  const nodes = [node('a', '2019-01-01'), node('b', '2026-01-01'), node('c', '2026-02-02')];
  idb.store.set(LEGACY, JSON.stringify(nodes));

  const res = await S.migrateLegacyBlobToShards(idb, LEGACY);
  assert.strictEqual(res.migrated, 3);
  assert.strictEqual(res.verified, true);
  assert.ok(!idb.store.has(LEGACY), '校验过了就该删旧 blob');

  const read = await S.readGraphShards(idb);
  assert.strictEqual(read.complete, true);
  looseDeepEqual(read.nodes.map((n) => n.id).sort(), ['a', 'b', 'c'], '迁移不许少一条');
});

await run('④b 校验没过 → 旧 blob 必须保留(数据一直在,下次重来)', async () => {
  const nodes = [node('a', '2019-01-01'), node('b', '2026-01-01')];
  // 让 2019 片写不进去 → 读回来对不上 → 不许删旧 blob
  const idb = fakeIdb({ failSet: new Set([S.shardStorageKey('2019')]) });
  idb.store.set(LEGACY, JSON.stringify(nodes));
  const res = await S.migrateLegacyBlobToShards(idb, LEGACY).catch(() => ({ verified: false }));
  assert.notStrictEqual(res.verified, true, '写失败了却报校验通过');
  assert.ok(idb.store.has(LEGACY), '校验没过就删了旧 blob —— 这是不可逆的丢数据');
});

await run('④b2 写成功但读回来对不上 → 仍然不许删旧 blob', async () => {
  // ⚠️ 这条是自查反证补出来的:④b 让 set 抛异常,整个 migrate 直接 throw,
  // 压根走不到删除那一行 —— 于是「if (verified) 才删」这道保险**没有任何断言覆盖**,
  // 把它去掉测试照样全绿。真正要防的是「写都成功了,但读回来少了一截」这种沉默损坏。
  const nodes = [node('a', '2019-01-01'), node('b', '2026-01-01')];
  const idb = fakeIdb();
  idb.store.set(LEGACY, JSON.stringify(nodes));
  // 写全部成功;只在**回读校验**时让 2019 片读不出来
  const realGet = idb.get.bind(idb);
  let wrote = false;
  idb.get = async (k) => {
    if (wrote && k === S.shardStorageKey('2019')) return null;
    return realGet(k);
  };
  const origSet = idb.set.bind(idb);
  idb.set = async (k, v) => { const r = await origSet(k, v); if (k === S.GRAPH_SHARD_INDEX_KEY) wrote = true; return r; };

  const res = await S.migrateLegacyBlobToShards(idb, LEGACY);
  assert.strictEqual(res.verified, false, '读回来对不上却报校验通过');
  assert.ok(idb.store.has(LEGACY), '校验没过就删了旧 blob —— 不可逆的丢数据');
});

await run('④b3 已有分片 + 又冒出旧 blob(恢复旧备份)→ union,不许整片覆盖', async () => {
  // ⚠️ 自查抓到的丢数据路径:机器早已迁移完(分片在、legacy 已删),之后用户恢复了
  // 一份**旧备份**,legacy 单 blob 又出现了。若迁移用空 prev 整片写,
  // 2026 片会被旧备份内容整片替换 —— 迁移之后新增的记忆全部消失。
  const idb = fakeIdb();
  // 现状:分片里有一条「迁移后新增」的记忆
  await S.writeGraphShards(idb, [node('new-after-migrate', '2026-07-30')], new Map());
  // 旧备份带回来的 legacy:只有更早的两条
  idb.store.set(LEGACY, JSON.stringify([node('old-a', '2019-01-01'), node('old-b', '2026-01-01')]));

  const res = await S.migrateLegacyBlobToShards(idb, LEGACY);
  assert.strictEqual(res.verified, true);
  const read = await S.readGraphShards(idb);
  looseDeepEqual(read.nodes.map((n) => n.id).sort(), ['new-after-migrate', 'old-a', 'old-b'],
    '迁移后新增的记忆被旧备份整片覆盖掉了 —— 不可逆丢数据');
});

await run('④b4 已有分片读不完整时不迁移(别拿半张图去 union)', async () => {
  const idb = fakeIdb();
  await S.writeGraphShards(idb, [node('a', '2019-01-01'), node('b', '2026-01-01')], new Map());
  idb.store.set(S.shardStorageKey('2019'), '{坏了');   // 一片读不出来
  idb.store.set(LEGACY, JSON.stringify([node('c', '2026-02-02')]));
  const res = await S.migrateLegacyBlobToShards(idb, LEGACY);
  assert.strictEqual(res.verified, false, '半张图不许拿去 union');
  assert.ok(idb.store.has(LEGACY), '没迁成就要保留 legacy,下次重来');
});

await run('④c 没有旧 blob → null(不是错误)', async () => {
  assert.strictEqual(await S.migrateLegacyBlobToShards(fakeIdb(), LEGACY), null);
});

await run('④d 迁移是幂等的(重复跑不出事)', async () => {
  const idb = fakeIdb();
  idb.store.set(LEGACY, JSON.stringify([node('a', '2026-01-01')]));
  await S.migrateLegacyBlobToShards(idb, LEGACY);
  const again = await S.migrateLegacyBlobToShards(idb, LEGACY);
  assert.strictEqual(again, null, '第二次应认出「没有旧 blob」直接返回 null');
  const read = await S.readGraphShards(idb);
  looseDeepEqual(read.nodes.map((n) => n.id), ['a']);
});

// ── ⑤ 接线:life-graph 必须真的用上,且缺片时不覆盖内存 ────────────────────
await run('⑤ life-graph 走分片,且 complete:false 时什么都不做', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/life-graph.ts`, 'utf8');
  assert.ok(/writeGraphShards/.test(src) && /readGraphShards/.test(src),
    'life-graph 没接分片 —— 模块写了没人用等于没做');
  assert.ok(/migrateLegacyBlobToShards/.test(src), '没有迁移调用,老用户的数据永远留在单 blob 里');
  assert.ok(!/idb\.set\(STORAGE_KEY, JSON\.stringify\(nodes\)\)/.test(src),
    '还在整图写单 blob —— 分片没生效');

  const hydrate = src.slice(src.indexOf('function hydrateGraphOnce'), src.indexOf('function loadAll'));
  const guard = hydrate.slice(hydrate.indexOf('!read.complete'));
  const guardBlock = guard.slice(0, guard.indexOf('}'));
  assert.ok(/return;/.test(guard.slice(0, 400)),
    '缺片时没有早退 —— 后面会走到 memCache = seed,界面突然空掉;更糟的是可能回写半张图');
  assert.ok(/graphHydrated = false/.test(guardBlock), '缺片后要放开重入,否则这次会话再也不会重试');
  assert.ok(/lastShardJson = new Map\(\)/.test(guardBlock), '缺片后分片写缓存要作废,别基于半张图做增量');
});

// ── ⑥ 备份/恢复:分片必须与整图键走同一套 union 语义 ──────────────────────
await run('⑥ 恢复时分片走 union,不落到「已有就跳过」', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/cloud-backup.ts`, 'utf8');
  assert.ok(/startsWith\(`\$\{LIFE_GRAPH_KEY\}:`\)/.test(src),
    '恢复侧没认分片键 —— 分片会落到「merge 模式下已有就跳过」,换机合并时备份里的记忆一条都进不来');
  assert.ok(/k !== `\$\{LIFE_GRAPH_KEY\}:index`/.test(src),
    '索引键不该参与节点 union(它是片名清单,水合时按实际片重算)');
  assert.ok(/isGraphShard.*mode === 'merge'|k === LIFE_GRAPH_KEY \|\| isGraphShard/.test(src),
    '分片没接进 mergeGraphJson 分支');
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`graph-shards 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`graph-shards: OK(${results.length} 条,分片规则 / 增量写 / 缺片报错 / 迁移先写后验再删)`);
