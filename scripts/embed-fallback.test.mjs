/**
 * 行为契约:嵌入提供方回退(问一问修复批)。
 * 锁死:无 Gemini key 时 embedTextRaw 走 OpenAI(dimensions=768 同维、model 随结果);
 * 两个 key 都没有 → embedding_key_missing;embed 路由任一 key 即放行且回传 model;
 * 语义缓存带 model 同源校验;聊天问邮件空档时当场触发同步(源码级)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl, ctx = {}) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, JSON, Number, Array, Object, String, Math, ...ctx });
  return mod.exports;
}

// ── embedTextRaw:key 路由 ──
const calls = [];
async function fakeFetch(url, opts) {
  calls.push(url);
  if (url.includes('openai.com')) {
    const body = JSON.parse(opts.body);
    assert.equal(body.dimensions, 768, 'OpenAI 嵌入强制 768 维(与 Gemini 对齐,缓存可比)');
    return { ok: true, json: async () => ({ data: [{ embedding: Array(768).fill(0.1) }] }) };
  }
  if (url.includes('generativelanguage')) {
    return { ok: true, json: async () => ({ embedding: { values: Array(768).fill(0.2) } }) };
  }
  throw new Error(`unexpected ${url}`);
}
function loadEmbedding(env) {
  return loadTs('../lib/life-domain/signal-embedding.ts',
    (p) => (p === '@/lib/portal/ai-keys' ? {
      resolveAiKey: (prov) => env[prov] || '',
    } : ({})),
    { fetch: fakeFetch, process: { env: {} } });
}

// 只有 OpenAI key → 走 OpenAI,model 标记随结果
{
  calls.length = 0;
  const emb = loadEmbedding({ openai: 'sk-x' });
  const r = await emb.embedTextRaw('hello world');
  assert.equal(r.ok, true);
  assert.equal(r.model, 'text-embedding-3-small', '回退 OpenAI 模型');
  assert.equal(r.dimension, 768);
  assert.ok(calls.every((u) => u.includes('openai.com')), '没碰 Gemini');
}
// 有 Gemini key → 仍走 Gemini(行为不变)
{
  calls.length = 0;
  const emb = loadEmbedding({ gemini: 'g-x', openai: 'sk-x' });
  const r = await emb.embedTextRaw('hello world');
  assert.equal(r.ok, true);
  assert.ok(calls.every((u) => u.includes('generativelanguage')), 'Gemini 优先');
}
// 两个都没有 → 明确报缺 key(问一问的琥珀提示据此触发)
{
  const emb = loadEmbedding({});
  const r = await emb.embedTextRaw('hello world');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'embedding_key_missing');
}

// ── 源码级接线 ──
const route = fs.readFileSync(new URL('../app/api/portal/embed/route.ts', import.meta.url), 'utf8');
assert.ok(route.includes("!resolveAiKey('gemini') && !resolveAiKey('openai')"), 'embed 路由任一 key 即放行');
assert.ok(route.includes('vectors, model'), '路由回传嵌入 model 供缓存同源校验');
const rerank = fs.readFileSync(new URL('../lib/portal/semantic-rerank.ts', import.meta.url), 'utf8');
assert.ok(rerank.includes('model?: string'), '向量缓存条目带 model');
assert.ok(rerank.includes("entryModel !== fetched.model"), '换嵌入提供方后旧向量不混算(重嵌入覆盖)');
const chat = fs.readFileSync(new URL('../components/portal/NesioChatSheet.tsx', import.meta.url), 'utf8');
// 批次 176:buildMemoryContext 抽到 lib/portal/memory-retrieval.ts 供问一问 + 每日简报共用。
const retrieval = fs.readFileSync(new URL('../lib/portal/memory-retrieval.ts', import.meta.url), 'utf8');
assert.ok(retrieval.includes('runGmailSync({ force: true })'), '问到邮件但时段为空 → 当场触发同步');
assert.ok(retrieval.includes('15_000'), '同步带兜底超时,不吊死回答');

// ── 问一问琥珀提示分诊(用户实测:key 没变却被提示「缺 AI 配置」)──
// 候选 <3 条(not_needed)不是故障,绝不能触发降级提示;429/502/503 各给准确话术。
assert.ok(rerank.includes("reason: 'not_needed'"), '候选太少 = not_needed,不算降级');
assert.ok(rerank.includes("failure: 'rate_limited'") && rerank.includes("failure: 'no_key'"), '429/503 分诊');
assert.ok(retrieval.includes("reason !== 'not_neede" + "d'"), '语义降级分诊只在真实故障时出现');
assert.ok(chat.includes('rate_limited') && chat.includes('稍后自动恢复'), '限流话术不再冤枉 key');
assert.ok(route.includes("status: 502"), '提供方全军覆没报 502(与缺 key 的 503 可区分)');

console.log('embed-fallback: OK');
