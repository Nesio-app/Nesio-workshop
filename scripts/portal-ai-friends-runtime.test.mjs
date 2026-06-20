import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const componentPath = join(root, 'components/portal/PortalAiFriendsPreview.tsx');
const packagePath = join(root, 'package.json');

const component = readFileSync(componentPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  component.includes("createAppApiClient") && component.includes("sendSecretaryMessage"),
  'PortalAiFriendsPreview must send composer messages through the Secretary Chat API client.',
);

assert(
  component.includes("type SecretaryChatTurn") && component.includes("runtimeMessages"),
  'PortalAiFriendsPreview must keep runtime chat history for provider context and UI feedback.',
);

assert(
  /provider:\s*resolveSecretaryProvider\(composer\)/.test(component),
  'PortalAiFriendsPreview must resolve provider from @mentions before calling Secretary Chat.',
);

assert(
  component.includes("aiSending") && component.includes("onKeyDown"),
  'PortalAiFriendsPreview composer must expose sending state and Enter-to-send behavior.',
);

assert(
  component.includes("handleSearchShortcut") && /searchShortcuts\.map[\s\S]*onClick=\{\(\) => handleSearchShortcut\(label\)\}/.test(component),
  'PortalAiFriendsPreview search shortcut buttons must perform real actions instead of being inert.',
);

assert(
  /case '图片'[\s\S]*imageInputRef\.current\?\.click\(\)/.test(component) &&
    /case '文件'[\s\S]*fileInputRef\.current\?\.click\(\)/.test(component) &&
    /case '通话'[\s\S]*setCallSheetOpen\(true\)/.test(component),
  'PortalAiFriendsPreview search shortcuts must wire image, file, and call actions.',
);

assert(
  component.includes("activeConversationId") &&
    component.includes("setActiveConversationId") &&
    component.includes("selectConversation") &&
    /recentConversations\.map[\s\S]*onClick=\{\(\) => selectConversation\(item\)\}/.test(component),
  'PortalAiFriendsPreview recent conversation rows must select a real active conversation instead of only showing a notice.',
);

assert(
  /case 'claude'[\s\S]*@Claude/.test(component) &&
    /case 'chatgpt'[\s\S]*@ChatGPT/.test(component) &&
    /case 'gemini'[\s\S]*@Gemini/.test(component) &&
    /case 'group'[\s\S]*@Claude @ChatGPT @Gemini/.test(component),
  'PortalAiFriendsPreview conversation selection must prepare the composer for the selected AI or group.',
);

assert(
  component.includes("aria-pressed={activeConversationId === item.id}") ||
    component.includes("portal-ai-recent-row--active"),
  'PortalAiFriendsPreview must expose active conversation state for accessibility and QA.',
);

assert(
  component.includes("result.error") && component.includes("result.detail"),
  'PortalAiFriendsPreview must surface Secretary Chat API errors instead of failing silently.',
);

assert(
  pkg.scripts['test:portal-ai-friends-runtime'] === 'node scripts/portal-ai-friends-runtime.test.mjs',
  'package.json must expose test:portal-ai-friends-runtime.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:portal-ai-friends-runtime'),
  'test:contracts must include portal AI friends runtime coverage.',
);

console.log('portal-ai-friends-runtime checks passed');
