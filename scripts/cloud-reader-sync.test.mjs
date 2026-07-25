/**
 * 行为契约:导入书籍逐本记录级同步(修换端书丢失)。
 * 锁死:push 逐本行 `reader-book:<id>` gz 压缩、增量;pull 用 keyPrefix=reader-book: 只取书行、
 * 并集补缺(本机已有的不覆盖)、落地经 saveReaderBook;超大书跳过不同步。
 * 真 fflate;reader-store / sync-ownership / fetch / localStorage 走注入桩。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';

const src = fs.readFileSync(new URL('../lib/portal/cloud-reader-sync.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx({ lsInit = {}, localBooks = [], fetchImpl } = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  const saved = [];
  let lastPost = null;
  let lastGetUrl = null;
  const ctx = {
    module: { exports: {} }, exports: {}, console,
    Date, Math, JSON, btoa, atob, String, Uint8Array, Array, Object, Number, Set, encodeURIComponent,
    window: { dispatchEvent: () => true },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage,
    fetch: async (url, init) => fetchImpl(url, init, { post: (b) => { lastPost = b; }, get: (u) => { lastGetUrl = u; } }),
    require: (p) => {
      if (p === 'fflate') return fflate;
      if (p === './reader-store-idb') return {
        loadReaderBooks: async () => localBooks.slice(),
        saveReaderBook: async (b) => { saved.push(b); },
      };
      if (p === './sync-ownership') return { READER_BOOK_MODULE_PREFIX: 'reader-book:' };
      if (p === './storage-health') return { logDropped: () => {} };
      return {};
    },
    _lastPost: () => lastPost,
    _lastGetUrl: () => lastGetUrl,
    _saved: () => saved,
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return { mod: ctx.module.exports, ctx };
}

function cloudRow(book) {
  const gz = fflate.gzipSync(fflate.strToU8(JSON.stringify(book)));
  let bin = '';
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return { moduleKey: 'reader-book:' + book.id, data: { gz: Buffer.from(bin, 'binary').toString('base64') } };
}

// 1. push:逐本行(reader-book: 前缀 + gz)、增量不重推
{
  const okPost = async (url, init, cap) => {
    if (url === '/api/cloud/module-data' && init?.method === 'POST') { cap.post(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({
    localBooks: [{ id: 'bk_1', title: 'A', chapters: [] }, { id: 'bk_2', title: 'B', chapters: [] }],
    fetchImpl: okPost,
  });
  const r = await mod.pushReaderBooksToCloud();
  assert.equal(r.pushed, 2, '两本都推');
  const keys = ctx._lastPost().modules.map((m) => m.moduleKey).sort();
  assert.deepEqual(keys, ['reader-book:bk_1', 'reader-book:bk_2'], '每本一行,reader-book: 前缀');
  assert.ok(ctx._lastPost().modules.every((m) => typeof m.data.gz === 'string' && m.data.gz.length > 0), '每本 gz 压缩块');
  const r2 = await mod.pushReaderBooksToCloud();
  assert.equal(r2.pushed, 0, '已推的不重推(增量)');
}

// 2. pull:keyPrefix 取书行、并集补缺(本机已有不覆盖)、落地 saveReaderBook
{
  const rows = [cloudRow({ id: 'bk_1', title: 'Cloud A', chapters: [] }), cloudRow({ id: 'bk_9', title: 'Cloud New', chapters: [] })];
  const fetchImpl = async (url, init, cap) => {
    cap.get(url);
    if (typeof url === 'string' && url.startsWith('/api/cloud/module-data')) return { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({ localBooks: [{ id: 'bk_1', title: 'Local A', chapters: [] }], fetchImpl });
  const r = await mod.pullReaderBooksFromCloud();
  assert.ok(ctx._lastGetUrl().includes('keyPrefix=reader-book%3A'), 'GET 用 keyPrefix=reader-book: 只取书行');
  assert.equal(r.applied, 1, '只补本机没有的 1 本(并集,不覆盖已有)');
  const saved = ctx._saved();
  assert.deepEqual(saved.map((b) => b.id), ['bk_9'], '只落地缺的那本');
  assert.equal(saved[0].title, 'Cloud New', '解压还原书对象');
}

// 3. id 字符集守卫:越界 id 不同步(防注入/越界 module_key)
{
  const okPost = async (url, init, cap) => { if (init?.method === 'POST') { cap.post(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; } return { ok: false, status: 404, json: async () => ({}) }; };
  const { mod, ctx } = makeCtx({ localBooks: [{ id: 'bad id:colon', title: 'x', chapters: [] }, { id: 'bk_ok', title: 'ok', chapters: [] }], fetchImpl: okPost });
  const r = await mod.pushReaderBooksToCloud();
  assert.equal(r.pushed, 1, '只推合法 id 那本');
  assert.deepEqual(ctx._lastPost().modules.map((m) => m.moduleKey), ['reader-book:bk_ok'], '越界 id 被跳过');
}

console.log('cloud-reader-sync: OK');
