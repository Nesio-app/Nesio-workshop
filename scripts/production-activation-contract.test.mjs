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
  GOOGLE_CALENDAR_ICS_URL: 'https://calendar.example/secret.ics',
  FLOMO_API_KEY: 'flomo',
};

const configuredReport = buildProductionActivationContract({ env: configuredEnv });

assert.equal(configuredReport.summary.productionReady, true);
assert.equal(configuredReport.summary.configuredProviderCount, configuredReport.summary.providerCount);
assert.equal(configuredReport.summary.missingEnvProviderCount, 0);
assert.equal(configuredReport.summary.enabledSwitchCount, configuredReport.summary.runtimeSwitchCount);
assert.ok(configuredReport.providers.every((provider) => provider.runtimeEnabled === true));

console.log('production activation contract tests passed');
