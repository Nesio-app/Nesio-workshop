// 跨区 P2 门控+投递契约:可打断性 NB + 同意门 + 新鲜度去重 + 预算。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(rel) {
  const src = readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { module: m, exports: m.exports, require: () => ({}), Math, Date, Object, Array, String, Set, Number, JSON });
  return m.exports;
}
const nb = load('lib/platform/interruptibility-core.mjs');
const gate = load('lib/platform/cross-region/deliver-core.mjs');

// ── 可打断性 NB ──
{
  // 冷启动(样本不足)→ 先验 0.6
  assert.equal(nb.predictAccept({ tod: 'morning', day: 'weekday', activity: 'still' }, nb.trainInterruptibility([])), 0.6, '冷启动返回先验');
  // 学:晚间高受纳,早晨低受纳
  const samples = [];
  for (let i = 0; i < 12; i++) samples.push({ ctx: { tod: 'evening', day: 'weekday', activity: 'still' }, accepted: true });
  for (let i = 0; i < 12; i++) samples.push({ ctx: { tod: 'morning', day: 'weekday', activity: 'active' }, accepted: false });
  const model = nb.trainInterruptibility(samples);
  const pEve = nb.predictAccept({ tod: 'evening', day: 'weekday', activity: 'still' }, model);
  const pMorn = nb.predictAccept({ tod: 'morning', day: 'weekday', activity: 'active' }, model);
  assert.ok(pEve > 0.8, `晚间应高受纳,得 ${pEve}`);
  assert.ok(pMorn < 0.2, `早晨活动中应低受纳,得 ${pMorn}`);
  // contextFromTime 分档
  assert.equal(nb.contextFromTime(new Date('2026-07-06T20:00:00')).tod, 'evening');
  assert.equal(nb.contextFromTime(new Date('2026-07-05T10:00:00')).day, 'weekend'); // 周日
}

// ── 同意门 ──
{
  const health = { id: 'r1', strength: 0.6, domainA: 'health', domainB: 'mood' };
  const benign = { id: 'r2', strength: 0.6, domainA: 'weather', domainB: 'mood' };
  assert.equal(gate.passesConsent(health, new Set()), false, '未授权敏感域 → 挡');
  assert.equal(gate.passesConsent(health, new Set(['health'])), true, '授权后放行');
  assert.equal(gate.passesConsent(benign, new Set()), true, '非敏感域无需授权');
}

// ── 新鲜度/去重 ──
{
  const now = new Date('2026-07-20T12:00:00');
  const rel = { id: 'r1', strength: -0.7, domainA: 'finance', domainB: 'mood' };
  // 3 天前展示过、强度桶相同 → 冷却挡
  const recent = { r1: { at: '2026-07-17T12:00:00', bucket: gate.strengthBucket(-0.7) } };
  assert.equal(gate.passesFreshness(rel, recent, now), false, '14 天内同强度 → 挡');
  // 强度实质变化(ρ -0.7 → +0.2,变号+跨桶)→ 放行
  const changed = { id: 'r1', strength: 0.2, domainA: 'finance', domainB: 'mood' };
  assert.equal(gate.passesFreshness(changed, recent, now), true, '强度实质变化 → 放行重出');
  // 超 14 天 → 放行
  const old = { r1: { at: '2026-07-01T12:00:00', bucket: gate.strengthBucket(-0.7) } };
  assert.equal(gate.passesFreshness(rel, old, now), true, '超 14 天 → 放行');
}

// ── 主门控:同意+新鲜+可打断性+预算(封顶 3)──
{
  const rels = [
    { id: 'a', strength: 0.9, domainA: 'weather', domainB: 'mood' },
    { id: 'b', strength: -0.8, domainA: 'finance', domainB: 'mood' }, // 敏感未授权 → 挡
    { id: 'c', strength: 0.7, domainA: 'fitness', domainB: 'mood' },
    { id: 'd', strength: 0.6, domainA: 'calendar', domainB: 'mood' },
    { id: 'e', strength: 0.5, domainA: 'weather', domainB: 'fitness' },
  ];
  const out = gate.gateDeliverables(rels, { consentedDomains: new Set(), now: new Date(), acceptProb: 0.7 });
  assert.ok(!out.some((r) => r.id === 'b'), '敏感未授权被挡');
  assert.equal(out.length, 3, '预算封顶 3');
  assert.deepEqual(out.map((r) => r.id), ['a', 'c', 'd'], '按 |strength| 降序取前 3');
  assert.ok(out[0].cooldownBucket, '存活项带 cooldown 桶(供记账)');
  // 可打断性门:P<0.5 → 整批不推
  assert.equal(gate.gateDeliverables(rels, { acceptProb: 0.3 }).length, 0, '不合适情境 → 不打扰');
}

console.log('cross-region deliver + interruptibility: OK');
