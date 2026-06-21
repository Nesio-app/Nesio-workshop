import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const runtime = fs.readFileSync(path.join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
const healthRoute = fs.readFileSync(path.join(root, 'app', 'api', 'portal', 'production', 'health', 'route.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(runtime, /providerActionMatrix/, 'production runtime status must expose providerActionMatrix');
assert.match(runtime, /setupTaskMatrix/, 'production runtime status must expose setupTaskMatrix for launchable provider setup');
assert.match(runtime, /actionStatus/, 'providerActionMatrix entries must expose actionStatus');
assert.match(runtime, /startEndpoint/, 'providerActionMatrix entries must expose startEndpoint');
assert.match(runtime, /safeUserAction/, 'providerActionMatrix entries must expose safeUserAction');
assert.match(runtime, /serverOnly/, 'providerActionMatrix entries must distinguish server-only capabilities');
assert.match(runtime, /blockedReason/, 'setupTaskMatrix entries must explain why provider setup is blocked');
assert.match(runtime, /requiresCanonicalDomain/, 'setupTaskMatrix entries must show whether canonical domain readiness is required');
assert.match(runtime, /BAOHE_ALLOWED_RUNTIME_HOSTS/, 'production runtime must support an explicit allowed runtime host list for OAuth rollout.');
assert.match(runtime, /allowedRuntimeHosts/, 'production runtime status must expose the allowed runtime hosts for diagnostics.');
assert.match(runtime, /canonicalDomainAllowedHosts/, 'production runtime must evaluate canonical host plus allowed runtime host aliases.');

for (const provider of ['email', 'google', 'wechat', 'phone']) {
  assert.match(
    runtime,
    new RegExp(`${provider}[\\s\\S]*?/api/auth/start`),
    `auth provider ${provider} should route through /api/auth/start`,
  );
}

assert.match(runtime, /gemini[\s\S]*?\/api\/secretary\/chat/, 'Gemini should route through secretary chat endpoint');
assert.match(runtime, /chatgpt[\s\S]*?\/api\/secretary\/chat/, 'ChatGPT should route through secretary chat endpoint');
assert.match(runtime, /doubao[\s\S]*?\/api\/secretary\/chat/, 'Doubao should route through secretary chat endpoint');
assert.match(runtime, /claude[\s\S]*?\/api\/secretary\/chat/, 'Claude should route through secretary chat endpoint');

assert.match(runtime, /cloud_database[\s\S]*serverOnly:\s*true/, 'cloud database must be server-only');
assert.match(runtime, /cloud_storage[\s\S]*serverOnly:\s*true/, 'cloud storage must be server-only');
assert.match(runtime, /google_calendar[\s\S]*\/api\/portal\/calendar\/connect/, 'Google Calendar should route through the OAuth connect endpoint');
assert.match(runtime, /google_calendar[\s\S]*requiredEnv:\s*\['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'\]/, 'Google Calendar runtime readiness must require OAuth client configuration.');
assert.match(runtime, /flomo[\s\S]*\/api\/portal\/flomo/, 'Flomo should route through portal Flomo endpoint');
assert.match(runtime, /flomo[\s\S]*serverOnly:\s*true/, 'Flomo must stay server-only so the browser never receives Flomo secrets');

assert.match(runtime, /actionableProviderCount/, 'summary must include actionableProviderCount');
assert.match(runtime, /blockedProviderCount/, 'summary must include blockedProviderCount');
assert.match(runtime, /setupTaskCount/, 'summary must include setupTaskCount');
assert.match(runtime, /blockedSetupTaskCount/, 'summary must include blockedSetupTaskCount');
assert.match(healthRoute, /buildProductionRuntimeStatus/, 'production health route must return the full runtime status matrix');

assert.equal(
  packageJson.scripts['test:production-runtime-provider-actions'],
  'node scripts/production-runtime-provider-actions.test.mjs',
  'package.json must expose production runtime provider action test',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:production-runtime-provider-actions/,
  'test:contracts must include provider action matrix coverage',
);

console.log('production runtime provider action matrix tests passed');
