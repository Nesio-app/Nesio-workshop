/**
 * 行为契约:开放世界 Layer ②(RAG 回溯 · 深问回捞更早/别端事实)。
 * 本地事实缓存只是全量图谱的近端切片;已登录用户的「问一问」深问必须先经云端 RAG
 * (pgvector/文本)回捞更早、别端只落云的事实,再与本地并轨 —— 否则问一问只能答近端。
 * 锁死:
 *  1) signal-search 暴露 searchSignalsWithCloudFallback(先本地、云端命中并轨、失败回退纯本地)。
 *  2) VoiceInputSheet 的「问一问」:已登录走云端回溯,未登录走纯本地语义(不外发)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ① signal-search 侧:云端回溯并轨,失败纯本地兜底
const search = read('../lib/life-domain/signal-search.ts');
assert.match(
  search,
  /export async function searchSignalsWithCloudFallback/,
  'signal-search 暴露 searchSignalsWithCloudFallback',
);
assert.match(search, /\/api\/cloud\/signals/, '云端回溯打 /api/cloud/signals(pgvector/文本 RAG)');
assert.match(search, /signal_vector_pgvector/, '识别 pgvector 向量检索模式');
assert.match(
  search,
  /catch\s*(\([^)]*\))?\s*\{\s*return\s+localMatches/,
  '云端不可达时回退纯本地(best-effort,深问不因云抖动失灵)',
);

// ② 取材层:已登录走云端回溯,未登录纯本地
//
// 2026-07-31 搬家。这段判断原来长在 VoiceInputSheet 的 ask 形态里,而所有「问念念」
// 入口已经切到真对话页(NesioChatSheet)——**再压那一屏就是在保护一段没人走的路**。
// 现在收在 lib/portal/ask-retrieval.ts,两边共用一份。
const retrieval = read('../lib/portal/ask-retrieval.ts');
assert.match(
  retrieval,
  /canUsePrivateData[\s\S]{0,120}searchSignalsWithCloudFallback\(text,\s*30\)[\s\S]{0,80}searchSignalsSemantically\(text,\s*20\)/,
  '问一问:已登录经云端 RAG 回溯,未登录纯本地语义(不外发私有查询)',
);
// 隐私红线要**逐层**过,不能只在最后拼字符串时才想起来。
assert.match(
  retrieval,
  /const allowed = \(n: LifeNode\) => canUsePrivateData \|\| !isPrivateExternalNode\(n\)/,
  '未登录/未知态不许把邮件主题、日程标题带进候选',
);
assert.ok(
  (retrieval.match(/\.filter\(allowed\)/g) || []).length >= 3,
  '语义 / 模糊 / 近期三路都要过隐私过滤 —— 漏一路就是从那一路漏出去',
);

// ③ 真正在用的那一屏必须真的用上它。
//
// 这一条是这次改动里**最容易悄悄退化**的地方:入口切到对话页很显眼,
// 而「对话页的检索比原来那屏弱一档」没有任何症状 —— 用户只会觉得念念变笨了,
// 几周后才可能说出来。所以钉死:对话页取材走 retrieveForAsk,不许退回纯字面模糊。
const chat = read('../components/portal/NesioChatSheet.tsx');
assert.match(
  chat,
  /await retrieveForAsk\(text\.trim\(\), \{ canUsePrivateData, limit: 6 \}\)/,
  '对话页的本机记忆搜索要走 retrieveForAsk(语义 + 云端回溯),不是纯字面模糊',
);
assert.match(
  chat,
  /await retrieveForAsk\(text\.trim\(\), \{ canUsePrivateData, limit: 5 \}\)/,
  'AI 挂掉时的兜底同样要走它 —— 那一刻恰恰最需要检索给力',
);
assert.doesNotMatch(
  chat,
  /searchLifeGraphFuzzy/,
  '对话页不许再直接调纯字面模糊 —— 两套取材迟早漂移,而漂移的那一侧是用户看不见的',
);

console.log('open-world-rag: OK(取材层收口 · 隐私逐层过 · 对话页真的用上了)');
