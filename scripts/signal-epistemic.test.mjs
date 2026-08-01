/**
 * 行为契约:Signal 可信度分层(学 claude-obsidian 哲学 · 不引库)。
 * 锁死:
 *  1) epistemic 六档 + GROUND 三档;缺省可从 type/source/kind 推断;
 *  2) createSignal 写入门盖章 epistemic/generator/derivedFrom;
 *  3) growth.reflection = user_asserted; feedback.* = feedback;
 *  4) 检索默认 isGroundFact(派生/汇总/反馈不答问);
 *  5) 镜像信 / 日报落库带 derived|system_summary。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console,
    Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp, Math,
  });
  return mod.exports;
}

const epi = loadTs('../lib/life-domain/signal-epistemic.ts', () => ({}));
// 2026-08-01 Domains 三合一:inferSensitivity 新增调用 classifyDomainFromText,空桩会让
// createSignal 假抛错,接真实现(纯函数,无副作用依赖)。
const contextExtractor = loadTs('../lib/life-domain/context-extractor.ts', () => ({}));

assert.equal(epi.inferEpistemic({ type: 'feedback.retrieval' }), 'feedback');
assert.equal(epi.inferEpistemic({ type: 'growth.reflection' }), 'user_asserted');
assert.equal(epi.inferEpistemic({ kind: 'mirror-letter' }), 'derived');
assert.equal(epi.inferEpistemic({ kind: 'daily-report' }), 'system_summary');
assert.equal(epi.inferEpistemic({ source: 'photo', confidence: 0.7 }), 'extraction');
assert.equal(epi.inferEpistemic({ source: 'gmail', type: 'email' }), 'observation');
assert.equal(epi.isGroundFact({ type: 'note', source: 'Entry', confidence: 1 }), true);
assert.equal(epi.isGroundFact({ type: 'feedback.today_card', source: 'Entry', confidence: 1 }), false);
assert.equal(epi.isGroundFact({ type: 'event', source: 'device', confidence: 1, payload: { kind: 'mirror-letter', epistemic: 'derived' } }), false);
assert.equal(epi.isGroundFact({ type: 'growth.reflection', source: 'Entry', confidence: 1 }), true, '用户回看是地面断言');

const stamp = epi.stampEpistemic({
  type: 'growth.reflection',
  source: 'Entry',
  derivedFrom: ['c1'],
  generator: 'user',
});
assert.equal(stamp.epistemic, 'user_asserted');
assert.deepEqual(stamp.derivedFrom, ['c1']);

// createSignal 盖章
const nodes = [];
const create = loadTs('../lib/life-domain/create-signal.ts', (p) => {
  if (p.includes('life-graph')) {
    return {
      addLifeNode: (input) => {
        const n = { id: `n${nodes.length + 1}`, createdAt: '2026-07-17T12:00:00.000Z', ...input };
        nodes.push(n);
        return n;
      },
    };
  }
  if (p.includes('signal-store-idb')) return { appendSignalIdb: async () => true };
  if (p.includes('storage-health')) return { logDropped: () => {} };
  if (p.includes('signal-epistemic')) return epi;
  if (p.includes('context-extractor')) return contextExtractor;
  if (p.includes('./signal') || p.endsWith('/signal')) {
    return loadTs('../lib/life-domain/signal.ts', (p2) => {
      if (p2.includes('life-graph')) return { getLifeGraph: () => [], deleteLifeNode: () => {} };
      if (p2.includes('signal-read-cache')) return { getCachedSignals: () => null };
      if (p2.includes('signal-epistemic')) return epi;
      if (p2.includes('./context')) return {};
      return {};
    });
  }
  if (p.includes('./context')) return {};
  return {};
});

const growth = create.createSignal({
  source: 'Entry',
  type: 'growth.reflection',
  title: '成长回看',
  payload: { answer: '还想做' },
  epistemic: 'user_asserted',
  generator: 'user',
  derivedFrom: ['c1'],
});
assert.equal(growth.epistemic, 'user_asserted');
assert.equal(growth.generator, 'user');
assert.deepEqual(growth.derivedFrom, ['c1']);
assert.ok(nodes[0].attributes.epistemic === 'user_asserted');
assert.ok(String(nodes[0].attributes.derivedFrom).includes('c1'));

// 源码接线
const search = fs.readFileSync(new URL('../lib/life-domain/signal-search.ts', import.meta.url), 'utf8');
assert.match(search, /isGroundFact\(signal\)/, '检索走地面事实滤层');

const growthSrc = fs.readFileSync(new URL('../lib/portal/growth-guide.ts', import.meta.url), 'utf8');
assert.match(growthSrc, /epistemic:\s*'user_asserted'/, '成长回答标 user_asserted');
assert.match(growthSrc, /source:\s*'Entry'/, '成长回答不再滥用 ai_observation');

const mirror = fs.readFileSync(new URL('../lib/portal/mirror-letter-persist.ts', import.meta.url), 'utf8');
assert.match(mirror, /epistemic:\s*'derived'/, '镜像信标 derived');

const daily = fs.readFileSync(new URL('../lib/portal/daily-report-persist.ts', import.meta.url), 'utf8');
assert.match(daily, /epistemic:\s*'system_summary'/, '日报标 system_summary');

const feedback = fs.readFileSync(new URL('../lib/life-domain/signal-feedback.ts', import.meta.url), 'utf8');
assert.match(feedback, /epistemic:\s*'feedback'/, '今日卡反馈标 feedback');

// derived / system_summary 缺 derivedFrom → 弱标
const weak = epi.stampEpistemic({ type: 'event', source: 'ai_observation', epistemic: 'derived' });
assert.equal(epi.hasWeakEvidenceChain(weak), true, 'derived 无 derivedFrom = 弱证据链');
const strong = epi.stampEpistemic({ type: 'event', source: 'ai_observation', epistemic: 'derived', derivedFrom: ['s1'] });
assert.equal(epi.hasWeakEvidenceChain(strong), false, '挂了 derivedFrom 则不弱');

const reason = fs.readFileSync(new URL('../lib/portal/reasoning-engine.ts', import.meta.url), 'utf8');
assert.doesNotMatch(reason, /localStorage\.setItem\(\s*FEEDBACK_KEY|localStorage\.setItem\(\s*'nesio-card-feedback/, '不再写 card-feedback LS 双轨');
assert.match(reason, /readFeedbackLog|emitFeedback/, 'DEC 反馈改读 Signal / 总线');
assert.match(reason, /删.*nesio-card-feedback-v1|不再写.*nesio-card-feedback/, '注释标明双轨已删');

const cmds = fs.readFileSync(new URL('../lib/platform/view-models/today-commands.ts', import.meta.url), 'utf8');
assert.doesNotMatch(cmds, /reaction:\s*'useful'/, 'pin/add 不再冒充 useful');

console.log('signal-epistemic contract tests passed');
