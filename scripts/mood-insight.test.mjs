/**
 * 行为契约:心情洞察(Layer1 铺开·心情域,CUSUM 判定层)。
 * 真 mood-insight + 真 moment-analytics(CUSUM)+ 真 domain-rules。锁死:
 *   持续低落触发、偶尔低落不触发(CUSUM 的本职:区分"今天不爽"和"一直往下");
 *   记录太少/未跨天 沉默;陈年警报不翻旧账;只出 attention(情绪域从严)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, requireImpl) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, Math, Number, Array, Date, Set, Map, console });
  return mod.exports;
}
const domainRules = loadTs('../lib/portal/domain-rules.ts', () => ({}));
const moment = loadTs('../lib/portal/learning/moment-analytics.ts', () => ({}));
const mood = loadTs('../lib/portal/mood-insight.ts', (p) =>
  p === './domain-rules' ? domainRules : p === './moment-analytics' ? moment : ({}));

const NOW = new Date('2026-07-01T20:00:00.000Z');
const daysAgo = (d, h = 9) => new Date(NOW.getTime() - d * 86_400_000 + (h - 9) * 3_600_000).toISOString();
const momentNode = (emotion, d, h = 9) => ({
  attributes: { emotion, recordedAt: daysAgo(d, h) },
  tags: ['moment', 'feeling'],
  createdAt: daysAgo(d, h),
});

// 1. 持续低落(近两周 18 条负面,CUSUM 累积过线且警报落在最近 3 天)→ 触发,attention
// 注:CUSUM 常数(threshold 4 / slack 0.5)是算法库的发表口径,触发需 ~16+ 条持续负面 ——
// 这正是"区分今天不爽和一直往下"的本意,测试数据按真实持续低落构造,不调常数迁就测试。
{
  const nodes = [];
  for (let i = 0; i < 18; i++) {
    nodes.push(momentNode(i % 2 === 0 ? 'empty' : 'sad', 12 - Math.floor(i * 0.7), 9 + (i % 3)));
  }
  const out = mood.moodFindings({ nodes, now: NOW });
  const f = out.find((x) => x.id === 'mood-drift-cusum');
  assert.ok(f, '持续低落 → 触发');
  assert.equal(f.severity, 'attention', '情绪域只出 attention,绝不出红');
  assert.match(f.detail[0], /非 AI、非诊断/, '判定方法透明 + 不下诊断');
}

// 2. 偶尔低落夹在正面里 → 不触发(CUSUM 区分波动与趋势)
{
  const nodes = [];
  const mixed = ['joy', 'sad', 'content', 'calm', 'sad', 'joy', 'grateful', 'excited'];
  mixed.forEach((e, i) => nodes.push(momentNode(e, 7 - i, 9 + (i % 3))));
  assert.equal(mood.moodFindings({ nodes, now: NOW }).length, 0, '偶尔低落不报(不制造焦虑)');
}

// 3. 记录太少(4 条)→ 沉默;单日密集低落(未跨 3 天)→ 沉默
{
  const few = ['sad', 'sad', 'empty', 'sad'].map((e, i) => momentNode(e, 5 - i));
  assert.equal(mood.moodFindings({ nodes: few, now: NOW }).length, 0, '<5 条沉默(不凭几条记录断言)');
  const oneDay = ['sad', 'empty', 'sad', 'anxious', 'sad', 'tired'].map((e, i) => momentNode(e, 1, 8 + i));
  assert.equal(mood.moodFindings({ nodes: oneDay, now: NOW }).length, 0, '未跨 3 天沉默(单日波动≠一阵子)');
}

// 4. 陈年警报:同样强度的持续低落但结束在 6+ 天前、近几天已恢复正面 → 不翻旧账
{
  const nodes = [];
  for (let i = 0; i < 18; i++) {
    nodes.push(momentNode(i % 2 === 0 ? 'empty' : 'sad', 13 - Math.floor(i * 0.45), 9 + (i % 3)));
  }
  ['joy', 'calm', 'content'].forEach((e, i) => nodes.push(momentNode(e, 2 - i)));
  assert.equal(mood.moodFindings({ nodes, now: NOW }).length, 0, '警报不在最近 3 天(且已恢复)→ 沉默');
}

// 5. 空数据 → 空
assert.equal(mood.moodFindings({ nodes: [], now: NOW }).length, 0, '无记录返回空');

console.log('mood-insight: OK');
