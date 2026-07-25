/**
 * 行为契约:通用逐记录云同步工厂(治「每个功能一套」的单一真源)。
 * 锁死:push 逐记录行 `<prefix><id>` gz 压缩 + 增量;pull 用 keyPrefix 只取本前缀行、并集补缺
 * (本机已有不覆盖)、落地经 config.apply;id 守卫。用真 fflate;fetch/localStorage/storage-health 走桩。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';

const src = fs.readFileSync(new URL('../lib/portal/cloud-record-sync.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx({ lsInit = {}, fetchImpl } = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  let lastPost = null, lastGetUrl = null;
  const ctx = {
    module: { exports: {} }, exports: {}, console,
    Date, Math, JSON, btoa, atob, String, Uint8Array, Array, Object, Number, encodeURIComponent,
    window: { dispatchEvent: () => true }, CustomEvent: class { constructor(t) { this.type = t; } },
    localStorage,
    fetch: async (url, init) => fetchImpl(url, init, { post: (b) => { lastPost = b; }, get: (u) => { lastGetUrl = u; } }),
    require: (p) => {
      if (p === 'fflate') return fflate;
      if (p === './storage-health') return { logDropped: () => {} };
      return {};
    },
    _lastPost: () => lastPost, _lastGetUrl: () => lastGetUrl,
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return { mod: ctx.module.exports, ctx };
}

function cloudRow(prefix, id, val) {
  const gz = fflate.gzipSync(fflate.strToU8(val));
  let bin = '';
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return { moduleKey: prefix + id, data: { gz: Buffer.from(bin, 'binary').toString('base64') } };
}

// 1. push:逐记录行 + 前缀 + gz;增量不重推
{
  const okPost = async (url, init, cap) => {
    if (url === '/api/cloud/module-data' && init?.method === 'POST') { cap.post(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({ fetchImpl: okPost });
  const local = { a1: 'AAA', b2: 'BBB' };
  const sync = mod.createRecordSync({ prefix: 'x-thing:', stateKey: 'st', load: async () => ({ ...local }), apply: async () => {} });
  const r = await sync.push();
  assert.equal(r.pushed, 2, '两条都推');
  assert.deepEqual(ctx._lastPost().modules.map((m) => m.moduleKey).sort(), ['x-thing:a1', 'x-thing:b2'], '每条一行,带前缀');
  const r2 = await sync.push();
  assert.equal(r2.pushed, 0, '内容未变 → 增量不重推');
}

// 2. pull:keyPrefix 只取本前缀、并集补缺(本机已有不覆盖)、落地经 apply
{
  const rows = [cloudRow('x-thing:', 'a1', 'CLOUD_A'), cloudRow('x-thing:', 'z9', 'CLOUD_NEW')];
  const fetchImpl = async (url, init, cap) => {
    cap.get(url);
    if (typeof url === 'string' && url.startsWith('/api/cloud/module-data')) return { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const applied = {};
  const { mod, ctx } = makeCtx({ fetchImpl });
  const sync = mod.createRecordSync({ prefix: 'x-thing:', stateKey: 'st', load: async () => ({ a1: 'LOCAL_A' }), apply: async (recs) => Object.assign(applied, recs) });
  const r = await sync.pull();
  assert.ok(ctx._lastGetUrl().includes('keyPrefix=x-thing%3A'), 'GET 用 keyPrefix 只取本前缀行');
  assert.equal(r.applied, 1, '只补本机没有的 1 条(并集,不覆盖已有)');
  assert.deepEqual(Object.keys(applied), ['z9'], '只 apply 缺的那条');
  assert.equal(applied.z9, 'CLOUD_NEW', '解压还原内容');
}

// 3. id 字符集守卫:越界 id 不同步
{
  const okPost = async (url, init, cap) => { if (init?.method === 'POST') { cap.post(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; } return { ok: false, status: 404, json: async () => ({}) }; };
  const { mod, ctx } = makeCtx({ fetchImpl: okPost });
  const sync = mod.createRecordSync({ prefix: 'x-thing:', stateKey: 'st', load: async () => ({ 'bad id:x': 'v', ok_1: 'v' }), apply: async () => {} });
  const r = await sync.push();
  assert.equal(r.pushed, 1, '只推合法 id');
  assert.deepEqual(ctx._lastPost().modules.map((m) => m.moduleKey), ['x-thing:ok_1'], '越界 id 被跳过');
}

console.log('cloud-record-sync: OK');
