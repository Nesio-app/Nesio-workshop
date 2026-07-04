import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const runtime = fs.readFileSync(path.join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
const healthRoute = fs.readFileSync(path.join(root, 'app', 'api', 'portal', 'production', 'health', 'route.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const compiledRuntime = ts.transpileModule(runtime, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const runtimeModule = await import(`data:text/javascript;base64,${Buffer.from(compiledRuntime.outputText).toString('base64')}`);

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
const googleAccountLoginBlock = runtime.match(/google:\s*status\(env,\s*\{[\s\S]*?label:\s*'Google login'[\s\S]*?\}\),/)?.[0] || '';
assert.ok(googleAccountLoginBlock, 'production runtime must expose a Google account login provider block.');
assert.doesNotMatch(
  googleAccountLoginBlock,
  /GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/,
  'Google account login must not require Google client secrets in this app runtime when Supabase brokers OAuth.',
);
assert.match(runtime, /google_calendar_ical_readonly/, 'Google Calendar iCal feed readiness must be reported separately from OAuth.');
assert.match(runtime, /GOOGLE_CALENDAR_ICAL_URL/, 'Google Calendar iCal readiness must recognize configured read-only feed URLs.');
assert.match(runtime, /CALENDAR_PRIVATE_FEEDS_ENABLED/, 'Google Calendar iCal readiness must require the private feed runtime switch.');
assert.match(runtime, /flomo[\s\S]*\/api\/portal\/flomo/, 'Flomo should route through portal Flomo endpoint');
assert.match(runtime, /flomo[\s\S]*serverOnly:\s*true/, 'Flomo must stay server-only so the browser never receives Flomo secrets');

assert.match(runtime, /actionableProviderCount/, 'summary must include actionableProviderCount');
assert.match(runtime, /blockedProviderCount/, 'summary must include blockedProviderCount');
assert.match(runtime, /setupTaskCount/, 'summary must include setupTaskCount');
assert.match(runtime, /blockedSetupTaskCount/, 'summary must include blockedSetupTaskCount');
assert.match(runtime, /categoryReadinessSummary/, 'summary must include categoryReadinessSummary for account/cloud/AI/third-party readiness.');
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

const allowedHostRuntime = runtimeModule.buildProductionRuntimeStatus({
  BAOHE_CANONICAL_DOMAIN: 'www.nesio.app',
  BAOHE_ALLOWED_RUNTIME_HOSTS: 'https://treasurebox-nu.vercel.app, preview.nesio.app:443',
  BAOHE_AUTH_ENABLED: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}, {
  requestHost: 'treasurebox-nu.vercel.app',
});
assert.equal(
  allowedHostRuntime.canonicalDomainMatchesRequestHost,
  true,
  'full URL entries in BAOHE_ALLOWED_RUNTIME_HOSTS should allow matching runtime hosts.',
);
assert.deepEqual(
  allowedHostRuntime.canonicalDomainAllowedHosts,
  // hostVariants 同时展开 apex 与 www 变体(host-only cookie bug 修复,
  // 见 production-runtime.hostVariants 头注释)
  ['www.nesio.app', 'nesio.app', 'treasurebox-nu.vercel.app', 'www.treasurebox-nu.vercel.app', 'preview.nesio.app', 'www.preview.nesio.app'],
  'canonicalDomainAllowedHosts should expose normalized canonical and allowed runtime hosts (apex + www variants).',
);
assert.deepEqual(
  Object.keys(allowedHostRuntime.summary.categoryReadinessSummary),
  ['account_auth', 'cloud', 'ai', 'third_party'],
  'categoryReadinessSummary should expose stable readiness buckets for the launch control surface.',
);
assert.deepEqual(
  allowedHostRuntime.summary.categoryReadinessSummary.account_auth,
  {
    total: 4,
    ready: 3,
    serverReady: 0,
    blocked: 1,
  },
  'account auth readiness should count email/google/phone ready and WeChat blocked when its env is absent.',
);
assert.deepEqual(
  allowedHostRuntime.summary.categoryReadinessSummary.cloud,
  {
    total: 2,
    ready: 0,
    serverReady: 0,
    blocked: 2,
  },
  'cloud readiness should separately summarize server-side cloud DB/storage setup.',
);

const blockedHostRuntime = runtimeModule.buildProductionRuntimeStatus({
  BAOHE_CANONICAL_DOMAIN: 'www.nesio.app',
  BAOHE_ALLOWED_RUNTIME_HOSTS: 'treasurebox-nu.vercel.app',
  BAOHE_AUTH_ENABLED: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}, {
  requestHost: 'unknown.example.com',
});
assert.equal(
  blockedHostRuntime.setupTaskMatrix.find((task) => task.id === 'google')?.blockedReason,
  'canonical_domain_mismatch',
  'unknown production hosts must continue to fail closed for OAuth auth setup.',
);

const supabasePhoneRuntime = runtimeModule.buildProductionRuntimeStatus({
  BAOHE_CANONICAL_DOMAIN: 'www.nesio.app',
  BAOHE_AUTH_ENABLED: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}, {
  requestHost: 'www.nesio.app',
});
assert.equal(
  supabasePhoneRuntime.accountAuth.providers.phone.enabled,
  true,
  'phone auth should be ready when Supabase Auth is configured; SMS delivery is configured inside Supabase, not this app runtime.',
);
assert.deepEqual(
  supabasePhoneRuntime.accountAuth.providers.phone.missingEnv,
  [],
  'phone auth should not require unused SMS_PROVIDER app env variables.',
);
assert.equal(
  supabasePhoneRuntime.accountAuth.providers.google.enabled,
  true,
  'Google auth should be ready when Supabase Auth is configured; Google OAuth client secrets are configured in Supabase, not this app runtime.',
);
assert.deepEqual(
  supabasePhoneRuntime.accountAuth.providers.google.missingEnv,
  [],
  'Google auth should not require GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in this app runtime.',
);

const calendarFeedRuntime = runtimeModule.buildProductionRuntimeStatus({
  BAOHE_CANONICAL_DOMAIN: 'www.nesio.app',
  BAOHE_ALLOWED_RUNTIME_HOSTS: 'treasurebox-nu.vercel.app',
  CALENDAR_PRIVATE_FEEDS_ENABLED: 'true',
  GOOGLE_CALENDAR_ICAL_URL: 'https://calendar.google.com/calendar/ical/private/basic.ics',
}, {
  requestHost: 'treasurebox-nu.vercel.app',
});
assert.equal(
  calendarFeedRuntime.thirdParty.googleCalendarIcalReadonly.enabled,
  true,
  'Google Calendar read-only iCal should be enabled when private feeds are enabled and an iCal URL is configured.',
);
assert.equal(
  calendarFeedRuntime.thirdParty.googleCalendar.enabled,
  false,
  'Google Calendar OAuth should remain separate and blocked when OAuth client config is absent.',
);
assert.equal(
  calendarFeedRuntime.providerActionMatrix.find((provider) => provider.id === 'google_calendar_ical_readonly')?.actionStatus,
  'server_ready',
  'Google Calendar read-only iCal should appear as a server-ready third-party provider.',
);
assert.equal(
  calendarFeedRuntime.providerActionMatrix.find((provider) => provider.id === 'google_calendar')?.actionStatus,
  'configure_required',
  'Google Calendar OAuth should still explain missing OAuth setup separately.',
);

console.log('production runtime provider action matrix tests passed');
