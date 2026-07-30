/**
 * 行为契约:按人分类的数据(人缘㊄)。
 * 锁死:person-records 本机 store 的增删读 + 分类元(敏感三类标记/消费带金额);workshop 全数据
 * 跨端一致 —— 按人数据改为**云端同步**(durable + 进备份/同步,仅本人账号内、不进 AI),仍进删除收口;
 * 详情页可挂一条/展示/删除、敏感项「仅你可见 · 不进 AI」提示。
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

// ── storage-manifest:person-records 改云端同步(durable + 进备份/同步,仍进删除收口) ──
const sm = run(compile('../lib/portal/storage-manifest.ts'), { require: () => ({}) });
assert.equal(sm.isLocalOnly('nesio-person-records-v1'), false, '按人数据不再 local-only(workshop:跨端同步)');
assert.equal(sm.keyKind('nesio-person-records-v1'), 'durable', '仍是 durable(删除会清)');
assert.equal(sm.isBackupKey('nesio-person-records-v1'), true, '进备份/同步(仅本人账号、不进 AI)');
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
// 批次:「挂一条」抽成独立弹窗 HangNoteSheet。详情页负责 读/删 + 打开它;
// 新增(addPersonRecord)+ 分类选择 迁到 HangNoteSheet。
// bug3:入口按钮改名「记录」并挪到名字同一行;起手的「说一句 → 云端抽取」整页删掉,
// 只留手动输入(一个输入框 + 加号传附件),所以这里不再断言云调用与敏感提示文案。
const sheet = fs.readFileSync(new URL('../components/portal/relationships/RelationshipDetailSheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes('deletePersonRecord') && sheet.includes('loadPersonRecords'), '详情页删/读记录');
assert.ok(sheet.includes('HangNoteSheet') && sheet.includes('setHangOpen(true)'), '详情页开「记录」弹窗');
assert.ok(sheet.includes('sensitive') && sheet.includes('不进 AI'), '敏感项「仅你可见 · 不进 AI」提示');

const hang = fs.readFileSync(new URL('../components/portal/relationships/HangNoteSheet.tsx', import.meta.url), 'utf8');
assert.ok(hang.includes('addPersonRecord') && hang.includes('RECORD_CATEGORIES'), '挂一条:新增记录 + 分类选择');
// bug3:只留手动输入 —— 不许再有云抽取路径悄悄回来
assert.ok(!hang.includes('person-extract'), '记一条:零云调用(说一句抽取整页已删)');
assert.ok(hang.includes('putLocalFile') && hang.includes('MAX_FILE_BYTES'), '记一条:加号传附件走本机文件库(有体积上限)');
assert.ok(hang.includes('setErr') && hang.includes('role="alert"'), '记一条:附件存不进有可见失败态');

console.log('person-records: OK');
