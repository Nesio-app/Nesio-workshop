/**
 * 行为契约:穿搭反馈学习(本地偏好)。
 * 锁死:👍/穿了 → 颜色好感 +;👎 → 颜色 - 且记住上下装组合;颜色好感封顶 ±4;
 * buildStylistDislikes 把偏好翻成给云造型师的「避免」提示。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/wardrobe-prefs.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mem = new Map();
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Math, Number, String,
    window: { dispatchEvent() {} },
    require: (p) => {
      if (p === './storage-health') return { reportStorageDropped: () => {} };
      if (p === './wardrobe') return { pairKey: (a, b) => [a, b].sort().join('|') };
      if (p === './idb-blob-store') {
        return {
          createBlobStore: ({ key }) => ({
            load: () => mem.get(key) ?? null,
            save: (v) => { mem.set(key, v); },
            ready: async () => {},
            refresh: async () => {},
            isReady: () => true,
          }),
        };
      }
      return {};
    },
  });
  return { M: mod.exports, store: mem };
}

const { M } = load();

// 👍 喜欢 → 颜色好感 +
{
  const p = M.recordOutfitFeedback('like', [{ id: 't', colors: ['蓝'], garmentType: 'top' }, { id: 'b', colors: ['黑'], garmentType: 'bottom' }]);
  assert.equal(p.colorLikes['蓝'], 1, '喜欢 → 蓝 +1');
  assert.equal(p.colorLikes['黑'], 1, '喜欢 → 黑 +1');
  assert.equal(p.dislikedPairs.length, 0, '喜欢不记拒绝组合');
}

// 👎 不喜欢 → 颜色 - 且记住这对
{
  const p = M.recordOutfitFeedback('dislike', [{ id: 't', colors: ['蓝'], garmentType: 'top' }, { id: 'b', colors: ['绿'], garmentType: 'bottom' }]);
  assert.equal(p.colorLikes['蓝'], 0, '之前 +1,这次 -1 → 0');
  assert.equal(p.colorLikes['绿'], -1, '绿 -1');
  assert.ok(p.dislikedPairs.includes('b|t'), '记住拒绝的上下装组合(排序 key)');
}

// 颜色好感封顶 ±4
{
  for (let i = 0; i < 10; i++) M.recordOutfitFeedback('like', [{ id: 'x', colors: ['红'], garmentType: 'top' }]);
  const p = M.recordOutfitFeedback('like', [{ id: 'x', colors: ['红'], garmentType: 'top' }]);
  assert.equal(p.colorLikes['红'], 4, '好感封顶 +4');
}

// buildStylistDislikes → 人话提示
{
  const prefs = { colorLikes: { 绿: -2 }, dislikedItemIds: [], dislikedPairs: ['b|t'] };
  const byId = new Map([['t', { name: '毛衣' }], ['b', { name: '短裤' }]]);
  const hints = M.buildStylistDislikes(prefs, byId);
  assert.ok(hints.some((h) => /毛衣/.test(h) && /短裤/.test(h)), '提示避开毛衣配短裤');
  assert.ok(hints.some((h) => /少用/.test(h) && /绿/.test(h)), '提示少用绿色');
}

console.log('✓ wardrobe-prefs 契约通过');
