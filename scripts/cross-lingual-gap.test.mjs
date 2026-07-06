/**
 * 行为契约:跨语言检索缺口的诚实提示(可见失败纪律)。
 *
 * 修「AI 界面缺可见失败纪律 —— 没有 GEMINI_API_KEY 时语义重排静默退回文本序,
 * 中文问句召回不到英文记忆,聊天却像全都搜过了一样作答」。
 */
import assert from 'node:assert/strict';
import { dominantScript, detectCrossLingualGap } from '../lib/portal/cross-lingual-gap.mjs';

// ── dominantScript ───────────────────────────────────────────────────────────
assert.equal(dominantScript('我的会议'), 'han');
assert.equal(dominantScript('Team Meeting'), 'latin');
assert.equal(dominantScript('我的会议记录 note'), 'han', '汉字多(6 vs 4)→ han。');
assert.equal(dominantScript('meeting 会'), 'latin', '拉丁多 → latin。');
assert.equal(dominantScript('12:30 —— !!!'), 'none', '无字母/汉字 → none。');
assert.equal(dominantScript(''), 'none');

// ── 缺口:中文问句 + 无向量 + 库里有一批英文笔记 → 诚实提示 ────────────────────
{
  const corpus = ['Team standup', 'Design review', 'Sprint planning', 'Q3 roadmap', '买菜'];
  const r = detectCrossLingualGap({ query: '我的会议安排', corpusTexts: corpus, embeddingsApplied: false });
  assert.equal(r.gap, true, '中文问、英文库、无向量 → 有跨语言缺口,应提示。');
  assert.equal(r.queryLang, 'han');
  assert.ok(r.otherCount >= 4);
}

// ── 向量生效 → 不提示(语义有机会跨语言,不再是纯文本召回) ─────────────────────
{
  const corpus = ['Team standup', 'Design review', 'Sprint planning', 'Q3 roadmap'];
  const r = detectCrossLingualGap({ query: '我的会议安排', corpusTexts: corpus, embeddingsApplied: true });
  assert.equal(r.gap, false, 'embeddings 生效 → 不算退化,不提示。');
}

// ── 同语言库 → 无缺口(不该无端提示) ──────────────────────────────────────────
{
  const corpus = ['团队站会', '设计评审', '冲刺规划', '买菜', '还信用卡'];
  const r = detectCrossLingualGap({ query: '我的会议安排', corpusTexts: corpus, embeddingsApplied: false });
  assert.equal(r.gap, false, '库全是中文 → 中文问句没有跨语言缺口。');
}

// ── 另一种语言太少(低于阈值) → 不提示,避免噪音 ────────────────────────────────
{
  const corpus = ['买菜', '还信用卡', '看牙医', '交房租', '生日', 'gym'];
  const r = detectCrossLingualGap({ query: '我的安排', corpusTexts: corpus, embeddingsApplied: false });
  assert.equal(r.gap, false, '只有 1 条英文(< minCount=3)→ 不提示。');
}

// ── 反向:英文问句 + 中文库 ────────────────────────────────────────────────────
{
  const corpus = ['团队站会', '设计评审', '冲刺规划', '产品路线图'];
  const r = detectCrossLingualGap({ query: 'my meetings this week', corpusTexts: corpus, embeddingsApplied: false });
  assert.equal(r.gap, true, '英文问、中文库、无向量 → 也有缺口。');
  assert.equal(r.queryLang, 'latin');
}

// ── 无主导语言的问句(纯数字/符号) → 不提示 ──────────────────────────────────
{
  const r = detectCrossLingualGap({ query: '2026?', corpusTexts: ['Meeting', '会议'], embeddingsApplied: false });
  assert.equal(r.gap, false);
}

console.log('cross-lingual-gap: OK');
