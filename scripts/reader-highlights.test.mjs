/**
 * 行为契约:阅读器高亮切段(纯函数)。
 * 锁死:命中切段、多片段、重叠合并、无命中原样、空输入安全。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/reader-highlights.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports }); // 无 import,免 require
const { segmentParagraph } = mod.exports;

const joined = (segs) => segs.map((s) => s.text).join('');
const markedText = (segs) => segs.filter((s) => s.mark).map((s) => s.text).join('|');

// 单片段命中:切成 前/高亮/后 三段,拼回原文不丢字
{
  const t = '下午那杯咖啡是在常去的那家,靠窗的位置。';
  const segs = segmentParagraph(t, ['常去的那家']);
  assert.equal(joined(segs), t, '拼回原文');
  assert.equal(markedText(segs), '常去的那家', '高亮命中片段');
  assert.equal(segs.filter((s) => s.mark).length, 1, '一段高亮');
}

// 多片段 + 重叠:相邻/交叠命中合并成连续高亮
{
  const t = 'ABCDEFG';
  const segs = segmentParagraph(t, ['BCD', 'CDE']); // 交叠 → BCDE 连续
  assert.equal(joined(segs), t, '拼回原文');
  assert.equal(markedText(segs), 'BCDE', '交叠片段合并');
}

// 无命中:整段一段、非高亮
{
  const segs = segmentParagraph('没有命中的一段', ['不存在']);
  assert.equal(segs.length, 1, '整段一段');
  assert.equal(segs[0].mark, false, '非高亮');
}

// 空输入安全
{
  assert.deepEqual(segmentParagraph('', ['x']).length, 0, '空段落→空');
  const segs = segmentParagraph('文字', []);
  assert.equal(segs.length, 1, '无片段→整段');
  assert.equal(segs[0].mark, false, '无片段→非高亮');
}

// 同一片段多处命中:都高亮
{
  const t = '猫和狗和猫';
  const segs = segmentParagraph(t, ['猫']);
  assert.equal(joined(segs), t, '拼回');
  assert.equal(segs.filter((s) => s.mark).length, 2, '两处「猫」都高亮');
}

console.log('reader-highlights: OK');
