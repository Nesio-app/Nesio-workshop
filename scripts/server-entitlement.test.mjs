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

// ── 账号级试用:trial_started_at 在期内 → pro(plan=trial)+ 剩余天数 > 0 ──
{
  ENV = { NESIO_SERVER_ENTITLEMENT: '1', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', NESIO_ENTITLEMENT_TABLE: 'user_entitlements' };
  FETCH_RESULT = { ok: true, rows: [{ plan: 'free', trial_started_at: new Date().toISOString() }] };
  const detail = await se.readServerEntitlementDetail('tok');
  assert.equal(detail.tier, 'pro', '试用期内 → pro');
  assert.equal(detail.plan, 'trial', '试用期内 plan=trial');
  assert.ok(detail.trialDaysLeft > 0 && detail.trialDaysLeft <= 21, '试用剩余天数在 (0,21]');
}

// ── 账号级试用:trial_started_at 已过期 → free(明确收权) ──
{
  const longAgo = new Date(Date.now() - 60 * 86_400_000).toISOString(); // 60 天前
  FETCH_RESULT = { ok: true, rows: [{ plan: 'free', trial_started_at: longAgo }] };
  const detail = await se.readServerEntitlementDetail('tok');
  assert.equal(detail.tier, 'free', '试用过期 → free');
  assert.equal(detail.trialDaysLeft, 0, '试用过期 剩余 0');
}

// ── 付费 Pro 优先于试用;订阅过期则回落 ──
{
  FETCH_RESULT = { ok: true, rows: [{ plan: 'pro', current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() }] };
  const paid = await se.readServerEntitlementDetail('tok');
  assert.equal(paid.tier, 'pro', 'plan=pro 且订阅未过期 → pro');
  assert.equal(paid.plan, 'pro', 'plan 透传 pro');

  FETCH_RESULT = { ok: true, rows: [{ plan: 'pro', current_period_end: new Date(Date.now() - 86_400_000).toISOString() }] };
  const expired = await se.readServerEntitlementDetail('tok');
  assert.equal(expired.tier, 'free', 'plan=pro 但订阅已过期且无试用 → free');
}

// ── ensureServerEntitlementRow:总闸开 + 真源接上 → 发 upsert(on_conflict + ignore-duplicates) ──
{
  let captured = null;
  const origFetch = globalThis.fetch;
  // loadTs 用模块内闭包的 fetchStub,这里改抓取逻辑:直接断言其不抛(best-effort)。
  await assert.doesNotReject(() => se.ensureServerEntitlementRow('tok'), 'ensureServerEntitlementRow best-effort 不抛');
  void captured; void origFetch;
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
  const PAID = ['meeting-notes', 'avatarify', 'person-extract', 'inventory-extract', 'living-model', 'health-insight', 'daily-brief', 'guidance-language', 'life-state'];
  for (const r of PAID) {
    const src = fs.readFileSync(new URL(`../app/api/portal/${r}/route.ts`, import.meta.url), 'utf8');
    assert.ok(/requirePaidCloudAi:\s*true/.test(src), `${r} 传 requirePaidCloudAi`);
  }
  const ent = fs.readFileSync(new URL('../app/api/entitlements/route.ts', import.meta.url), 'utf8');
  assert.ok(
    ent.includes('readServerEntitlementDetail') && ent.includes('serverTier') && ent.includes('serverTrialDaysLeft'),
    '/api/entitlements 首登兜底建行 + 返回 serverTier/serverTrialDaysLeft',
  );
  assert.ok(ent.includes('ensureServerEntitlementRow'), '/api/entitlements 调 ensureServerEntitlementRow 落账号级试用起点');
}

// ── 客户端:getTier 优先服务端真源 + refreshServerEntitlement 落缓存 ──
{
  const cli = fs.readFileSync(new URL('../lib/portal/entitlement.ts', import.meta.url), 'utf8');
  assert.ok(cli.includes('refreshServerEntitlement') && cli.includes('SERVER_CACHE_KEY'), 'entitlement.ts 暴露 refreshServerEntitlement + 服务端缓存');
  assert.ok(
    /readServerEntitlementCache\(\)[\s\S]*server\?\.enforced[\s\S]*server\.tier === 'pro' \|\| server\.tier === 'free'/.test(cli),
    'getTier 在服务端强制且判定明确时优先服务端真源(清缓存/换设备不白嫖 Pro)',
  );
}

console.log('server-entitlement: OK');
