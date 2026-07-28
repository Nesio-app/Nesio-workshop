/**
 * 行为契约:中英同义词扩展(lib/portal/query-synonyms.ts)。
 * 不变式 —— 中文问句能扩出英文说法(反之亦然)、不回吐原词、短词不乱命中、结果去重且确定。
 *
 * 这条测试锁的是 PDF1 图7 那个具体故事:问「医生预约」要能扯出 appointment / clinic,
 * 否则日历里那条英文的 "Appointment with MedPsych Integrated" 又会搜不到。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/query-synonyms.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Map, Array, Number, Object, String });
  return mod.exports;
}
const M = load();

// ── 图7 的原案:中文问句 → 英文说法 ──
{
  const out = M.expandQueryTerms(['医生预约', '医生', '预约']);
  assert.ok(out.includes('appointment'), '「预约」要能扩出 appointment');
  assert.ok(out.includes('doctor'), '「医生」要能扩出 doctor');
  assert.ok(out.includes('clinic'), '同组的 clinic 也该带出来');
  // 原词不回吐
  assert.equal(out.includes('医生'), false);
  assert.equal(out.includes('预约'), false);
}

// ── 反向:英文问句 → 中文说法 ──
{
  const out = M.expandQueryTerms(['appointment']);
  assert.ok(out.includes('预约'), 'appointment 要能扩出「预约」');
  assert.ok(out.includes('挂号'));
}

// ── 一个 token 命中多组时,几组一起带出来 ──
{
  const out = M.expandQueryTerms(['医生预约']);
  assert.ok(out.includes('doctor') && out.includes('appointment'), '「医生预约」应同时命中两组');
}

// ── 短词只在全等时命中(防 dr/md 到处误爆) ──
{
  const out = M.expandQueryTerms(['android']);   // 含 'dr' 但不该被当成医生
  assert.equal(out.includes('doctor'), false, "'android' 不该命中短词 'dr'");
  const hit = M.expandQueryTerms(['dr']);
  assert.ok(hit.includes('医生'), "全等的 'dr' 应命中");
}

// ── 没有同义词的查询:返回空,不瞎扩 ──
{
  assert.equal(M.expandQueryTerms(['zzzq', '🙂']).length, 0);
  assert.equal(M.expandQueryTerms([]).length, 0);
  assert.equal(M.hasSynonyms(['zzzq']), false);
  assert.equal(M.hasSynonyms(['预约']), true);
}

// ── 结果去重 + 确定(同样输入两次同样输出) ──
{
  const a = M.expandQueryTerms(['医生', '看病', '门诊']);
  const b = M.expandQueryTerms(['医生', '看病', '门诊']);
  assert.equal(a.join(','), b.join(','), '必须确定性');
  assert.equal(new Set(a).size, a.length, '不能有重复词');
}

// ── 别的领域抽查 ──
{
  assert.ok(M.expandQueryTerms(['快递']).includes('tracking'), '快递 → tracking');
  assert.ok(M.expandQueryTerms(['flight']).includes('航班'), 'flight → 航班');
  assert.ok(M.expandQueryTerms(['家长会']).includes('pta'), '家长会 → pta');
  assert.ok(M.expandQueryTerms(['牙医']).includes('dental'), '牙医 → dental');
}

console.log('query-synonyms: OK');
