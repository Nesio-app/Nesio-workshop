import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'app', 'api', 'portal', 'production', 'activation-checklist', 'route.ts');
const route = fs.readFileSync(routePath, 'utf8');
const client = fs.readFileSync(path.join(root, 'lib', 'portal', 'app-api-client.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(route, /buildProductionRuntimeStatus/, 'activation checklist route must derive from the production runtime contract.');
assert.match(route, /requestHost:\s*request\.headers\.get\(['"]host['"]\)/, 'activation checklist route must evaluate the incoming host.');
assert.match(route, /activationChecklist/, 'activation checklist route must expose activationChecklist entries.');
assert.match(route, /readyActions/, 'activation checklist route must summarize ready actions.');
assert.match(route, /blockedActions/, 'activation checklist route must summarize blocked actions.');
assert.match(route, /nextSetupActions/, 'activation checklist route must expose next setup actions.');
assert.match(route, /categorySummary/, 'activation checklist route must expose category summary.');
assert.match(route, /secretsRedacted:\s*true/, 'activation checklist route must explicitly preserve secret redaction.');
assert.doesNotMatch(route, /process\.env\[[^\]]+\]/, 'activation checklist route must not serialize ad-hoc env values.');
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_CLIENT_SECRET|WECHAT_APP_SECRET/, 'activation checklist route must not reference secret env names directly.');

for (const marker of [
  'ProductionActivationChecklistEntry',
  'ProductionActivationChecklistResponse',
  'productionActivationChecklist',
  '/api/portal/production/activation-checklist',
  'fetchProductionActivationChecklist',
]) {
  assert.match(client, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `app API client must expose ${marker}.`);
}

assert.equal(
  packageJson.scripts['test:production-activation-checklist-api'],
  'node scripts/production-activation-checklist-api.test.mjs',
  'package.json must expose activation checklist API coverage.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:production-activation-checklist-api/,
  'test:contracts must include activation checklist API coverage.',
);

console.log('production activation checklist API tests passed');
