/**
 * 行为契约:开放世界 Layer ①(捕捉兜底 · 永不丢)。
 * 1) extraction 分类规则含「兜底捕捉」:未命中也存低置信 note(慷慨 tags、confidence≤0.5),不丢。
 * 2) 召回侧(signal-search)按相关性>0 过滤、confidence 只影响**排序**不做阈值排除 —— 低置信捕捉
 *    仍翻得出(② 能激活 ① 存下的长尾),否则兜底存了也白存。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ① 兜底规则在 extraction prompt 里
const ext = read('../lib/extraction/extraction.ts');
assert.match(ext, /兜底捕捉|Layer\s*①/, '分类规则含兜底捕捉(Layer ①)');
assert.match(ext, /永不丢|绝不要跳过|不要跳过/, '明确「永不丢/不跳过」');
assert.match(ext, /confidence\s*[≤<]?=?\s*0?\.5/, '兜底捕捉 confidence ≤0.5');
assert.match(ext, /note 节点|note节点/, '兜底走 note 节点(通用捕捉)');

// ② 召回不按 confidence 阈值排除低置信(只影响排序)
const search = read('../lib/life-domain/signal-search.ts');
assert.match(search, /rel\s*>\s*0/, '按相关性>0 过滤(非 confidence 阈值)');
assert.ok(
  !/confidence\s*[<>]=?\s*0?\.\d/.test(search),
  'signal-search 不对 confidence 设阈值排除(低置信捕捉仍可召回)',
);
assert.match(search, /confidence\s*\*/, 'confidence 参与打分排序(而非硬过滤)');

console.log('open-world-capture: OK');
