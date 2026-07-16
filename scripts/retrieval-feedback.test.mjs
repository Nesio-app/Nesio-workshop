/**
 * 行为契约:开放世界 ④(用户自学 · 检索反馈闭环)。
 * 锁死:
 *  1) markRetrievalFeedback 落成一等公民 Signal(type feedback.retrieval,payload={targetId,verdict})
 *     —— 跨端同步、可导出/删除(数据主权),非某设备本地一次性状态。空 targetId 跳过。
 *  2) retrievalScoreAdjust:not_this → 强负(剔除),useful → 轻正,无反馈 → 0。
 *  3) isDownranked:not_this 目标为真。最新裁决覆盖旧裁决(用户可改主意)。
 *  4) signal-search 接线:反馈参与排序 + not_this 剔除 + feedback.* 不作为检索结果;
 *     云端回捞候选同样过剔除。VoiceInputSheet 提供「不是这个」入口。
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
    Array, Object, JSON, Map, Set, String, Number, Boolean, Date,
  });
  return mod.exports;
}

// ── stub 事实存储:createSignal 写入,getSignals 按 type 读回(镜像真实读写) ──
const store = [];
let seq = 0;
const rf = loadTs('../lib/life-domain/retrieval-feedback.ts', (p) =>
  p.includes('create-signal')
    ? { createSignal: (input) => { const sig = { id: `fb${seq++}`, source: input.source, type: input.type, payload: input.payload, evidence: {} }; store.unshift(sig); return sig; } }
  : p.endsWith('/signal') || p.includes('./signal')
    ? { getSignals: (opts) => store.filter((s) => !opts?.types?.length || opts.types.includes(s.type)) }
  : ({}));

// ① 无反馈 → 0 / 不降权
assert.equal(rf.retrievalScoreAdjust('t1'), 0, '无反馈 → 调整量 0');
assert.equal(rf.isDownranked('t1'), false, '无反馈 → 不降权');

// ② not_this 落成 Signal + 强负 + 降权
rf.markRetrievalFeedback('t1', 'not_this');
assert.equal(store.length, 1, 'markRetrievalFeedback 写入一条 Signal');
assert.equal(store[0].type, 'feedback.retrieval', 'type=feedback.retrieval(一等公民事实)');
assert.equal(store[0].payload.targetId, 't1', 'payload.targetId 记录目标');
assert.equal(store[0].payload.verdict, 'not_this', 'payload.verdict 记录裁决');
assert.equal(store[0].source, 'ai_observation', 'source=ai_observation');
assert.equal(rf.isDownranked('t1'), true, 'not_this → 降权(剔除)');
assert.equal(rf.retrievalScoreAdjust('t1'), -100, 'not_this → 强负(盖过相关性,等同剔除)');

// ③ useful → 轻正,不降权
rf.markRetrievalFeedback('t2', 'useful');
assert.equal(rf.retrievalScoreAdjust('t2'), 2, 'useful → 轻正');
assert.equal(rf.isDownranked('t2'), false, 'useful → 不降权');

// ④ 最新裁决覆盖旧裁决(用户改主意:t1 从 not_this → useful)
rf.markRetrievalFeedback('t1', 'useful');
assert.equal(rf.isDownranked('t1'), false, '最新 useful 覆盖旧 not_this → 不再降权');
assert.equal(rf.retrievalScoreAdjust('t1'), 2, '最新裁决生效');

// ⑤ 空 targetId 跳过(不污染事实表)
const before = store.length;
rf.markRetrievalFeedback('', 'not_this');
assert.equal(store.length, before, '空 targetId → 不写入');

// ── 源码级接线契约 ──
const search = fs.readFileSync(new URL('../lib/life-domain/signal-search.ts', import.meta.url), 'utf8');
assert.match(search, /retrievalScoreAdjust\(retrievalKey\(signal\)\)/, 'scoreSignalForQuery 计入检索反馈调整');
assert.match(search, /!isDownranked\(retrievalKey\(entry\.signal\)\)/, '本地检索剔除 not_this 目标');
assert.match(search, /!String\(signal\.type\)\.startsWith\('feedback'\)/, 'feedback.* 不作为检索结果被答出去');
assert.match(search, /cloudSignalRowsToSignals\([\s\S]*?\)\.filter\(\s*\([^)]*\)\s*=>\s*!isDownranked\(retrievalKey/, '云端回捞候选同样剔除 not_this');

const sheet = fs.readFileSync(new URL('../components/portal/VoiceInputSheet.tsx', import.meta.url), 'utf8');
assert.match(sheet, /markRetrievalFeedback\(node\.id,\s*'not_this'\)/, 'VoiceInputSheet 提供「不是这个」入口');
assert.match(sheet, /setAskResults\(\(prev\) => prev\.filter\(\(n\) => n\.id !== node\.id\)\)/, '「不是这个」就地从来源移除');

const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
assert.match(css, /\.nesio-ask-citation-dismiss/, '剔除按钮有样式');
assert.match(css, /var\(--status-risk\)/, '剔除按钮用设计系统 risk token(非硬编码)');

console.log('retrieval-feedback: OK');
