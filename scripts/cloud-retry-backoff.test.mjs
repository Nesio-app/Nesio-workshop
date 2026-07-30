/**
 * 行为契约:云同步重试退避 + 恢复回执。
 * 由来(QA):离线时 outbox 无退避无上限地顺序重发,控制台刷屏、主线程白耗;
 * 且网络错被判成永久失败,直接踢出重试队列 —— 断网一次就再也不同步了。
 * 另:云端把另一台设备的数据填回本机(积分 0→150)必须留回执,不能悄悄改数。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, extra = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}), console,
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, ...extra,
  });
  return mod.exports;
}

// ── 退避:纯函数,从 life-graph 里取(该文件很大,只验这两个导出)──
const src = fs.readFileSync(new URL('../lib/portal/life-graph.ts', import.meta.url), 'utf8');
assert.match(src, /export function retryBackoffMs/, 'retryBackoffMs 需导出以便钉住');
assert.match(src, /export function isRetryDue/, 'isRetryDue 需导出以便钉住');
assert.match(src, /const RETRY_BATCH_CAP = \d+/, '单轮重试必须有条数上限');
// 网络错必须归 transient(否则断网一次就永久失败、退出重试队列)
assert.match(
  src,
  /catch \{[\s\S]{0,400}?transient: true, error: 'cloud_memory_network_error'/,
  '网络错必须判 transient:true —— 断网是暂时的,不该标永久失败',
);
// 退避与限量必须真的接进重试查询
assert.match(src, /\.filter\(\(record\) => isRetryDue\(record, now\)\)/, '重试前必须过退避闸');
assert.match(src, /\.slice\(0, RETRY_BATCH_CAP\)/, '重试必须限量');

// 退避曲线:随尝试次数指数增长并封顶
const evalBackoff = (attempts) => Math.min(30_000 * Math.pow(2, Math.max(0, attempts)), 6 * 3_600_000);
assert.equal(evalBackoff(0), 30_000, '首次失败后等 30s');
assert.equal(evalBackoff(1), 60_000);
assert.equal(evalBackoff(3), 240_000);
assert.equal(evalBackoff(30), 6 * 3_600_000, '封顶 6 小时,不会无限拉长');
assert.ok(evalBackoff(5) > evalBackoff(4), '单调递增');

// ── 批量记账:必须存在,且回填路径用的是批量版(否则 O(N²) 全表读写回归)──
assert.match(src, /function queueCloudSyncOutboxItems/, '需有批量入队');
assert.match(src, /function markCloudSyncMany/, '需有批量标记');
const backfill = src.slice(src.indexOf('export async function backfillLocalLifeGraphToCloud'));
const backfillBody = backfill.slice(0, backfill.indexOf('\nexport '));
assert.match(backfillBody, /queueCloudSyncOutboxItems\(backfillIds/, '回填必须用批量入队');
assert.match(backfillBody, /markCloudSyncMany\(backfillIds/, '回填必须用批量标记');
assert.ok(
  !/for \(const node of backfillNodes\) \{\s*queueCloudSyncOutboxItem\(/.test(backfillBody),
  '回填里不得再出现逐条入队(N 次全表读写)',
);

// ── 恢复回执 ──
const store = new Map();
const R = loadTs('../lib/portal/cloud-restore-receipt.ts', {
  window: {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
});

// 只对用户认得的模块留回执
R.recordCloudRestore(['nesio-module-sync-state-v1', 'nesio-some-internal']);
assert.equal(R.takeCloudRestoreReceipt(), null, '纯内部键不打扰用户');

R.recordCloudRestore(['nesio-rewards-v1', 'nesio-workouts-v1', 'nesio-internal-x']);
const r1 = R.takeCloudRestoreReceipt();
assert.ok(r1, '有可说的就留回执');
assert.equal(r1.labels.length, 2, '只保留认得出的两项');
const text = R.restoreReceiptText(r1, 'zh');
assert.match(text, /积分/);
assert.match(text, /我的训练/);
assert.match(text, /从你账号里恢复/, '说清来源:是恢复的,不是本机新产生的');
assert.ok(!/!|!/.test(text), 'warm-coach:不用感叹号制造惊吓');

// 读即清,不反复打扰
assert.equal(R.takeCloudRestoreReceipt(), null, '读过一次就清掉');

// 英文
R.recordCloudRestore(['nesio-rewards-v1']);
assert.match(R.restoreReceiptText(R.takeCloudRestoreReceipt(), 'en'), /Points .* restored/);

console.log('cloud-retry-backoff: OK(退避+限量+网络错可重试 / 批量记账 / 恢复回执)');
