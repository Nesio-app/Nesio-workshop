import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const authStartRoute = read('app/api/auth/start/route.ts');
const calendarConnectRoute = read('app/api/portal/calendar/connect/route.ts');
const cloudInventoryRoute = read('app/api/cloud/inventory/route.ts');
const cloudProfileSettingsRoute = read('app/api/cloud/profile-settings/route.ts');
const packageJson = JSON.parse(read('package.json'));

for (const [name, source] of [
  ['auth start', authStartRoute],
  ['calendar connect', calendarConnectRoute],
]) {
  assert.match(
    source,
    // 允许代理感知形式:x-forwarded-host 优先(Vercel 反代),host 兜底
    /buildProductionRuntimeStatus\([^)]*requestHost:\s*(?:req\.headers\.get\(['"]x-forwarded-host['"]\)\s*\|\|\s*)?req\.headers\.get\(['"]host['"]\)/s,
    `${name} must evaluate production runtime with the incoming request host.`,
  );
  assert.match(
    source,
    /setupTaskMatrix/,
    `${name} must consume setupTaskMatrix instead of checking env only.`,
  );
  assert.match(
    source,
    /canonical_domain_mismatch/,
    `${name} must fail closed with canonical_domain_mismatch before starting external OAuth.`,
  );
  assert.match(
    source,
    /setupTask/,
    `${name} failure payload must expose the safe setupTask diagnostic.`,
  );
}

// Cloud 就绪判定已重构进共享服务端运行时(lib/portal/cloud-server-runtime,
// 内部走 buildProductionRuntimeStatus/setupTaskMatrix),route 委托调用。
// 契约随实现迁移:断言 route 的委托关系 + 共享运行时的真实实现。
const cloudServerRuntime = read('lib/portal/cloud-server-runtime.ts');
for (const [name, source] of [
  ['cloud inventory', cloudInventoryRoute],
  ['cloud profile settings', cloudProfileSettingsRoute],
]) {
  assert.match(
    source,
    /cloud-server-runtime/,
    `${name} must delegate cloud readiness to the shared cloud server runtime.`,
  );
  const combined = `${source}\n${cloudServerRuntime}`;
  assert.match(
    combined,
    /buildProductionRuntimeStatus/,
    `${name} must derive cloud readiness from production runtime status.`,
  );
  assert.match(
    combined,
    /setupTaskMatrix/,
    `${name} must expose setupTask diagnostics when cloud DB is not ready.`,
  );
  assert.match(
    combined,
    /cloud_database/,
    `${name} must bind to the cloud_database provider contract.`,
  );
}

assert.equal(
  packageJson.scripts['test:production-runtime-api-gates'],
  'node scripts/production-runtime-api-gates.test.mjs',
  'package.json must expose production runtime API gate coverage.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:production-runtime-api-gates/,
  'test:contracts must include production runtime API gate coverage.',
);

console.log('production runtime API gate tests passed');
