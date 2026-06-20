import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const launchSafety = read('lib/portal/launch-safety.ts');
const middleware = read('middleware.ts');
const route = read('app/api/secretary/chat/route.ts');
const portal = read('components/portal/Portal.tsx');
const secretaryIndex = read('public/secretary/index.html');
const secretaryChat = read('public/secretary/chat.js');
const secretaryApi = read('public/secretary/api.js');
const personalLabGateBody = launchSafety.match(
  /export function isPersonalLabAiRequestAllowed[\s\S]*?\n}\n/,
)?.[0] || '';

assert.match(launchSafety, /BAOHE_PERSONAL_LAB_AI_ENABLED/, 'personal lab AI must keep an explicit env override gate');
assert.match(
  personalLabGateBody,
  /hasPersonalLabAccessMarker\(request\)[\s\S]*hasProductionAiProviderKey\(\)/,
  'personal lab AI must also open when an explicit personal_lab request has a configured provider key.',
);
assert.match(launchSafety, /isPersonalLabAiRequestAllowed/, 'personal lab AI request helper must exist');
assert.match(launchSafety, /isSecretaryAiRequestAllowed/, 'secretary AI must support a combined lab-or-production gate');
assert.match(launchSafety, /isSecretaryPageRequestAllowed/, 'secretary page must have a separate explicit lab page gate');
assert.match(launchSafety, /x-baohe-access-mode/, 'personal lab AI must require an explicit access-mode header');
assert.match(launchSafety, /baohe_personal_lab=1/, 'secretary page lab access must support a scoped cookie for static assets');

assert.match(middleware, /isSecretaryAiRequestAllowed/, 'middleware must let approved secretary AI requests reach route handlers');
assert.match(middleware, /isSecretaryPageRequestAllowed/, 'middleware must use a separate secretary page gate');
assert.match(middleware, /pathname\.startsWith\('\/api\/secretary'\)/, 'middleware allowance must stay scoped to secretary API');
const secretaryAllowBlock = middleware.match(
  /if \(\s*[\s\S]*?isSecretaryAiRequestAllowed\(request\)[\s\S]*?\)\s*\{\s*return NextResponse\.next\(\);\s*\}/,
)?.[0] || '';
assert.match(
  secretaryAllowBlock,
  /pathname\.startsWith\('\/api\/secretary'\)/,
  'approved secretary AI runtime must only bypass isolation for API route handlers.',
);
assert.doesNotMatch(
  secretaryAllowBlock,
  /pathname\.startsWith\('\/secretary'\)/,
  'approved secretary AI runtime must not expose the public /secretary page bundle through the API gate.',
);

const secretaryPageAllowBlock = middleware.match(
  /if \(\s*pathname\.startsWith\('\/secretary'\) &&\s*isSecretaryPageRequestAllowed\(request\)\s*\) \{[\s\S]*?return response;\s*\}/,
)?.[0] || '';
assert.match(
  secretaryPageAllowBlock,
  /pathname\.startsWith\('\/secretary'\)/,
  'secretary page bundle may only bypass isolation through the explicit page gate.',
);
assert.match(
  secretaryPageAllowBlock,
  /baohe_personal_lab/,
  'secretary page gate must persist only a scoped personal lab cookie.',
);
assert.match(
  secretaryPageAllowBlock,
  /\/secretary\/index\.html/,
  'secretary page gate must rewrite the lab list route to its static index only after explicit gate approval.',
);
assert.doesNotMatch(
  secretaryPageAllowBlock,
  /pathname\.startsWith\('\/api\/secretary'\)/,
  'secretary page gate must not control secretary API route execution.',
);

assert.match(route, /isSecretaryAiRequestAllowed/, 'secretary chat route must check the combined secretary AI gate');
assert.match(route, /launchUnavailablePayload\('api:secretary:chat'/, 'secretary chat must still fail closed by default');

assert.doesNotMatch(portal, /PortalQuickChat/, 'public home portal must not mount secretary quick chat');
assert.doesNotMatch(
  middleware.replace(secretaryPageAllowBlock, ''),
  /pathname === ['"]\/secretary['"][\s\S]{0,160}\/secretary\/index\.html/,
  'middleware must not expose /secretary static page outside the explicit lab page gate.',
);
assert.match(secretaryIndex, /list\.js/, 'secretary app list page must be present');
assert.match(secretaryChat, /sendSecretaryMessage/, 'secretary chat page must call API helper');
assert.match(secretaryApi, /\/api\/secretary\/chat/, 'secretary app must call secretary chat API');
assert.match(secretaryApi, /x-baohe-access-mode/, 'secretary app must send personal lab access header');
assert.match(secretaryApi, /personal_lab/, 'secretary app must be scoped to personal lab mode');
assert.match(secretaryChat, /gemini|openai|doubao|claude/, 'secretary app must expose provider routing');
assert.match(route, /modelId === 'claude'|modelId === 'anthropic'/, 'secretary chat route must branch Claude/Anthropic separately');
assert.match(route, /ANTHROPIC_API_KEY|CLAUDE_API_KEY/, 'secretary chat route must support Claude provider env names without hard-coding secrets');

console.log('secretary personal lab AI tests passed');
