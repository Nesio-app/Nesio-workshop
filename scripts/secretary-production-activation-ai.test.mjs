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
  route,
  /createSecretaryAiAuditId/,
  'secretary chat route must create a per-request audit id for production AI calls',
);
assert.match(
  route,
  /secretary_ai_request/,
  'secretary chat route must log a redacted AI request audit event',
);
assert.match(
  route,
  /secretary_ai_failure/,
  'secretary chat route must log a redacted AI failure audit event',
);
assert.match(
  route,
  /auditId/,
  'secretary chat responses must include an auditId for support/debug correlation',
);
assert.doesNotMatch(
  route,
  /DEFAULT_MODELS\s*=\s*['"][^'"]*gemini-1\./,
  'secretary Gemini defaults must not include retired Gemini 1.x models',
);
assert.match(
  route,
  /getGeminiModelCandidates/,
  'secretary chat route must normalize Gemini model candidates before production calls',
);
assert.match(
  route,
  /isRetiredGeminiModel/,
  'secretary chat route must filter retired Gemini model ids from env/default candidates',
);
assert.match(
  route,
  /gemini-flash-latest/,
  'secretary Gemini fallback must include the current Flash latest alias',
);
assert.doesNotMatch(
  route,
  /console\.(?:info|warn|error)\([^\n]*(?:key|apiKey|Authorization|Bearer)/,
  'secretary AI audit logs must not print API keys or Authorization headers',
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
assert.match(
  healthRoute,
  /providerMatrix/,
  'secretary health route must expose providerMatrix for AI provider routing diagnostics',
);
assert.match(
  healthRoute,
  /secretary-ai-prompt-catalog\.mjs/,
  'secretary health route must import model labels from the shared prompt catalog',
);
assert.doesNotMatch(
  healthRoute,
  /label:\s*'豆包'/,
  'secretary health route must not own localized provider labels directly',
);
assert.match(
  healthRoute,
  /fallbackProvider/,
  'secretary health route must explain Gemini compatibility fallback for providers without native keys',
);
assert.match(
  healthRoute,
  /chatEndpoint:\s*'\/api\/secretary\/chat'/,
  'secretary health route must expose the real chat endpoint used by all AI friends',
);
assert.match(
  healthRoute,
  /const defaultProvider = gemini \? 'gemini' : chatgpt \? 'chatgpt' : claude \? 'claude' : doubao \? 'doubao' : null;/,
  'secretary health route must expose a default provider derived from configured keys',
);

console.log('secretary production activation AI tests passed');
