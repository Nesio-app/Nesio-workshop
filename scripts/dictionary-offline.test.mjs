/**
 * 离线词典契约:词库可查、中文反查、生词本 key 登记、洞察有板块、首页 + 有入口。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadLookup() {
  const lexJs = ts.transpileModule(read('lib/portal/dictionary/offline-lexicon.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const lookJs = ts.transpileModule(read('lib/portal/dictionary/lookup.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const lexMod = { exports: {} };
  vm.runInNewContext(lexJs, { module: lexMod, exports: lexMod.exports, require: () => ({}), console });
  const lookMod = { exports: {} };
  vm.runInNewContext(lookJs, {
    module: lookMod, exports: lookMod.exports,
    require: (id) => (String(id).includes('offline-lexicon') ? lexMod.exports : {}),
    console,
  });
  return lookMod.exports;
}

const { lookupWord } = loadLookup();
assert.ok(typeof lookupWord === 'function', 'lookupWord 不见了');

const hello = lookupWord('hello');
assert.ok(hello.length > 0 && hello[0].rank === 'exact', 'hello 应对精确命中');
assert.ok(hello[0].entry.senses.some((s) => /你好/.test(s.zh)), 'hello 要有中文释义');

const zh = lookupWord('今天');
assert.ok(zh.length > 0, '中文「今天」应反查到 today');

assert.equal(lookupWord('xyzzy_not_a_word_zzz').length, 0, '词库外的词不许瞎编');

assert.ok(/lookupWord/.test(read('components/portal/insights/DictionaryPanel.tsx')), '洞察词典板块要接查词');
assert.ok(/生词本|Wordbook/.test(read('components/portal/dictionary/DictionarySheet.tsx')), '要有生词本');
const insights = read('components/portal/InsightsSheet.tsx');
assert.ok(/'dictionary'/.test(insights) && /DictionaryPanel/.test(insights), '洞察宫格要有词典 tab');
assert.ok(/onDictionary/.test(read('components/portal/today/CaptureBar.tsx')) && /查词典/.test(read('components/portal/today/CaptureBar.tsx')), '首页 + 菜单要有查词典');
assert.ok(/nesio-dict-wordbook-v1/.test(read('scripts/storage-key-registry.test.mjs')), '生词本 key 必须登记');

console.log('dictionary-offline: OK(词库可查 · 中文反查 · 洞察板块 · +菜单 · 生词本登记)');
