/**
 * 行为契约:生命版图领土条(纯函数)。
 * 锁死:意义密度切分(非数量)、占比合计=100、降序、零占比剔除、
 * 最大迁移(近 60 天占比涨最多且 ≥6pt)、无数据安全空态。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/life-territory.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
// 唯一 import 是 type-only(LifeNode),transpile 后被抹除 → vm 无需 require。
vm.runInNewContext(js, { module: mod, exports: mod.exports });
const { computeTerritory, detectTerritoryDomain, TERRITORY_DOMAINS } = mod.exports;

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 12, 12, 0, 0).getTime();
const ago = (days) => new Date(NOW - days * DAY).toISOString();

// 域判定:关键词优先于类型
{
  assert.equal(detectTerritoryDomain({ name: '和朋友吃饭', type: 'event' }), 'relations', '关键词判关系');
  assert.equal(detectTerritoryDomain({ name: '学习吉他', type: 'object' }), 'growth', '关键词判成长');
  assert.equal(detectTerritoryDomain({ name: '随手记', type: 'commitment' }), 'work', '回落类型→事业');
}

// 占比合计=100、降序、零占比剔除
{
  const nodes = [
    { name: '妈妈', type: 'person', createdAt: ago(3), confidence: 0.9, relations: [1, 2, 3] },
    { name: '家人聚会', type: 'event', tags: ['家人'], createdAt: ago(10), confidence: 0.8 },
    { name: '项目上线', type: 'commitment', createdAt: ago(5), confidence: 0.7, tags: ['工作'] },
    { name: '学吉他', type: 'object', createdAt: ago(8), confidence: 0.6 },
  ];
  const { slices } = computeTerritory(nodes, NOW);
  const sum = slices.reduce((s, x) => s + x.pct, 0);
  assert.equal(sum, 100, '占比合计=100');
  for (let i = 1; i < slices.length; i++) assert.ok(slices[i - 1].pct >= slices[i].pct, '降序');
  assert.ok(slices.every((s) => s.pct > 0), '零占比已剔除');
  assert.ok(slices.every((s) => s.cssVar.startsWith('--portal') || s.cssVar.startsWith('--status')), '色值走 token');
}

// 最大迁移:近窗某域占比明显上涨 → 命中该域
{
  const nodes = [
    // 前窗(60–120 天前):全是事业
    { name: '项目A', type: 'commitment', createdAt: ago(90), confidence: 0.9 },
    { name: '项目B', type: 'commitment', createdAt: ago(80), confidence: 0.9 },
    { name: '项目C', type: 'commitment', createdAt: ago(70), confidence: 0.9 },
    // 近窗(<60 天):全是成长
    { name: '学吉他', type: 'object', tags: ['学习'], createdAt: ago(20), confidence: 0.9 },
    { name: '读书', type: 'object', tags: ['书'], createdAt: ago(10), confidence: 0.9 },
    { name: '学做饭', type: 'object', tags: ['技能'], createdAt: ago(5), confidence: 0.9 },
  ];
  const { shift } = computeTerritory(nodes, NOW);
  assert.ok(shift && shift.id === 'growth', '最大迁移=成长');
}

// 无数据/单窗:不编造迁移
{
  const { slices, shift } = computeTerritory([], NOW);
  assert.equal(slices.length, 0, '空节点→无领土');
  assert.equal(shift, null, '空节点→无迁移');
  const oneWin = computeTerritory([{ name: '妈妈', type: 'person', createdAt: ago(3), confidence: 0.8 }], NOW);
  assert.equal(oneWin.shift, null, '只有近窗数据→不谈迁移');
}

console.log('life-territory: OK');
