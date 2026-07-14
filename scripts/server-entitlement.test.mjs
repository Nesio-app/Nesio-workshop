/**
 * 行为契约:安全审计 #1 —— 服务端权益强制骨架(默认 inert、真源接上即强制)。
 * 锁死:
 *  - 总闸未开 / 真源未接 / 查询失败 → 'unknown'(fail-open,骨架不改现有行为)。
 *  - 总闸开 + 真源接上 + 查到 pro → 'pro';明确非 pro → 'free'(唯一强制分支)。
 *  - guardServerEntitlement:'free' → 402;其余 → 放行。
 *  - guardAiRoute 有 requirePaidCloudAi 分支;付费云路由都传了它。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

let ENV = {};
let FETCH_RESULT = { ok: true, rows: [] };
const fetchStub = async () => ({ ok: FETCH_RESULT.ok, json: async () => FETCH_RESULT.rows });

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console,
    fetch: fetchStub, Array, Object, JSON, Promise,
    encodeURIComponent,
  });
  return mod.exports;
}

const NextResponse = { json: (body, init) => ({ __body: body, __status: (init && init.status) || 200 }) };
const se = loadTs('../lib/portal/auth/server-entitlement.ts', (p) =>
  p === 'next/server' ? { NextResponse }
  : p.includes('/env') ? { envValue: (k) => ENV[k] || '' }
  : p.includes('production-runtime') ? { normalizeSupabaseRuntimeUrl: (u) => u }
  : p.includes('integrations') ? { getSupabaseUserId: async () => 'uid1' }
  : ({}));

// ── inert:总闸未开 → unknown(不查真源) ──
{
  ENV = {};
  assert.equal(await se.readServerTier('tok'), 'unknown', '总闸未开 → unknown');
  assert.equal(await se.serverEntitlementEnforced(), false, 'enforced 默认 false');
}

// ── 总闸开但真源未接(无表名)→ unknown ──
{
  ENV = { NESIO_SERVER_ENTITLEMENT: '1', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
  assert.equal(await se.readServerTier('tok'), 'unknown', '真源未接 → unknown');
}

// ── 真源接上 + 查到 pro → pro ──
{
  ENV = { NESIO_SERVER_ENTITLEMENT: '1', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', NESIO_ENTITLEMENT_TABLE: 'user_entitlements' };
  FETCH_RESULT = { ok: true, rows: [{ plan: 'pro' }] };
  assert.equal(await se.readServerTier('tok'), 'pro', 'plan=pro → pro');
}

// ── 真源接上 + 明确非 pro → free(唯一强制分支) ──
{
  FETCH_RESULT = { ok: true, rows: [{ plan: 'free' }] };
  assert.equal(await se.readServerTier('tok'), 'free', 'plan=free → free');
  FETCH_RESULT = { ok: true, rows: [] };
  assert.equal(await se.readServerTier('tok'), 'free', '无行 → free(明确无权益)');
}

// ── 查询失败 → unknown(fail-open,不锁真用户) ──
{
  FETCH_RESULT = { ok: false, rows: [] };
  assert.equal(await se.readServerTier('tok'), 'unknown', '查询失败 → unknown(fail-open)');
}

// ── guardServerEntitlement:free → 402;其余放行 ──
{
  ENV = { NESIO_SERVER_ENTITLEMENT: '1', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', NESIO_ENTITLEMENT_TABLE: 'user_entitlements' };
  FETCH_RESULT = { ok: true, rows: [{ plan: 'free' }] };
  const blocked = await se.guardServerEntitlement('tok', 'meeting_notes');
  assert.ok(blocked && blocked.__status === 402 && blocked.__body.error === 'pro_required', 'free → 402 pro_required');
  FETCH_RESULT = { ok: true, rows: [{ plan: 'pro' }] };
  assert.equal(await se.guardServerEntitlement('tok', 'meeting_notes'), null, 'pro → 放行');
  ENV = {}; // 总闸关
  assert.equal(await se.guardServerEntitlement('tok', 'meeting_notes'), null, 'inert → 放行');
}

// ── 源码级:guardAiRoute 接线 + 付费路由都传 requirePaidCloudAi ──
{
  const guard = fs.readFileSync(new URL('../lib/portal/auth/api-auth.ts', import.meta.url), 'utf8');
  assert.ok(guard.includes('requirePaidCloudAi') && guard.includes('guardServerEntitlement'), 'guardAiRoute 接服务端权益守卫');
  const PAID = ['meeting-notes', 'avatarify', 'person-extract', 'inventory-extract', 'living-model', 'health-insight', 'daily-brief'];
  for (const r of PAID) {
    const src = fs.readFileSync(new URL(`../app/api/portal/${r}/route.ts`, import.meta.url), 'utf8');
    assert.ok(/requirePaidCloudAi:\s*true/.test(src), `${r} 传 requirePaidCloudAi`);
  }
  const ent = fs.readFileSync(new URL('../app/api/entitlements/route.ts', import.meta.url), 'utf8');
  assert.ok(ent.includes('readServerTier') && ent.includes('serverTier'), '/api/entitlements 返回 serverTier');
}

console.log('server-entitlement: OK');
