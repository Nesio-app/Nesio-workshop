import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const aiFriendsPath = join(root, 'components', 'portal', 'PortalAiFriendsPreview.tsx');
const i18nPath = join(root, 'lib', 'portal', 'i18n.ts');
const packagePath = join(root, 'package.json');

const aiFriends = readFileSync(aiFriendsPath, 'utf8');
const i18n = readFileSync(i18nPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredKeys = [
  'aiFriendsStatusChecking',
  'aiFriendsStatusEnabledNoKeys',
  'aiFriendsStatusRuntimeOff',
  'aiFriendsStatusCheckFailed',
  'aiFriendsNewThreadNotice',
  'aiFriendsConversationSwitchedTemplate',
  'aiFriendsAttachmentTrayNotice',
  'aiFriendsLocalAttachmentTemplate',
  'aiFriendsFlomoIntentNotice',
  'aiFriendsCalendarIntentNotice',
  'aiFriendsRecommendationIntentNotice',
  'aiFriendsInventoryIntentNotice',
  'aiFriendsExpenseIntentNotice',
  'aiFriendsTodoIntentNotice',
  'aiFriendsImageIntentNotice',
  'aiFriendsFileIntentNotice',
  'aiFriendsLiveIntentNotice',
  'aiFriendsBusyNotice',
  'aiFriendsEmptyMessageNotice',
  'aiFriendsSearchPlaceholder',
  'aiFriendsComposerHint',
  'aiFriendsComposerPlaceholder',
  'aiFriendsConversationListTitle',
  'aiFriendsTitle',
  'aiFriendsSearchTitle',
  'aiFriendsSearchAriaLabel',
  'aiFriendsBackToChat',
  'aiFriendsNewConversation',
  'aiFriendsSearchCategoriesLabel',
  'aiFriendsRecentConversationsLabel',
  'aiFriendsOpenSearch',
  'aiFriendsOpenConversationList',
  'aiFriendsThreadLabel',
  'aiFriendsCapabilityRailLabel',
  'aiFriendsAddAttachment',
  'aiFriendsMentionDispatch',
  'aiFriendsInputLabel',
  'aiFriendsVoiceInput',
  'aiFriendsCall',
  'aiFriendsMentionMenuLabel',
  'aiFriendsConversationListAriaLabel',
  'aiFriendsCloseConversationList',
  'aiFriendsCloseCallOptions',
  'aiFriendsCallSheetTitle',
  'aiFriendsVideoCallTitle',
  'aiFriendsVideoCallSubtitle',
  'aiFriendsAudioCallTitle',
  'aiFriendsAudioCallSubtitle',
  'aiFriendsAudioConnecting',
  'aiFriendsVideoConnecting',
  'aiFriendsEndCall',
  'aiFriendsCapabilityImage',
  'aiFriendsCapabilityFile',
  'aiFriendsCapabilityAudio',
  'aiFriendsCapabilityLive',
  'aiFriendsCapabilityNote',
  'aiFriendsSearchDate',
  'aiFriendsSearchAiSuggestion',
  'aiFriendsSearchNote',
  'aiFriendsSearchInventory',
  'aiFriendsSearchExpense',
  'aiFriendsSearchTodo',
  'aiFriendsSearchImage',
  'aiFriendsSearchCall',
  'aiFriendsSearchFile',
  'aiFriendsMentionClaudeDescription',
  'aiFriendsMentionChatGptDescription',
  'aiFriendsMentionGeminiDescription',
  'aiFriendsMentionFlomoDescription',
  'aiFriendsMentionInventoryDescription',
  'aiFriendsMentionInventoryLabel',
  'aiFriendsRecentSmartTitle',
  'aiFriendsRecentSmartTag',
  'aiFriendsRecentSmartPreview',
  'aiFriendsRecentGroupTitle',
  'aiFriendsRecentGroupTag',
  'aiFriendsRecentGroupPreview',
  'aiFriendsRecentClaudePreview',
  'aiFriendsRecentChatGptPreview',
  'aiFriendsRecentGeminiPreview',
  'aiFriendsRecentYesterday',
  'aiFriendsDemoUserGiftRequest',
  'aiFriendsDemoThreadNote',
  'aiFriendsDemoAssistantGiftPrefix',
  'aiFriendsDemoAssistantGiftAlbum',
  'aiFriendsDemoAssistantGiftMiddle',
  'aiFriendsDemoAssistantGiftSkincare',
  'aiFriendsDemoAssistantGiftSuffix',
  'aiFriendsDemoFlomoRequest',
  'aiFriendsDemoFlomoSaved',
  'aiFriendsDemoGeminiRequest',
  'aiFriendsDemoGeminiAnswer',
  'aiFriendsLocalFlomoAttachment',
  'aiFriendsImageAttachmentKind',
  'aiFriendsFileAttachmentKind',
  'aiFriendsProvidersAvailableTemplate',
  'aiFriendsProviderDoubaoLabel',
  'aiFriendsProviderDoubaoAvatar',
  'aiFriendsCalendarComposerIntent',
  'aiFriendsInventoryComposerIntent',
  'aiFriendsExpenseComposerIntent',
  'aiFriendsTodoComposerIntent',
];

for (const key of requiredKeys) {
  assert(i18n.includes(`${key}:`), `Expected i18n key ${key}.`);
}

for (const forbidden of [
  '正在检查智友 AI 连接...',
  '智友通道已打开，但还没有检测到可用 AI Key',
  '智友 AI 尚未通过运行时开关',
  '智友 AI 连接检查失败',
  '已新建一条集合对话，可以直接 @AI 或 @工具。',
  '可以继续输入或 @ 拉入其他 AI。',
  '图片、文件、语音会先作为本地意图保留；真实上传与外部授权后续再开。',
  '已作为本地意图加入；真实上传后续单独授权。',
  '已准备 Flomo 笔记意图，发送后会进入本地 mock 记录。',
  '已准备日期与日程咨询。',
  '已切到 AI 建议输入。',
  '已准备物品库记录意图。',
  '已准备支出记录意图。',
  '已准备待办记录意图。',
  '请选择图片，当前先保留为本地意图。',
  '请选择文件，当前先保留为本地意图。',
  '已打开实时通话选项。',
  '正在连接中，上一条消息还在路上。',
  '先写一句想问智友的话，或用 @ 拉入一个 AI。',
  '搜索对话、笔记、AI 建议...',
  '输入框搞定一切： @AI 拉它进来 · @Flomo 存笔记 · @物品库 记物品',
  '发消息给智友...',
  '所有 AI 对话',
  'aria-label="智友"',
  'aria-label="智友搜索"',
  '<h1>搜索</h1>',
  '返回智友',
  'aria-label="新建对话"',
  'aria-label="搜索分类"',
  'aria-label="最近对话"',
  '<h2>最近对话</h2>',
  '<h1>智友</h1>',
  'aria-label="搜索"',
  'aria-label="打开对话列表"',
  'aria-label="集合对话"',
  'aria-label="智友快捷能力"',
  'aria-label="添加附件"',
  'aria-label="@ 调度"',
  'aria-label="智友集合输入框"',
  'aria-label="语音输入"',
  'aria-label="通话"',
  'aria-label="@ 调度候选"',
  'aria-label="AI 对话列表"',
  'aria-label="关闭 AI 对话列表"',
  'aria-label="关闭通话选项"',
  'Live 通话',
  '和智友面对面，实时回应',
  '语音实时对话，解放双手',
  '正在连接实时语音通话',
  '正在连接智友虚拟形象',
  "label: '图片'",
  "label: '文件'",
  "label: '语音'",
  "label: '实时'",
  "label: '笔记'",
  "description: '长文推理 / 方案拆解'",
  "description: '写作推理 / 日常助手'",
  "description: '多模态 / 实时信息'",
  "description: '保存为笔记'",
  "description: '记一个物品 / 查到期'",
  "label: '@物品库'",
  "title: '智友'",
  "tag: '智能调度'",
  "preview: '综合建议：定制相册配手写卡片最暖心...'",
  "title: '产品脑暴群'",
  "tag: '群聊'",
  "preview: 'Claude、ChatGPT、Gemini：3 个 AI 正在讨论方案...'",
  "preview: '可以考虑定制相册，附上手写信，300 元内...'",
  "preview: '护肤礼盒很受欢迎，兰蔻套装 300 元左右...'",
  "preview: '300 元做定制相册很充裕，加急运费留 50...'",
  "time: '昨天'",
  '帮我想个送妈妈的生日礼物，预算 300',
  '已综合 Claude · ChatGPT 的回答',
  '综合建议：',
  '定制相册',
  '护肤礼盒',
  '慢慢看，要我帮你比价吗？',
  '@Flomo 周五前买好牛奶',
  '收到～',
  '已记入 Flomo 笔记序列',
  '@Gemini 你怎么看这个礼物预算？',
  '300 元做定制相册很充裕，建议留 50 元加急运费，确保 5 天内到。',
  "'笔记：将本条保存到 Flomo'",
  "addLocalAttachment('图片'",
  "addLocalAttachment('文件'",
  '📞<span>通话</span>',
  "return `${configuredProviders.join(' / ')} 可用`",
  "setComposer('@Gemini 帮我看今天接下来最重要的安排。')",
  "setComposer('@物品库 记一个物品：')",
  "setComposer('@豆包 记录一笔支出：')",
  "setComposer('@Flomo 待办：')",
  "['🗓', '日期']",
  "['✦', 'AI 建议']",
  "['📝', '笔记']",
  "['📦', '物品']",
  "['💰', '支出']",
  "['✅', '待办']",
  "['📷', '图片']",
  "['📞', '通话']",
  "['📎', '文件']",
]) {
  assert(!aiFriends.includes(forbidden), `PortalAiFriendsPreview still contains hard-coded interaction text: ${forbidden}`);
}

assert(
  aiFriends.includes('labelKey: PortalStringKey'),
  'AI capability labels must use PortalStringKey.',
);

assert(
  aiFriends.includes('descriptionKey: PortalStringKey'),
  'Mention target descriptions must use PortalStringKey.',
);

assert(
  aiFriends.includes('labelKey: PortalStringKey'),
  'Mention target labels must use PortalStringKey.',
);

assert(
  aiFriends.includes("t(locale, item.titleKey)") &&
    aiFriends.includes("t(locale, item.previewKey)") &&
    aiFriends.includes("item.tagKey ? <small>{t(locale, item.tagKey)}</small> : null"),
  'Recent AI conversations must render title/tag/preview through i18n.',
);

assert(
  aiFriends.includes("t(locale, 'aiFriendsDemoUserGiftRequest')") &&
    aiFriends.includes("t(locale, 'aiFriendsDemoGeminiAnswer')"),
  'Default AI friend demo thread must render through i18n.',
);

assert(
  aiFriends.includes('type SearchShortcutAction'),
  'Search shortcuts must use stable action ids instead of localized labels.',
);

assert(
  pkg.scripts['test:ai-friends-interaction-i18n'] === 'node scripts/ai-friends-interaction-i18n.test.mjs',
  'package.json must expose test:ai-friends-interaction-i18n.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:ai-friends-interaction-i18n'),
  'test:contracts must include test:ai-friends-interaction-i18n.',
);

console.log('ai-friends-interaction-i18n checks passed');
