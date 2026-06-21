import assert from 'node:assert/strict';
import { buildProductionActivationContract } from '../lib/portal/production-activation-contract.mjs';

const emptyReport = buildProductionActivationContract({ env: {} });

assert.equal(emptyReport.version, 'production-activation-v0');
assert.equal(emptyReport.implementation, 'guarded-production-readiness');
assert.equal(emptyReport.ceoGate.status, 'approved');
assert.equal(emptyReport.ceoGate.secretsMustStayOutOfGit, true);
assert.equal(emptyReport.boundaries.callsExternalProvidersDuringReport, false);
assert.equal(emptyReport.boundaries.createsCloudResourcesDuringReport, false);
assert.equal(emptyReport.boundaries.failClosedWhenMissingConfig, true);
assert.equal(emptyReport.summary.ceoApproved, true);
assert.equal(emptyReport.summary.productionReady, false);
assert.ok(emptyReport.summary.missingEnvProviderCount > 0);
assert.ok(emptyReport.providers.every((provider) => provider.failClosed === true));

const providerIds = new Set(emptyReport.providers.map((provider) => provider.id));
for (const id of [
  'auth_email',
  'auth_google',
  'auth_wechat',
  'auth_phone',
  'cloud_database',
  'cloud_storage',
  'ai_openai',
  'ai_gemini',
  'ai_doubao',
  'ai_anthropic',
  'google_calendar',
  'flomo',
]) {
  assert.equal(providerIds.has(id), true, `${id} must be represented in production activation`);
}

const configuredEnv = {
  BAOHE_AUTH_ENABLED: 'true',
  CLOUD_DB_ENABLED: 'true',
  CLOUD_STORAGE_ENABLED: 'true',
  BAOHE_AI_PROVIDER_MODE: 'production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_STORAGE_BUCKET: 'baohe',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  WECHAT_APP_ID: 'wechat-app',
  WECHAT_APP_SECRET: 'wechat-secret',
  SMS_PROVIDER: 'twilio',
  SMS_PROVIDER_API_KEY: 'sms',
  OPENAI_API_KEY: 'openai',
  GEMINI_API_KEY: 'gemini',
  DOUBAO_API_KEY: 'doubao',
  ANTHROPIC_API_KEY: 'anthropic',
  CALENDAR_PRIVATE_FEEDS_ENABLED: 'true',
  GOOGLE_CALENDAR_ICS_URL: 'https://calendar.example/secret.ics',
  FLOMO_WEBHOOK_URL: 'https://flomo.example/iwh/demo/',
  FLOMO_API_KEY: 'flomo',
};

const configuredReport = buildProductionActivationContract({ env: configuredEnv });

assert.equal(configuredReport.summary.productionReady, true);
assert.equal(configuredReport.summary.configuredProviderCount, configuredReport.summary.providerCount);
assert.equal(configuredReport.summary.missingEnvProviderCount, 0);
assert.equal(configuredReport.summary.enabledSwitchCount, configuredReport.summary.runtimeSwitchCount);
assert.ok(configuredReport.providers.every((provider) => provider.runtimeEnabled === true));

const aliasEnvReport = buildProductionActivationContract({
  env: {
    BAOHE_AI_PROVIDER_MODE: 'production',
    GOOGLE_GENERATIVE_AI_API_KEY: 'gemini-alias',
    OpenAI_KEY: 'openai-legacy-alias',
  },
});

const aliasProviders = new Map(aliasEnvReport.providers.map((provider) => [provider.id, provider]));
assert.equal(aliasProviders.get('ai_gemini')?.configured, true, 'Gemini must honor Google Generative AI key aliases.');
assert.deepEqual(aliasProviders.get('ai_gemini')?.missingEnv, [], 'Gemini alias should satisfy missing env checks.');
assert.equal(aliasProviders.get('ai_openai')?.configured, true, 'OpenAI must honor legacy OpenAI_KEY alias.');
assert.deepEqual(aliasProviders.get('ai_openai')?.missingEnv, [], 'OpenAI alias should satisfy missing env checks.');

const calendarUrlOnlyReport = buildProductionActivationContract({
  env: {
    GOOGLE_CALENDAR_ICAL_URL: 'https://calendar.example/private.ics',
  },
});
const calendarUrlOnly = calendarUrlOnlyReport.providers.find((provider) => provider.id === 'google_calendar');
assert.equal(calendarUrlOnly?.configured, false, 'Google Calendar activation must not pass without private feed gate.');
assert.deepEqual(
  calendarUrlOnly?.missingEnv,
  ['CALENDAR_PRIVATE_FEEDS_ENABLED'],
  'Google Calendar activation must surface the missing private feed gate.',
);

const calendarAliasReport = buildProductionActivationContract({
  env: {
    CALENDAR_PRIVATE_FEEDS_ENABLED: 'true',
    GOOGLE_CALENDAR_ICS_URL: 'https://calendar.example/private.ics',
  },
});
const calendarAlias = calendarAliasReport.providers.find((provider) => provider.id === 'google_calendar');
assert.equal(calendarAlias?.configured, true, 'Google Calendar must honor ICS URL aliases when the private feed gate is enabled.');
assert.deepEqual(calendarAlias?.missingEnv, [], 'Google Calendar alias should satisfy URL checks while keeping the gate required.');

const flomoReadOnlyReport = buildProductionActivationContract({
  env: {
    FLOMO_API_KEY: 'flomo-read-token',
  },
});
const flomoReadOnly = flomoReadOnlyReport.providers.find((provider) => provider.id === 'flomo');
assert.equal(flomoReadOnly?.configured, false, 'Flomo production activation must not pass with read token only.');
assert.deepEqual(
  flomoReadOnly?.missingEnv,
  ['FLOMO_WEBHOOK_URL'],
  'Flomo production activation must surface the missing send webhook URL.',
);

const flomoWriteOnlyReport = buildProductionActivationContract({
  env: {
    FLOMO_WEBHOOK_URL: 'https://flomo.example/iwh/demo/',
  },
});
const flomoWriteOnly = flomoWriteOnlyReport.providers.find((provider) => provider.id === 'flomo');
assert.equal(flomoWriteOnly?.configured, false, 'Flomo production activation must not pass with send webhook only.');
assert.deepEqual(
  flomoWriteOnly?.missingEnv,
  ['FLOMO_API_KEY'],
  'Flomo production activation must surface the missing read access token.',
);

const flomoAliasReport = buildProductionActivationContract({
  env: {
    FLOMO_API_URL: 'https://flomo.example/iwh/demo/',
    FLOMO_API_KEY: 'flomo-read-token',
  },
});
const flomoAlias = flomoAliasReport.providers.find((provider) => provider.id === 'flomo');
assert.equal(flomoAlias?.configured, true, 'Flomo must honor FLOMO_API_URL as a send URL alias.');
assert.deepEqual(flomoAlias?.missingEnv, [], 'Flomo alias should satisfy send URL checks while keeping read key required.');

console.log('production activation contract tests passed');
