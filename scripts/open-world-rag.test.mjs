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

// ② VoiceInputSheet 侧:已登录走云端回溯,未登录纯本地
const sheet = read('../components/portal/VoiceInputSheet.tsx');
assert.match(
  sheet,
  /canUsePrivateData[\s\S]{0,80}searchSignalsWithCloudFallback\(t,\s*30\)[\s\S]{0,60}searchSignalsSemantically\(t,\s*20\)/,
  '问一问:已登录经云端 RAG 回溯,未登录纯本地语义(不外发私有查询)',
);

console.log('open-world-rag: OK');
