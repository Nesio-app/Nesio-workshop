/**
 * 离线词典契约:内置精选可查 + ECDICT 大包存在 + 中文反查 + AI 开关 + 生词本登记。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import ts from 'typescript';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadLookup() {
  const lexJs = ts.transpileModule(read('lib/portal/dictionary/offline-lexicon.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // ecdict-pack 在 Node 测里用 stub,避免拉 fetch;同步 lookupWord 只依赖精选库
  const lookSrc = read('lib/portal/dictionary/lookup.ts')
    .replace(/from '\.\/ecdict-pack'/g, "from './ecdict-pack-stub'");
  const lookJs = ts.transpileModule(lookSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const stub = {
    ensureEcdictMeta: async () => ({ count: 0, shards: [], version: 'stub', source: 'stub' }),
    lookupEcdict: async () => [],
    getEcdictEntry: async () => null,
    ecdictPackCount: () => 0,
  };
  const lexMod = { exports: {} };
  vm.runInNewContext(lexJs, { module: lexMod, exports: lexMod.exports, require: () => ({}), console });
  const lookMod = { exports: {} };
  vm.runInNewContext(lookJs, {
    module: lookMod, exports: lookMod.exports,
    require: (id) => {
      if (String(id).includes('offline-lexicon')) return lexMod.exports;
      if (String(id).includes('ecdict-pack')) return stub;
      return {};
    },
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

const lexSrc = read('lib/portal/dictionary/offline-lexicon.ts');
assert.ok(/export const LEXICON_SIZE = OFFLINE_LEXICON\.length;/.test(lexSrc), 'LEXICON_SIZE 必须导出');

// ECDICT 大包(欧路兼容开源库)
const metaPath = path.join(root, 'public/data/dictionary/meta.json');
assert.ok(fs.existsSync(metaPath), 'ECDICT meta.json 必须存在');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
assert.ok(meta.count >= 200_000, `ECDICT 离线包至少 20 万词,当前 ${meta.count}`);
assert.ok(/ECDICT/i.test(meta.source || ''), 'meta.source 应标明 ECDICT');
for (const s of meta.shards || []) {
  const gz = path.join(root, `public/data/dictionary/${s}.json.gz`);
  assert.ok(fs.existsSync(gz), `缺分片 ${s}.json.gz`);
}
const sample = zlib.gunzipSync(fs.readFileSync(path.join(root, 'public/data/dictionary/h.json.gz')));
const rows = JSON.parse(sample.toString('utf8'));
assert.ok(Array.isArray(rows) && rows.length > 100, 'h 分片应有词条');
assert.ok(rows.some((r) => String(r[0]).toLowerCase() === 'hello'), 'h 分片应含 hello');

assert.ok(/nesio-dict-ai-enabled-v1/.test(read('scripts/storage-key-registry.test.mjs')), 'AI 查词开关 key 必须登记');
assert.ok(/dictionary-lookup/.test(read('app/api/portal/dictionary-lookup/route.ts')), 'AI 查词 API 路由必须存在');
assert.ok(/lookupWordAsync|lookupWord/.test(read('components/portal/insights/DictionaryPanel.tsx')), '洞察词典板块要接查词');
assert.ok(/生词本|Wordbook/.test(read('components/portal/dictionary/DictionarySheet.tsx')), '要有生词本');
const insights = read('components/portal/InsightsSheet.tsx');
assert.ok(/'dictionary'/.test(insights) && /DictionaryPanel/.test(insights), '洞察宫格要有词典 tab');
assert.ok(/nesio-dict-wordbook-v1/.test(read('scripts/storage-key-registry.test.mjs')), '生词本 key 必须登记');
assert.ok(/ecdict-pack/.test(read('lib/portal/dictionary/lookup.ts')), 'lookup 必须接 ECDICT 大包');

console.log(`dictionary-offline: OK(精选可查 · ECDICT ${meta.count} · 中文反查 · AI · 生词本)`);
