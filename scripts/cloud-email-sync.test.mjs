/**
 * 行为契约:邮件全文逐封记录级同步(workshop 全数据云端化 · 换端补齐邮件正文)。
 * 锁死:
 *  - push 逐封一行,module_key 前缀 `email-body:<id>`、gz-b64 压缩块;已推的不重推(增量)。
 *  - pull 用 keyPrefix=email-body: 只取邮件行;**并集合并**只补本机没有的封(不覆盖已有),
 *    落地经 putEmailBodies 并即刻喂 indexEmailBodies(拉回即可搜,无需 reload)。
 *  - Gmail id 字符集守卫:越界 id 不同步。
 * 用真 fflate;local-email-body / email-fulltext-index / fetch / localStorage 走注入桩。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';

const src = fs.readFileSync(new URL('../lib/portal/cloud-email-sync.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx({ lsInit = {}, localBodies = {}, fetchImpl } = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  let lastPost = null;
  let lastGetUrl = null;
  let putCaptured = null;
  let indexedCaptured = null;
  const ctx = {
    module: { exports: {} }, exports: {}, console,
    Date, Math, JSON, btoa, atob, String, Uint8Array, Array, Object, Number, encodeURIComponent,
    window: {},
    localStorage,
    fetch: async (url, init) => fetchImpl(url, init, { post: (b) => { lastPost = b; }, get: (u) => { lastGetUrl = u; } }),
    require: (p) => {
      if (p === 'fflate') return fflate;
      if (p === './local-email-body') return {
        getAllEmailBodies: async () => ({ ...localBodies }),
        putEmailBodies: async (map) => { putCaptured = { ...(putCaptured || {}), ...map }; },
      };
      if (p === './email-fulltext-index') return { indexEmailBodies: (map) => { indexedCaptured = { ...(indexedCaptured || {}), ...map }; } };
      if (p === './storage-health') return { logDropped: () => {} };
      return {};
    },
    _lastPost: () => lastPost,
    _lastGetUrl: () => lastGetUrl,
    _put: () => putCaptured,
    _indexed: () => indexedCaptured,
    _lsMap: lsMap,
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return { mod: ctx.module.exports, ctx, lsMap };
}

// helper:构造云端一行(gz-b64 压缩正文)
function cloudRow(emailId, body) {
  const gz = fflate.gzipSync(fflate.strToU8(body));
  let bin = '';
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return { moduleKey: 'email-body:' + emailId, data: { gz: Buffer.from(bin, 'binary').toString('base64') } };
}

// 1. push:逐封行(email-body: 前缀 + gz 压缩块)、增量不重推
{
  const okPost = async (url, init, cap) => {
    if (url === '/api/cloud/module-data' && init?.method === 'POST') { cap.post(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, savedCount: 2 }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({
    localBodies: { '18c1aa': '发票请查收,金额 200 元。', '18c2bb': 'Meeting moved to Friday 3pm.' },
    fetchImpl: okPost,
  });
  const r = await mod.pushEmailBodiesToCloud();
  assert.equal(r.pushed, 2, '两封都推');
  const posted = ctx._lastPost();
  const keys = posted.modules.map((m) => m.moduleKey).sort();
  assert.deepEqual(keys, ['email-body:18c1aa', 'email-body:18c2bb'], '每封一行,module_key 带 email-body: 前缀');
  assert.ok(posted.modules.every((m) => typeof m.data.gz === 'string' && m.data.gz.length > 0), '每封存 gz-b64 压缩块');

  // 再推:内容未变 → 0(增量)
  const r2 = await mod.pushEmailBodiesToCloud();
  assert.equal(r2.pushed, 0, '已推的不重推');
}

// 2. pull:keyPrefix 取邮件行、并集补缺、落地 putEmailBodies + 喂 indexEmailBodies
{
  const rows = [cloudRow('18c1aa', '云端邮件正文 A'), cloudRow('18c2bb', 'Cloud email body B')];
  const fetchImpl = async (url, init, cap) => {
    cap.get(url);
    if (typeof url === 'string' && url.startsWith('/api/cloud/module-data')) return { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // 本机已有 18c1aa(不覆盖),缺 18c2bb(补)
  const { mod, ctx } = makeCtx({ localBodies: { '18c1aa': '本机已有的正文 A' }, fetchImpl });
  const r = await mod.pullEmailBodiesFromCloud();
  assert.ok(ctx._lastGetUrl().includes('keyPrefix=email-body%3A'), 'GET 用 keyPrefix=email-body: 只取邮件行');
  assert.equal(r.applied, 1, '只补本机没有的 1 封(并集,不覆盖已有)');
  const put = ctx._put();
  assert.deepEqual(Object.keys(put), ['18c2bb'], '只 put 缺的那封');
  assert.equal(put['18c2bb'], 'Cloud email body B', '解压还原正文并落地本机 IDB');
  const indexed = ctx._indexed();
  assert.deepEqual(Object.keys(indexed), ['18c2bb'], '补齐的邮件即刻喂全文索引(无需 reload)');
}

// 3. id 字符集守卫:越界 id 不同步(防注入/越界 module_key)
{
  const okPost = async (url, init, cap) => { if (init?.method === 'POST') { cap.post(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; } return { ok: false, status: 404, json: async () => ({}) }; };
  const { mod, ctx } = makeCtx({ localBodies: { 'bad id/with:colon': 'x', 'good18c3': '正常正文' }, fetchImpl: okPost });
  const r = await mod.pushEmailBodiesToCloud();
  assert.equal(r.pushed, 1, '只推合法 id 那封');
  assert.deepEqual(ctx._lastPost().modules.map((m) => m.moduleKey), ['email-body:good18c3'], '越界 id 被跳过');
}

console.log('cloud-email-sync: OK');
