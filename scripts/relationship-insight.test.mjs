/**
 * 行为契约:人缘域接进智能后台(L2 判定 → 脊柱 → Today guidance)。
 * 锁死:relationshipFindings 从联系人快照推出「该联系了(重点家人/亲近)」与「生日临近」,
 * 人际域从严(只 attention、绝不 flag、泛泛之交不催);并已并入 computeDomainFindings 脊柱、
 * 有 relationshipFindingsToGuidanceEvents 适配器、且在 Today 主循环里 spread(源码级)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function run(js, requireShim) {
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Map, Set, RegExp,
    window: undefined, require: requireShim,
  });
  return mod.exports;
}

// ── 编译依赖链:domain-rules → relationships → relationship-insight ──
const storageHealth = { reportStorageDropped() {} };
const domainRules = run(compile('../lib/portal/domain-rules.ts'), () => ({}));
const relationships = run(compile('../lib/portal/relationships.ts'), (p) => (p.includes('storage-health') ? storageHealth : {}));
const personRecords = run(compile('../lib/portal/person-records.ts'), (p) => (p.includes('storage-health') ? storageHealth : {}));
const relInsight = run(compile('../lib/portal/relationship-insight.ts'), (p) => {
  if (p.endsWith('domain-rules')) return domainRules;
  if (p.endsWith('person-records')) return personRecords;
  if (p.endsWith('relationships')) return relationships;
  return {};
});
const { relationshipFindings } = relInsight;
assert.equal(typeof relationshipFindings, 'function', 'relationshipFindings 导出');

const now = new Date(Date.parse('2026-07-08T00:00:00Z'));

// ── 该联系了 + 生日临近:重点家人(核心)命中;泛泛之交(acquaintance)不催 ──
{
  const nodes = [
    // 妹妹「小美」:一条 37 天前的记忆定义了家人关系 → core;超过 14 天节奏 → 该联系
    { id: 'n1', type: 'note', name: '和 小美 吃饭', source: 'manual', createdAt: '2026-06-01T00:00:00Z', attributes: {}, relations: [{ targetId: '小美', relation: '妹妹' }] },
    // 小美的 person 节点带生日(07-12,距 07-08 四天)
    { id: 'p1', type: 'person', name: '小美', source: 'system', createdAt: '2026-06-01T00:00:00Z', attributes: { birthday: '--07-12' }, relations: [] },
    // 泛泛之交 Bob:很久没联系,但不是核心/亲近 → 不该被催
    { id: 'p2', type: 'person', name: 'Bob', source: 'system', createdAt: '2020-01-01T00:00:00Z', attributes: {}, relations: [] },
  ];
  const findings = relationshipFindings({ nodes, now, contactLog: {} });
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));

  assert.ok(byId['reach-out-core'], '重点家人超期 → reach-out-core finding');
  assert.equal(byId['reach-out-core'].severity, 'attention', '人际域只出 attention');
  assert.ok(byId['reach-out-core'].detail[0].includes('小美'), 'reach-out 点名重点的人');
  assert.ok(!findings.some((f) => f.detail[0].includes('Bob')), '泛泛之交不进催促');

  assert.ok(byId['birthday-soon'], '重点的人 7 天内生日 → birthday-soon finding');
  assert.ok(byId['birthday-soon'].title[0].includes('小美'), '生日 finding 标题点名');
  assert.ok(byId['birthday-soon'].detail[0].includes('07-12'), '生日 finding 带日期');

  // 人际域从严:绝不出红
  assert.ok(findings.every((f) => f.severity !== 'flag'), '人缘域绝不出 flag');
}

// ── 边界:无节点沉默;生日太远不提示 ──
assert.equal(relationshipFindings({ nodes: [], now, contactLog: {} }).length, 0, '无联系人 → 沉默');
{
  const far = [
    { id: 'n1', type: 'note', name: '和 小美', source: 'manual', createdAt: '2026-07-07T00:00:00Z', attributes: {}, relations: [{ targetId: '小美', relation: '妹妹' }] },
    { id: 'p1', type: 'person', name: '小美', source: 'system', createdAt: '2026-07-07T00:00:00Z', attributes: { birthday: '--09-30' }, relations: [] },
  ];
  const f = relationshipFindings({ nodes: far, now, contactLog: {} });
  assert.ok(!f.some((x) => x.id === 'birthday-soon'), '生日在 7 天窗口外不提示');
  // 刚联系过(昨天),节奏内 → 不催
  assert.ok(!f.some((x) => x.id === 'reach-out-core'), '刚联系过不催');
}

// ── 好数据接进洞察:成绩/消费(非敏感)出 finding;医疗(敏感)绝不出(隐私红线) ──
{
  const nodes = [
    { id: 'n1', type: 'note', name: '和 小美 吃饭', source: 'manual', createdAt: '2026-06-01', attributes: {}, relations: [{ targetId: '小美', relation: '妹妹' }] },
    { id: 'p1', type: 'person', name: '小美', source: 'system', createdAt: '2026-06-01', attributes: {}, relations: [] },
  ];
  const records = [
    { id: 'r1', personKey: '小美', category: 'achievement', title: '期末年级第一', date: '2026-07-02', createdAt: '2026-07-02' },
    { id: 'r2', personKey: '小美', category: 'spending', title: '生日礼物', amount: 600, date: '2026-07-05', createdAt: '2026-07-05' },
    { id: 'r3', personKey: '小美', category: 'medical', title: '复诊记录', date: '2026-07-03', createdAt: '2026-07-03' },
  ];
  const f = relationshipFindings({ nodes, now, records, contactLog: {} });
  const byId = Object.fromEntries(f.map((x) => [x.id, x]));
  assert.ok(byId['person-achievement'], '成绩(非敏感)出洞察');
  assert.ok(byId['person-achievement'].detail[0].includes('期末年级第一'), '成绩点名内容');
  assert.ok(byId['family-spending-month'], '本月家人消费出洞察');
  assert.ok(byId['family-spending-month'].detail[0].includes('600'), '消费合计');
  // 隐私红线:医疗/复诊绝不出现在任何 finding
  assert.ok(!f.some((x) => x.title.concat(x.detail).some((s) => s.includes('复诊') || s.includes('医疗'))), '医疗类不进通用 Today(留健康视图)');
  assert.ok(f.every((x) => x.severity !== 'flag'), '仍只出 attention');
}

// ── 药物 → Today 用药提醒(2026-07「全放开」:药物可进提醒;医疗仍不进通用 Today) ──
{
  const nodes = [
    { id: 'n1', type: 'note', name: '和 爸爸', source: 'manual', createdAt: '2026-06-01', attributes: {}, relations: [{ targetId: '爸爸', relation: '爸爸' }] },
    { id: 'p1', type: 'person', name: '爸爸', source: 'system', createdAt: '2026-06-01', attributes: {}, relations: [] },
  ];
  const records = [
    { id: 'm1', personKey: '爸爸', category: 'medication', title: '氨氯地平', detail: '每天一片', date: '2026-07-01', createdAt: '2026-07-01' },
    { id: 'md1', personKey: '爸爸', category: 'medical', title: '复诊记录', date: '2026-07-03', createdAt: '2026-07-03' },
  ];
  const f = relationshipFindings({ nodes, now, records, contactLog: {} });
  const byId = Object.fromEntries(f.map((x) => [x.id, x]));
  assert.ok(byId['medication-reminder'], '药物 → 用药提醒进 Today');
  assert.ok(byId['medication-reminder'].detail[0].includes('氨氯地平') && byId['medication-reminder'].detail[0].includes('每天一片'), '点名药 + 剂量');
  assert.equal(byId['medication-reminder'].severity, 'attention', '用药提醒仍只 attention');
  assert.ok(!f.some((x) => x.title.concat(x.detail).some((s) => s.includes('复诊'))), '医疗记录不进通用 Today');
}

// 成绩太旧(>45 天)不提示
{
  const nodes = [{ id: 'p1', type: 'person', name: 'A', source: 'system', createdAt: '2026-01-01', attributes: { email: 'a@x.com' }, relations: [] }];
  const old = [{ id: 'r', personKey: 'a', category: 'achievement', title: '旧事', date: '2026-01-01', createdAt: '2026-01-01' }];
  const f = relationshipFindings({ nodes, now, records: old, contactLog: {} });
  assert.ok(!f.some((x) => x.id === 'person-achievement'), '成绩超回看窗口不提示');
}

// ── 脊柱接线(源码级):computeDomainFindings 含人缘域 ──
const di = fs.readFileSync(new URL('../lib/portal/domain-insights.ts', import.meta.url), 'utf8');
assert.ok(/InsightDomain =[^;]*'relationship'/.test(di), 'InsightDomain 含 relationship');
assert.ok(di.includes('relationship: RelationshipFinding[]'), 'DomainFindingSet 含 relationship');
assert.ok(di.includes('relationshipFindings({ nodes: getLifeGraph()'), 'computeDomainFindings 跑人缘引擎');
assert.ok(di.includes("relationship: '人缘'"), 'gatherDomainInsights 标签含人缘');

// ── guidance 适配器 + Today 主循环 spread ──
const sa = fs.readFileSync(new URL('../lib/platform/guidance-engine/source-adapters.ts', import.meta.url), 'utf8');
assert.ok(sa.includes('export function relationshipFindingsToGuidanceEvents'), '人缘 guidance 适配器存在');
assert.ok(sa.includes("insightsToGuidanceEvents('relationship'"), '适配器接通用脊柱(domain=relationship)');

const td = fs.readFileSync(new URL('../components/portal/today/useTodayData.ts', import.meta.url), 'utf8');
assert.ok(td.includes('relationshipFindingsToGuidanceEvents(df.relationship)'), 'Today 主循环 spread 人缘洞察');

console.log('relationship-insight: OK');
