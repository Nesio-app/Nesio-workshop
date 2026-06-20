import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const launchSafety = read('lib/portal/launch-safety.ts');
const middleware = read('middleware.ts');
const route = read('app/api/secretary/chat/route.ts');
const healthRoute = read('app/api/secretary/health/route.ts');

assert.match(
  launchSafety,
  /isProductionActivationAiRuntimeEnabled/,
  'launch safety must expose production AI runtime gate',
);
assert.match(
  launchSafety,
  /isSecretaryAiRequestAllowed/,
  'launch safety must combine personal lab and production activation gates',
);
assert.match(
  launchSafety,
  /BAOHE_AI_PROVIDER_MODE[\s\S]{0,120}production/,
  'production AI runtime gate must require BAOHE_AI_PROVIDER_MODE=production',
);
assert.match(
  launchSafety,
  /OPENAI_API_KEY|GEMINI_API_KEY|DOUBAO_KEY/,
  'production AI runtime gate must require at least one provider key',
);
assert.match(
  launchSafety,
  /ANTHROPIC_API_KEY|CLAUDE_API_KEY/,
  'production AI runtime gate must accept Anthropic/Claude provider keys',
);
assert.match(
  middleware,
  /isSecretaryAiRequestAllowed/,
  'middleware must use the combined secretary AI gate',
);
assert.match(
  middleware,
  /pathname === ['"]\/api\/secretary\/health['"][\s\S]{0,160}NextResponse\.next/,
  'secretary health endpoint must bypass middleware so it can report readiness diagnostics',
);
assert.doesNotMatch(
  middleware,
  /pathname\.startsWith\('\/api\/secretary'\) && isPersonalLabAiRequestAllowed/,
  'middleware must not be personal-lab-only for secretary API',
);
assert.match(
  route,
  /isSecretaryAiRequestAllowed/,
  'secretary chat route must use combined secretary AI gate',
);
assert.match(
  healthRoute,
  /isSecretaryAiRequestAllowed/,
  'secretary health route must report through the combined gate',
);
assert.match(
  healthRoute,
  /productionActivation/,
  'secretary health route must expose production activation readiness',
);

console.log('secretary production activation AI tests passed');
