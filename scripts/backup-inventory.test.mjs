/**
 * 行为契约:导出装箱单(backup-inventory)。
 * 「随时导出你的全部数据」是对用户的承诺,而**无法验证的承诺等于没有承诺** ——
 * 这份清单就是验证手段。锁死:条数统计、主数据空了必须报可疑、回执文案不吹牛。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, JSON, Object, Array, Number, String, Math, Boolean });
  return mod.exports;
}
const B = loadTs('../lib/portal/backup-inventory.ts');

const arr = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i })));

// ── 正常一份备份 ──
const full = {
  'nesio-life-graph-v1': arr(2328),
  'nesio-bank-tx-v1': arr(3128),
  'nesio-bank-accounts-v1': arr(6),
  'nesio-expenses-v1': arr(47),
  'nesio-place-trail-v1': arr(500),
  'local-image:a': 'data:...',
  'local-image:b': 'data:...',
  'nesio-some-setting': '"x"',
};
const inv = B.inventoryBackup(full, 148 * 1048576);
assert.equal(inv.totalKeys, 8);
assert.equal(inv.photos, 2, 'local-image: 前缀单独计照片');
const byKey = Object.fromEntries(inv.lines.map((l) => [l.key, l]));
assert.equal(byKey['nesio-life-graph-v1'].count, 2328);
assert.equal(byKey['nesio-bank-tx-v1'].count, 3128);
assert.equal(byKey['nesio-health-v1'].count, null, '没导过健康 → 键不存在,记 null');
assert.equal(inv.suspect.length, 0, '主数据齐全 → 不可疑');

const sum = B.inventorySummary(inv, 'zh');
assert.match(sum, /^✓ 备份装箱:/);
assert.match(sum, /记忆 2328/);
assert.match(sum, /银行流水 3128/);
assert.match(sum, /照片 2/);
assert.match(sum, /148\.0 MB/);
assert.ok(!/健康指标/.test(sum), '没有的数据不出现在回执里(不吹牛)');
assert.equal(B.inventoryWarning(inv, 'zh'), null, '一切正常 → 不提醒');

// ── 主数据缺失:必须报可疑(这正是本次发现问题的场景)──
const partial = { 'nesio-life-graph-v1': arr(2328), 'nesio-bank-accounts-v1': arr(6) };
const inv2 = B.inventoryBackup(partial, 1024);
assert.equal(inv2.suspect.length, 1, '银行流水缺失 → 1 条可疑');
assert.equal(inv2.suspect[0].key, 'nesio-bank-tx-v1');
const warn = B.inventoryWarning(inv2, 'zh');
assert.ok(warn && /银行流水/.test(warn), '提醒里点名是哪一项空了');
assert.ok(/同步/.test(warn), '给出可能原因(设备没同步完)');
assert.ok(/换/.test(warn) || /再导/.test(warn), '给出出路,不是只报警');

// 本机有图但备份无图 → 单独警告
const noPhotoPack = B.inventoryBackup({ 'nesio-life-graph-v1': arr(3), 'nesio-bank-tx-v1': arr(3) }, 100);
assert.equal(noPhotoPack.photos, 0);
const photoWarn = B.inventoryWarning(noPhotoPack, 'zh', { localPhotoCount: 12 });
assert.ok(photoWarn && /12 张照片/.test(photoWarn), '本机有图备份无图必须警告');
assert.equal(B.inventoryWarning(noPhotoPack, 'zh', { localPhotoCount: 0 }), null, '本机也没图 → 不因照片打扰');

// 主数据存在但 0 条,同样可疑(空数组比缺键更迷惑人)
const empty = { 'nesio-life-graph-v1': arr(0), 'nesio-bank-tx-v1': arr(0) };
assert.equal(B.inventoryBackup(empty).suspect.length, 2, '0 条也算可疑');

// 非主数据为空不报警(只是没用过那个功能)
const noOptional = { 'nesio-life-graph-v1': arr(10), 'nesio-bank-tx-v1': arr(10) };
assert.equal(B.inventoryBackup(noOptional).suspect.length, 0, '可选数据空着是正常的,不打扰');

// ── 解析健壮性 ──
const messy = { 'nesio-life-graph-v1': '{不是JSON', 'nesio-bank-tx-v1': '{"a":1,"b":2}' };
const inv3 = B.inventoryBackup(messy);
const m = Object.fromEntries(inv3.lines.map((l) => [l.key, l]));
assert.equal(m['nesio-life-graph-v1'].count, null, '坏 JSON → null,不炸');
assert.equal(m['nesio-bank-tx-v1'].count, 2, '对象型条目按键数计');
assert.equal(B.inventoryBackup({}).totalKeys, 0, '空备份不炸');

// ── 英文 ──
const en = B.inventorySummary(B.inventoryBackup(full, 0), 'en');
assert.match(en, /^✓ Backup pack: /);
assert.match(en, /Memories 2328/);
assert.ok(!/MB/.test(en), '未知体积不硬报 0 MB');
assert.match(B.inventoryWarning(inv2, 'en'), /Bank transactions/);

// ── 分片记忆图:只看整图键会误报空(真机导出场景)──
const sharded = {
  'nesio-life-graph-v1:index': JSON.stringify(['2023', '2024']),
  'nesio-life-graph-v1:2023': arr(10),
  'nesio-life-graph-v1:2024': arr(25),
  'nesio-bank-tx-v1': arr(5),
};
const invShard = B.inventoryBackup(sharded, 2048);
assert.equal(Object.fromEntries(invShard.lines.map((l) => [l.key, l]))['nesio-life-graph-v1'].count, 35, '分片求和');
assert.equal(invShard.suspect.length, 0, '分片有记忆 → 不可疑');
assert.match(B.inventorySummary(invShard, 'zh'), /记忆 35/);

// ── 导入窗口清单:事实表,防止「窗口悄悄变了但文档还写着老的」 ──
assert.ok(Array.isArray(B.IMPORT_WINDOWS) && B.IMPORT_WINDOWS.length >= 7, '每个 API 导入源都要在表里');
const cal = B.IMPORT_WINDOWS.find((w) => /日历/.test(w.source[0]));
assert.ok(cal && /未来/.test(cal.window[0]) && cal.canBackfill === false,
  '日历只拉未来、无历史回填 —— 这条最反直觉,必须钉住');
const granola = B.IMPORT_WINDOWS.find((w) => /Granola/.test(w.source[0]));
assert.ok(granola && granola.canBackfill === false, 'Granola 无更宽范围可选');
const plaid = B.IMPORT_WINDOWS.find((w) => /Plaid/.test(w.source[0]));
assert.ok(plaid && plaid.canBackfill === true, 'Plaid 有全量回填');
for (const w of B.IMPORT_WINDOWS) {
  assert.equal(w.source.length, 2, '中英双语');
  assert.equal(w.window.length, 2);
  assert.equal(typeof w.canBackfill, 'boolean');
}

console.log('backup-inventory: OK(装箱单 + 主数据空即可疑 + 回执不吹牛 + 导入窗口事实表)');
