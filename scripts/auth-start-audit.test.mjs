import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const route = read('app/api/auth/start/route.ts');
const packageJson = JSON.parse(read('package.json'));

assert.match(route, /createAuthStartAuditId/, 'Auth start route must create a per-request audit id.');
assert.match(route, /auth_start_request/, 'Auth start route must log redacted auth start request events.');
assert.match(route, /auth_start_failure/, 'Auth start route must log redacted auth start failure events.');
assert.match(route, /auth_start_success/, 'Auth start route must log redacted auth start success events.');
assert.match(route, /auditId/, 'Auth start responses must include auditId for support/debug correlation.');
assert.match(route, /type AuthMode = 'login' \| 'register'/, 'Auth start must model login and registration separately.');
assert.match(route, /create_user:\s*shouldCreateUser/, 'Email login must not create accounts unless registration mode is selected.');
assert.match(route, /should_create_user:\s*shouldCreateUser/, 'Auth start should pass the Supabase compatible should_create_user flag.');
assert.match(route, /user_not_found/, 'Email login should expose a safe user_not_found error for unknown accounts.');
assert.match(route, /provider_not_configured/, 'Auth start must preserve fail-closed provider_not_configured responses.');
assert.match(route, /canonical_domain_mismatch/, 'Auth start must preserve canonical domain mismatch responses.');
assert.doesNotMatch(
  route,
  /console\.(?:info|warn|error)\([^\n]*(?:SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|WECHAT_APP_SECRET|Authorization|Bearer|apikey)/,
  'Auth start audit logs must not print secrets or auth headers.',
);

assert.equal(
  packageJson.scripts['test:auth-start-audit'],
  'node scripts/auth-start-audit.test.mjs',
  'package.json must expose auth start audit test.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:auth-start-audit/,
  'test:security must include auth start audit coverage.',
);

console.log('auth start audit tests passed');
