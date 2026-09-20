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
      if (p === './idb-blob-store') return {
        createBlobStore: ({ key }) => ({
          load: () => {
            try {
              const raw = localStorage.getItem(key);
              return raw ? JSON.parse(raw) : null;
            } catch { return null; }
          },
          save: (v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } },
          ready: async () => {},
          refresh: async () => {},
          isReady: () => true,
        }),
      };
      if (p === './yield-main') return { yieldToMain: async () => {} };
      if (p === './cloud-record-sync') {
        // 与生产同构的最小桩:meta 齐了跳过;否则原样返回 fetch 结果(测试 fetchImpl 自带 rows)。
        const sinceKeyFromStateKey = (stateKey) => stateKey.replace(/-state(-v\d+)?$/, '-since$1');
        const readPullSince = (sinceKey) => {
          try {
            const v = localStorage.getItem(sinceKey);
            if (!v || !Date.parse(v)) return null;
            return new Date(Date.parse(v)).toISOString();
          } catch { return null; }
        };
        const writePullSince = (sinceKey, iso) => { try { localStorage.setItem(sinceKey, iso); } catch { /* */ } };
        const clearPullSince = (sinceKey) => { try { localStorage.removeItem(sinceKey); } catch { /* */ } };
        const maxRowUpdatedAt = (rows, fallback) => {
          let max = fallback || '';
          for (const r of rows) if (typeof r.updatedAt === 'string' && r.updatedAt > max) max = r.updatedAt;
          return max || new Date().toISOString();
        };
        const pullModulePrefixRows = async ({ prefix, sinceKey, hasLocal, localCount }) => {
          let since = readPullSince(sinceKey);
          if (since && localCount === 0) { clearPullSince(sinceKey); since = null; }
          const fetchRows = async (qs) => {
            const res = await ctx.fetch(`/api/cloud/module-data?${qs}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok || !data.ok || !Array.isArray(data.modules)) return null;
            return data.modules;
          };
          if (since) {
            const rows = await fetchRows(`keyPrefix=${encodeURIComponent(prefix)}&since=${encodeURIComponent(since)}`);
            if (!rows) return { rows: [], nextSince: null, skippedDownload: false };
            return { rows, nextSince: maxRowUpdatedAt(rows, since), skippedDownload: false };
          }
          const meta = await fetchRows(`keyPrefix=${encodeURIComponent(prefix)}&meta=1`);
          if (!meta) return { rows: [], nextSince: null, skippedDownload: false };
          const missing = meta.filter((row) => {
            const key = row.moduleKey;
            if (!key || !key.startsWith(prefix)) return false;
            const id = key.slice(prefix.length);
            return Boolean(id) && !hasLocal(id);
          });
          if (!missing.length) return { rows: [], nextSince: maxRowUpdatedAt(meta), skippedDownload: true };
          const rows = await fetchRows(`keyPrefix=${encodeURIComponent(prefix)}`);
          if (!rows) return { rows: [], nextSince: null, skippedDownload: false };
          return { rows, nextSince: maxRowUpdatedAt(rows), skippedDownload: false };
        };
        return { pullModulePrefixRows, writePullSince, sinceKeyFromStateKey, readPullSince, clearPullSince, maxRowUpdatedAt };
      }
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

// 2. pull:since/meta 省 egress、并集补缺、落地 putEmailBodies + 喂 indexEmailBodies
{
  const rows = [cloudRow('18c1aa', '云端邮件正文 A'), cloudRow('18c2bb', 'Cloud email body B')];
  const fetchImpl = async (url, init, cap) => {
    cap.get(url);
    if (typeof url === 'string' && url.startsWith('/api/cloud/module-data')) {
      // meta=1 时路由不回 data;测试里用同样 rows 即可(客户端只读 moduleKey)
      return { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // 本机已有 18c1aa(不覆盖),缺 18c2bb(补)
  const { mod, ctx } = makeCtx({ localBodies: { '18c1aa': '本机已有的正文 A' }, fetchImpl });
  const r = await mod.pullEmailBodiesFromCloud();
  assert.ok(String(ctx._lastGetUrl()).includes('keyPrefix=email-body%3A'), 'GET 用 keyPrefix=email-body:');
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
