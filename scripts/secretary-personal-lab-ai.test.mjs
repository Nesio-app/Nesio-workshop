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

assert.match(launchSafety, /BAOHE_PERSONAL_LAB_AI_ENABLED/, 'personal lab AI must be env-gated');
assert.match(launchSafety, /isPersonalLabAiRequestAllowed/, 'personal lab AI request helper must exist');
assert.match(launchSafety, /x-baohe-access-mode/, 'personal lab AI must require an explicit access-mode header');

assert.match(middleware, /isPersonalLabAiRequestAllowed/, 'middleware must let approved personal lab AI requests reach route handlers');
assert.match(middleware, /pathname\.startsWith\('\/api\/secretary'\)/, 'middleware allowance must stay scoped to secretary API');

assert.match(route, /isPersonalLabAiRequestAllowed/, 'secretary chat route must check personal lab AI gate');
assert.match(route, /launchUnavailablePayload\('api:secretary:chat'/, 'secretary chat must still fail closed by default');

assert.match(portal, /PortalQuickChat/, 'home portal must mount quick chat');
assert.match(quickChat, /\/api\/secretary\/chat/, 'quick chat must call secretary chat API');
assert.match(quickChat, /x-baohe-access-mode/, 'quick chat must send personal lab access header');
assert.match(quickChat, /personal_lab/, 'quick chat must be scoped to personal lab mode');
assert.match(quickChat, /chatgpt|openai|gemini|doubao/, 'quick chat must expose provider selection for lab AI checks');

console.log('secretary personal lab AI tests passed');
