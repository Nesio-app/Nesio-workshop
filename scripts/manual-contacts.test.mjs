/**
 * 行为契约:手动增/改/删联系人(lib/portal/manual-contacts.ts)。
 *
 * People 里的人原本全是推出来的,用户加不了、删不掉、改不了。补上这三件时,
 * 有两个坑一旦踩了就是**静默丢数据**,用户只会说「我就改了个名字,记录全没了」:
 *
 *   ① 改名不搬家。Contact.key 从名字/邮箱派生,改名 = 换 key。
 *      挂在旧 key 上的 person-records(含医疗/药物/健康)、亲疏覆盖当场失联。
 *   ② 「移除」对推出来的人无效。删掉 person 节点,但邮件发件人/relations 里
 *      还提着这个名字 —— 下次 buildRelationships 重算,人又回来了。
 *      表现是「点了移除没反应」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── ① 改名必须搬家 ───────────────────────────────────────────────────────────
{
  const src = code('lib/portal/manual-contacts.ts');
  assert.match(src, /export function renameContact/, '必须有 renameContact');
  // 三样都得搬,少一样就是一类数据静默失联。
  assert.match(src, /movePersonRecords\(\s*oldKey\s*,\s*newKey\s*\)/, '改名没搬 person-records —— 医疗/药物/健康记录会失联');
  assert.match(src, /setRelationshipOverride\(\s*newKey\s*,/, '改名没搬亲疏/关系词覆盖');
  assert.match(src, /mergeEntity\(\s*oldKey\s*,\s*newKey\s*\)/, '改名没把旧名登记成别名 —— 历史记忆里提到旧名的都会掉队');
}

// ── ② 移除必须对推出来的人也生效 ──────────────────────────────────────────────
{
  const src = code('lib/portal/manual-contacts.ts');
  assert.match(src, /export function removeContact/, '必须有 removeContact');
  assert.match(src, /setContactHidden\(\s*key\s*,\s*true\s*\)/,
    'removeContact 只删了节点没标 hidden —— 推出来的人下次重算又会冒出来(表现:点了移除没反应)');

  // 推导层必须真的认这条覆盖
  const rel = code('lib/portal/relationships.ts');
  assert.match(rel, /overrides\[a\.key\]\?\.hidden/,
    'buildRelationships 没跳过 hidden 的人 —— 覆盖记了但没人读,「移除」等于没点');
}

// ── 写入闸门:手动建人不许绕过 ────────────────────────────────────────────────
{
  const src = code('lib/portal/manual-contacts.ts');
  assert.match(src, /ingestLifeNode\(/, '新建联系人必须走 ingestLifeNode(写入闸门允许的入口)');
  assert.ok(!/\baddLifeNode\s*\(/.test(src), '绕过写入闸门直接 addLifeNode');
}

// ── person-records 搬家函数本身 ───────────────────────────────────────────────
{
  const src = read('lib/portal/person-records.ts');
  const start = src.indexOf('export function movePersonRecords');
  assert.ok(start > 0, 'person-records 必须导出 movePersonRecords');
  // 抠出来在 vm 里跑真逻辑(它只碰一个注入的数组)
  const body = src.slice(start);
  const js = ts.transpileModule(
    `let STORE = [];
     function loadAllPersonRecords() { return STORE; }
     function saveAll(v) { STORE = v; }
     function __seed(v) { STORE = v; }
     exports.__seed = __seed;
     exports.__all = () => STORE;
     ${body.slice(0, body.indexOf('\n}\n') + 3)}`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, String, Array, Object, window: undefined });
  const M = mod.exports;

  M.__seed([
    { id: 'a', personKey: 'linda', category: 'medication', title: '二甲双胍' },
    { id: 'b', personKey: 'linda', category: 'medical', title: '复诊' },
    { id: 'c', personKey: 'bob', category: 'health', title: '体检' },
  ]);
  assert.equal(M.movePersonRecords('linda', 'linda@x.com'), 2, '该搬的两条都要搬');
  const all = M.__all();
  assert.equal(all.filter((r) => r.personKey === 'linda@x.com').length, 2);
  assert.equal(all.find((r) => r.id === 'c').personKey, 'bob', '别人的记录不许动');

  // 大小写/空格归一(旧 key 常带空格)
  M.__seed([{ id: 'a', personKey: 'linda', category: 'health', title: 'x' }]);
  assert.equal(M.movePersonRecords(' Linda ', 'LINDA@X.COM'), 1, 'key 要归一后比对');

  // 同一个 key / 空 key:不动,也不许抛
  M.__seed([{ id: 'a', personKey: 'linda', category: 'health', title: 'x' }]);
  assert.equal(M.movePersonRecords('linda', 'linda'), 0);
  assert.equal(M.movePersonRecords('', 'x'), 0);
  assert.equal(M.movePersonRecords('linda', ''), 0);
}

console.log('manual-contacts: OK(改名搬家 · 移除对推出来的人也生效 · 走写入闸门)');
