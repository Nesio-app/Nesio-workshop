import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const componentPath = join(root, 'components/portal/PortalAiFriendsPreview.tsx');
const apiClientPath = join(root, 'lib/portal/app-api-client.ts');
const cssPath = join(root, 'app/globals.css');
const packagePath = join(root, 'package.json');

const component = readFileSync(componentPath, 'utf8');
const apiClient = readFileSync(apiClientPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
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
  component.includes("fetchSecretaryHealth") &&
    component.includes("aiRuntimeStatus") &&
    component.includes("secretaryHealth"),
  'PortalAiFriendsPreview must read Secretary AI runtime health with personal lab access before presenting live AI controls.',
);

assert(
  component.includes("fetchProductionRuntimeHealth") &&
    component.includes("productionRuntimeStatus") &&
    component.includes("aiProviderActionsById"),
  'PortalAiFriendsPreview must read production runtime providerActionMatrix before presenting AI provider actions.',
);

assert(
  /providerActionMatrix[\s\S]*category === 'ai'/.test(component) &&
    /provider\.actionStatus === 'ready'/.test(component),
  'PortalAiFriendsPreview must filter usable AI providers from providerActionMatrix readiness.',
);

assert(
  /const providerAction = aiProviderActionsById\[provider\]/.test(component) &&
    /providerAction\.startEndpoint !== '\/api\/secretary\/chat'/.test(component),
  'PortalAiFriendsPreview must verify selected AI provider routes through the Secretary Chat endpoint before sending.',
);

assert(
  apiClient.includes("secretaryHealth: '/api/secretary/health'") &&
    apiClient.includes("fetchSecretaryHealth") &&
    apiClient.includes("'x-baohe-access-mode': 'personal_lab'"),
  'App API client must expose Secretary health and send personal lab access for health diagnostics.',
);

assert(
  !component.includes("Mock Live"),
  'PortalAiFriendsPreview live call surfaces must not present AI runtime as mock once health diagnostics exist.',
);

assert(
  /configuredProviders[\s\S]*gemini[\s\S]*chatgpt[\s\S]*claude/.test(component) ||
    /secretaryHealth[\s\S]*gemini[\s\S]*secretaryHealth[\s\S]*chatgpt[\s\S]*secretaryHealth[\s\S]*claude/.test(component),
  'PortalAiFriendsPreview must surface configured AI providers from Secretary health.',
);

assert(
  /\.portal-ai-runtime-status\b/.test(css) &&
    /portal-ai-runtime-status[\s\S]*background:\s*var\(--glass-bg\)/.test(css),
  'PortalAiFriendsPreview runtime status must use the shared glass surface tokens.',
);

assert(
  component.includes("type SecretaryChatTurn") && component.includes("runtimeMessages"),
  'PortalAiFriendsPreview must keep runtime chat history for provider context and UI feedback.',
);

assert(
  /const provider = resolveSecretaryProvider\(composer\)/.test(component) &&
    /provider,\s*\n\s*message/.test(component),
  'PortalAiFriendsPreview must resolve provider from @mentions before calling Secretary Chat.',
);

assert(
  /normalized\.includes\('@claude'\)[\s\S]*return 'claude'/.test(component),
  'PortalAiFriendsPreview must route @Claude to the Claude provider instead of falling back to Gemini.',
);

assert(
  component.includes("aiSending") && component.includes("onKeyDown"),
  'PortalAiFriendsPreview composer must expose sending state and Enter-to-send behavior.',
);

assert(
  !component.includes('disabled={aiSending}'),
  'PortalAiFriendsPreview composer input must stay inspectable while sending instead of becoming a dead disabled control.',
);

assert(
  component.includes('正在连接中，上一条消息还在路上。'),
  'PortalAiFriendsPreview must explain repeat send attempts while a message is already sending.',
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
  component.includes("nesioAiIcons") &&
    component.includes("nesioToolIcons") &&
    component.includes("iconSrc") &&
    /import Image from 'next\/image'/.test(component) &&
    /<Image[\s\S]*src=\{item\.iconSrc\}[\s\S]*className="portal-ai-conversation-icon"/.test(component) &&
    /<Image[\s\S]*src=\{target\.iconSrc\}[\s\S]*className="portal-ai-mention-icon"/.test(component),
  'PortalAiFriendsPreview must render recent conversations and @mentions with Nesio design-system icon assets.',
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
  component.includes('id="portal-ai-capability-rail"') &&
    component.includes('aria-expanded={attachmentTrayOpen}') &&
    component.includes('aria-controls="portal-ai-capability-rail"'),
  'PortalAiFriendsPreview plus button must expose the attachment tray expanded/collapsed state.',
);

assert(
  /aria-label="语音输入"[\s\S]*aria-controls="portal-ai-audio-call"[\s\S]*setAudioCallOpen\(true\)/.test(component) &&
    /aria-label="通话"[\s\S]*aria-controls="portal-ai-call-sheet"[\s\S]*setCallSheetOpen\(true\)/.test(component),
  'PortalAiFriendsPreview voice and call buttons must point to real call surfaces.',
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
