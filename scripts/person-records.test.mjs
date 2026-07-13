/**
 * 行为契约:按人分类的数据(人缘㊄)。
 * 锁死:person-records 本机 store 的增删读 + 分类元(敏感三类标记/消费带金额);敏感数据
 * local-only —— 进删除、不进备份(兑现「只存本机、不上传」);详情页可挂一条/展示/删除、敏感提示。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function run(js, sandbox) {
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, RegExp, ...sandbox });
  return mod.exports;
}

// ── person-records store ──
const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
const pr = run(compile('../lib/portal/person-records.ts'), {
  localStorage, window: win, CustomEvent: class { constructor(t) { this.type = t; } },
  require: (p) => (p.includes('storage-health') ? { reportStorageDropped: () => {} } : {}),
});

assert.equal(pr.RECORD_CATEGORIES.length, 6, '六个分类');
const map = pr.RECORD_CATEGORY_MAP;
assert.ok(map.medical.sensitive && map.medication.sensitive && map.health.sensitive, '医疗/药物/健康=敏感');
assert.ok(!map.achievement.sensitive && !map.spending.sensitive && !map.location.sensitive, '成绩/消费/位置=非敏感');
assert.ok(map.spending.money, '消费带金额');

pr.addPersonRecord({ personKey: 'Mia', category: 'achievement', title: '年级第一', date: '2026-06-02' });
pr.addPersonRecord({ personKey: 'mia', category: 'medical', title: '体检', detail: '一切正常' });
pr.addPersonRecord({ personKey: 'other', category: 'spending', title: '礼物', amount: 200 });

const mia = pr.loadPersonRecords('mia');
assert.equal(mia.length, 2, 'Mia 两条(key 归一大小写)');
assert.ok(mia.some((r) => r.title === '年级第一' && r.category === 'achievement'), '成绩记录');
assert.ok(mia.some((r) => r.category === 'medical'), '医疗记录');
const counts = pr.personRecordCounts('mia');
assert.equal(counts.achievement, 1); assert.equal(counts.medical, 1);

const delId = mia[0].id;
pr.deletePersonRecord(delId);
assert.equal(pr.loadPersonRecords('mia').length, 1, '删除生效');
// 其他人不受影响
assert.equal(pr.loadPersonRecords('other')[0].amount, 200, '金额落库');

// ── storage-manifest:person-records local-only(进删除、不进备份) ──
const sm = run(compile('../lib/portal/storage-manifest.ts'), { require: () => ({}) });
assert.equal(sm.isLocalOnly('nesio-person-records-v1'), true, '按人数据 = local-only');
assert.equal(sm.keyKind('nesio-person-records-v1'), 'durable', '仍是 durable(删除会清)');
assert.equal(sm.isBackupKey('nesio-person-records-v1'), false, 'local-only 不进备份(不上传)');
assert.equal(sm.isBackupKey('nesio-life-graph-v1'), true, '普通 durable 仍进备份(对照)');
// 删除数据会清掉它
const st = { data: { 'nesio-person-records-v1': '[]', 'nesio-life-graph-v1': '[]' } };
const storageLike = {
  get length() { return Object.keys(st.data).length; },
  key(i) { return Object.keys(st.data)[i] ?? null; },
  getItem(k) { return st.data[k] ?? null; },
  setItem(k, v) { st.data[k] = v; },
  removeItem(k) { delete st.data[k]; },
};
const purged = sm.purgeLocalData(storageLike);
assert.ok(purged.keys.includes('nesio-person-records-v1'), '删除数据清掉按人数据');

// ── 详情页接线(源码级) ──
// 批次:「挂一条」抽成独立确认卡弹窗 HangNoteSheet。详情页负责 读/删 + 打开挂一条;
// 新增(addPersonRecord)+ 分类选择 + 敏感本机 迁到 HangNoteSheet。
const sheet = fs.readFileSync(new URL('../components/portal/relationships/RelationshipDetailSheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes('deletePersonRecord') && sheet.includes('loadPersonRecords'), '详情页删/读记录');
assert.ok(sheet.includes('挂一条') && sheet.includes('HangNoteSheet'), '详情页开「挂一条」弹窗');
assert.ok(sheet.includes('sensitive') && sheet.includes('只存本机'), '敏感项本机提示');

const hang = fs.readFileSync(new URL('../components/portal/relationships/HangNoteSheet.tsx', import.meta.url), 'utf8');
assert.ok(hang.includes('addPersonRecord') && hang.includes('RECORD_CATEGORIES'), '挂一条:新增记录 + 分类选择');
assert.ok(hang.includes('sensitive') && hang.includes('只存本机'), '挂一条:敏感项只存本机');
assert.ok(hang.includes('person-extract'), '挂一条:AI 提取走 person-extract');

console.log('person-records: OK');
