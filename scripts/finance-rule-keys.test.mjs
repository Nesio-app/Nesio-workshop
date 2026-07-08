/**
 * 行为契约:学习规则 entity 键(财务㉚)。
 * 锁死:规则写 merchantKey(entity id 优先)后,商户改描述符/改名仍生效;
 * 老规则(原始名键)原位兼容不迁移;定期手动排除按流键(改名不丢);
 * 面板 label 映射(entity id 不可读 → 记商户名)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const caches = { tx: null, accounts: null, holdings: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = ['tx', 'accounts', 'holdings'][storeIdx++] ?? 'holdings'; // bank-tx 内建 store 顺序:tx → accounts → holdings
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};
const lsData = new Map();
const fakeLocalStorage = { getItem: (k) => lsData.get(k) ?? null, setItem: (k, v) => lsData.set(k, String(v)), removeItem: (k) => lsData.delete(k) };
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, process: { env: {} },
    console, Date, Math, Set, Map, JSON, Number, Array, Object, String,
    window: {}, localStorage: fakeLocalStorage,
  });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/providers/bank-tx.ts', (p) =>
  p === '../storage-health' ? { reportStorageDropped() {} }
  : p === '../tx-category' ? txCategory
  : p === '../idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));

const tx = (id, name, extra = {}) =>
  ({ id, date: '2026-06-10', name, amount: 20, currency: 'USD', category: '', accountId: 'a1', ...extra });

// ── 分类规则:entity 键 —— 商户整体改名(描述符完全不同,id 相同)规则仍生效 ──
const oldTx = tx('t1', 'NETFLIX.COM 866-579-7172', { merchantId: 'ent-netflix' });
const renamedTx = tx('t2', 'Netflix Inc', { merchantId: 'ent-netflix' });
bank.setMerchantRuleFor(oldTx, 'ENTERTAINMENT');
assert.equal(bank.effectiveCategory(renamedTx), 'ENTERTAINMENT', 'entity id 相同 → 改名后分类规则仍生效');
// 归一名兜底:无 id 的商户,门店号/日期等描述符噪音不打断规则
bank.setMerchantRuleFor(tx('t3', 'CHIPOTLE #1234'), 'FOOD_AND_DRINK');
assert.equal(bank.effectiveCategory(tx('t4', 'CHIPOTLE #9876')), 'FOOD_AND_DRINK', '归一名兜底:门店号变化不丢规则');
// 老规则(原始名键,直接写 setMerchantRule)原位兼容
bank.setMerchantRule('Legacy Store LLC 0421', 'GENERAL_MERCHANDISE');
assert.equal(bank.effectiveCategory(tx('t5', 'Legacy Store LLC 0421')), 'GENERAL_MERCHANDISE', '老规则不迁移也生效');

// ── 类型规则(txFlow):entity 键改名后强制类型仍生效 ──
bank.setFlowRuleFor(oldTx, 'transfer');
assert.equal(bank.txFlow(renamedTx), 'transfer', 'flow 规则跟 entity 走');
bank.setFlowRuleFor(oldTx, '');
assert.notEqual(bank.txFlow(renamedTx), 'transfer', '清规则后恢复自动判定');

// ── 定期手动排除:写流键(merchantKey),商户改描述符后仍被排除 ──
const spotify = (id, date, name) => tx(id, name, { date, amount: 11.99, category: 'ENTERTAINMENT', merchantId: 'ent-spotify' });
const stream = [spotify('s1', '2026-03-05', 'SPOTIFY USA'), spotify('s2', '2026-04-05', 'SPOTIFY USA'), spotify('s3', '2026-05-05', 'Spotify P0F1'), spotify('s4', '2026-06-05', 'Spotify P0F1')];
const rec1 = bank.detectRecurring(stream);
assert.equal(rec1.length, 1, '同 entity 不同描述符归并成一条流');
assert.equal(rec1[0].key, 'ent-spotify', 'RecurringCharge 带流键');
bank.setRecurRule(rec1[0].key, 'no');
assert.equal(bank.detectRecurring(stream).length, 0, '按流键排除,最新描述符变了也不复活');
// 老的名称键排除仍被尊重(不迁移)
bank.setRecurRule(rec1[0].key, '');
bank.setRecurRule('Spotify P0F1', 'no'); // 旧行为:按最新一笔原始名存
assert.equal(bank.detectRecurring(stream).length, 0, '老名称键排除原位兼容');

// ── 面板 label:entity 键不可读 → 记商户名;同名键不记(不膨胀) ──
const labels = bank.loadRuleLabels();
assert.equal(labels['ent-netflix'], 'NETFLIX.COM 866-579-7172', 'entity 键记 label 供面板展示');
assert.ok(!('Legacy Store LLC 0421' in labels), '键即名称时不记 label');

// 客户端接线:审核/类型/定期覆盖都走 For/key 版本
const finTab = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(finTab.includes('setMerchantRuleFor(t,'), '审核接受写 merchantKey');
assert.ok(finTab.includes('setFlowRuleFor(t,'), '类型纠正写 merchantKey');
assert.ok(finTab.includes('markNotRecurring(r.key)'), '定期排除传流键');

console.log('finance-rule-keys: OK');
