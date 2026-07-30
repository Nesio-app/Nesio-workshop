/**
 * graph-consistency — 「我的记忆全在吗」的判据契约(地基 F2)。
 *
 * 为什么需要:同步机制齐备,但没有一处能回答「本地 N、云端 M、差在哪」。
 * 而补传路径是残的 —— backfill 默认 `nodes.slice(0, 200)`,图是新→旧排序,
 * **只补最新 200 条**;老节点若当初没成功 upsert,永远轮不到,而且没人会发现。
 *
 * 这套钉两件事:
 *   ① 判定逻辑(consistencyVerdict)真跑一遍,尤其是「云端有本地没有」这一类 ——
 *      它单看没有意义:可能是别的设备刚加的(正常),也可能是本地删了还没传导(正常),
 *      只有**两者都排除**才算意外。判错这一类会天天误报「你的数据可能丢了」。
 *   ② backfill 的 ids 定点补传真的按 id 走,而不是又退回 slice(0,200)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

function loadModule(rel, extra = {}) {
  const js = ts.transpileModule(fs.readFileSync(ROOT + rel, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports, console, JSON, Array, Object, Set, Map, Number, Math, Date,
    String, RegExp, Boolean, Promise, Error, Symbol, URL, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true },
    require: (id) => extra[Object.keys(extra).find((k) => id.endsWith(k)) ?? ''] ?? {},
  });
  return m.exports;
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

const report = (over = {}) => ({
  checkedAt: '2026-07-30T00:00:00.000Z',
  localCount: 10, cloudCount: 10,
  missingInCloud: [], missingLocally: [], pendingDeletes: [], stuckCount: 0,
  ...over,
});

// ── ① 判定逻辑 ────────────────────────────────────────────────────────────
const mod = loadModule('lib/portal/graph-consistency.ts');
const { consistencyVerdict } = mod;

check('①a 两边一致 → clean', () => {
  assert.strictEqual(consistencyVerdict(report()), 'clean');
});

check('①b 只是本地有云端没有 → repairable(一键补传能修好)', () => {
  assert.strictEqual(consistencyVerdict(report({ missingInCloud: ['a', 'b'] })), 'repairable');
});

check('①c 云端有本地没有,但正是挂起删除的那批 → 不算异常', () => {
  // 这是最容易判错的一类:用户刚删了 x,删除还没传到云,所以云端仍有 x。
  // 判成异常的话,每次离线删东西都会弹「你的数据可能丢了」。
  assert.strictEqual(
    consistencyVerdict(report({ missingLocally: ['x'], pendingDeletes: ['x'] })),
    'clean',
  );
});

check('①d 云端有本地没有,且无法用挂起删除解释 → attention', () => {
  assert.strictEqual(
    consistencyVerdict(report({ missingLocally: ['y'], pendingDeletes: ['x'] })),
    'attention',
  );
});

check('①e outbox 有 failed → attention(重试不会自己好)', () => {
  assert.strictEqual(consistencyVerdict(report({ stuckCount: 3 })), 'attention');
});

check('①f 两类问题同时存在 → attention(不许被 repairable 盖过去)', () => {
  assert.strictEqual(
    consistencyVerdict(report({ missingInCloud: ['a'], missingLocally: ['y'] })),
    'attention',
  );
});

// ── ② 定点补传:真的按 id 发,不是退回 slice(0,200) ────────────────────────
await checkAsync('② repairMissingInCloud 按 id 分批发,不落回「最新 200 条」', async () => {
  const calls = [];
  const stub = loadModule('lib/portal/graph-consistency.ts', {
    'life-graph': {
      getLifeGraph: () => [],
      getLifeGraphCloudSyncRecords: () => [],
      backfillLocalLifeGraphToCloud: async (opts) => {
        calls.push(opts);
        return { attemptedNodeCount: (opts.ids || []).length, attemptedAssetCount: 0 };
      },
    },
    'app-api-client': { createAppApiClient: () => ({}) },
    'storage-health': { logDropped: () => {} },
  });
  const ids = Array.from({ length: 120 }, (_, i) => `n-${i}`);
  const res = await stub.repairMissingInCloud(ids, { batchSize: 50 });

  assert.strictEqual(calls.length, 3, '120 条 / 每批 50 → 应发 3 批');
  for (const c of calls) {
    assert.ok(Array.isArray(c.ids) && c.ids.length > 0, '必须带 ids —— 不带就退回「只补最新 200 条」的老病');
    assert.strictEqual(c.limit, undefined, '不许同时传 limit,否则语义打架');
  }
  assert.deepStrictEqual(calls.flatMap((c) => c.ids), ids, '补传的 id 集合必须与传入完全一致(不重不漏)');
  assert.strictEqual(res.attempted, 120);
});

// ── ③ 源码层:backfill 的 ids 分支必须还在 ────────────────────────────────
check('③ backfillLocalLifeGraphToCloud 仍支持 ids 定点补传', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/life-graph.ts`, 'utf8');
  const fn = src.slice(src.indexOf('export async function backfillLocalLifeGraphToCloud'));
  const body = fn.slice(0, 1200);
  assert.ok(/ids\?: string\[\]/.test(body), 'ids 参数没了 —— 定点补传会静默退回「最新 200 条」');
  // 精确钉实现:带 ids 时按 id 过滤全图,不带才走 slice。
  //(第一版这条写成了三个 OR 兜底 —— 那等于没钉,自查时收紧的。)
  const flat = body.replace(/\s+/g, ' ');
  assert.ok(flat.includes('ids ? nodes.filter((n) => ids.includes(n.id)) : nodes.slice(0, limit)'),
    'ids 分支的实现变了 —— 它必须按 id 过滤**全图**;一旦退回 slice,老节点永远补不上且无人察觉');
});

// ── ④ 体检不许改数据(只读)──────────────────────────────────────────────
check('④ auditGraphConsistency 是只读的', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/graph-consistency.ts`, 'utf8');
  const fn = src.slice(src.indexOf('export async function auditGraphConsistency'), src.indexOf('export function consistencyVerdict'));
  for (const forbidden of ['addLifeNode', 'updateLifeNode', 'deleteLifeNode', 'saveAll', 'backfill']) {
    assert.ok(!fn.includes(forbidden), `体检里出现了写操作 ${forbidden} —— 体检必须只读,修复是另一步、要用户点`);
  }
});

// ── ⑤ 体检必须接进 UI(库存在但没入口 = 没做)──────────────────────────
check('⑤ 设置页挂了同步体检,且失败有可见态、修复是单独一颗按钮', () => {
  const s = fs.readFileSync(`${ROOT}components/portal/SettingsSheets.tsx`, 'utf8');
  assert.ok(/auditGraphConsistency/.test(s), '体检没接进设置页 —— 库写了没入口等于没做');
  assert.ok(/consistencyVerdict/.test(s), 'UI 要用共享判据,别在组件里另写一套「算不算有问题」');
  // 红线:异步动作必须有可见失败态
  assert.ok(/auditState === 'failed'/.test(s) && /auditFail/.test(s),
    '体检失败没有可见态 —— 设计红线:异步动作必须显式报错,不许静默回 idle');
  // 修复必须是用户点的,不许体检顺手就改
  const auditFn = s.slice(s.indexOf('async function runSyncAudit'), s.indexOf('async function repairSyncGap'));
  assert.ok(!/repairMissingInCloud/.test(auditFn),
    '体检里顺手补传了 —— 体检只读,修复必须是另一颗按钮、由用户点');
  assert.ok(/onClick=\{repairSyncGap\}/.test(s), '补传按钮不见了');
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`graph-consistency 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`graph-consistency: OK(${results.length} 条,体检判据 + 定点补传)`);
