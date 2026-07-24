/**
 * 行为契约:云 signals 文本评分检索(从 signals 路由抽出的共用纯排序)。
 * 这是「向量检索不可用」时的确定性回退:按相关度重排(token 命中 > 近期 > 置信度),
 * 取前 N。注意它不做硬过滤(置信度地板即可越过阈值)—— 过滤是向量路径的职责,
 * 这里只保证「更相关的排前面」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/cloud/signal-search.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, String, Boolean, Date, Math, require: () => ({}) });
  return mod.exports;
}
const M = load();
const NOW = Date.parse('2026-07-24T00:00:00Z');

// 分词:英文单词 + CJK
const toks = M.tokenizeSearchQuery('where is my Passport, 护照?');
assert.ok(toks.includes('passport'), '小写英文词');
assert.ok(toks.includes('护照'), 'CJK 词');

// token 命中 > 近期:较老但命中的记忆,应排在更新但不相关的前面
const mixed = [
  { signal_id: 'recent_unrelated', title: 'Bought milk', source: 'voice', captured_at: '2026-07-23T00:00:00Z', confidence: 0.9 },
  { signal_id: 'old_match', title: 'Passport in top drawer', source: 'voice', captured_at: '2026-03-01T00:00:00Z', confidence: 0.7 },
];
const ranked = M.sortRowsForQuery(mixed, 'where is my passport', 5, NOW);
assert.equal(ranked[0].signal_id, 'old_match', '命中的记忆胜过更新但不相关的');

// 无 query → 原样前 N 条(输入顺序)
const recent = M.sortRowsForQuery(mixed, '', 1, NOW);
assert.equal(recent.length, 1, '无 query 截断到 limit');
assert.equal(recent[0].signal_id, 'recent_unrelated', '无 query 保持输入顺序');

// 同命中,较新的靠前(近期加权做 tiebreak)
const twoHits = [
  { signal_id: 'old', title: 'keys note', source: 'voice', captured_at: '2026-05-01T00:00:00Z', confidence: 0.7 },
  { signal_id: 'new', title: 'keys note', source: 'voice', captured_at: '2026-07-23T00:00:00Z', confidence: 0.7 },
];
const keyRank = M.sortRowsForQuery(twoHits, 'keys', 5, NOW);
assert.equal(keyRank[0].signal_id, 'new', '同命中,较新的靠前');

// limit 生效
assert.equal(M.sortRowsForQuery(twoHits, 'keys', 1, NOW).length, 1, 'limit 截断命中结果');

console.log('✓ signal-search 契约通过');
