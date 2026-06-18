import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const launchSafety = read('lib/portal/launch-safety.ts');
const middleware = read('middleware.ts');
const route = read('app/api/secretary/chat/route.ts');
const portal = read('components/portal/Portal.tsx');
const quickChat = read('components/portal/PortalQuickChat.tsx');
const secretaryIndex = read('public/secretary/index.html');
const secretaryChat = read('public/secretary/chat.js');
const secretaryApi = read('public/secretary/api.js');

assert.match(launchSafety, /BAOHE_PERSONAL_LAB_AI_ENABLED/, 'personal lab AI must be env-gated');
assert.match(launchSafety, /isPersonalLabAiRequestAllowed/, 'personal lab AI request helper must exist');
assert.match(launchSafety, /x-baohe-access-mode/, 'personal lab AI must require an explicit access-mode header');

assert.match(middleware, /isPersonalLabAiRequestAllowed/, 'middleware must let approved personal lab AI requests reach route handlers');
assert.match(middleware, /pathname\.startsWith\('\/api\/secretary'\)/, 'middleware allowance must stay scoped to secretary API');

assert.match(route, /isPersonalLabAiRequestAllowed/, 'secretary chat route must check personal lab AI gate');
assert.match(route, /launchUnavailablePayload\('api:secretary:chat'/, 'secretary chat must still fail closed by default');

assert.match(portal, /PortalQuickChat/, 'home portal must mount quick chat');
assert.match(quickChat, /\/secretary/, 'home quick chat must link to the secretary app');
assert.match(quickChat, /\/secretary\/chat\?friend=gemini/, 'home quick chat must deep-link to Gemini chat');
assert.match(secretaryIndex, /list\.js/, 'secretary app list page must be present');
assert.match(secretaryChat, /sendSecretaryMessage/, 'secretary chat page must call API helper');
assert.match(secretaryApi, /\/api\/secretary\/chat/, 'secretary app must call secretary chat API');
assert.match(secretaryApi, /x-baohe-access-mode/, 'secretary app must send personal lab access header');
assert.match(secretaryApi, /personal_lab/, 'secretary app must be scoped to personal lab mode');
assert.match(secretaryChat, /gemini|openai|doubao/, 'secretary app must expose provider routing');

console.log('secretary personal lab AI tests passed');
