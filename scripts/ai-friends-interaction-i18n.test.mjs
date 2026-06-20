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
  'aiFriendsCallSheetTitle',
  'aiFriendsVideoCallTitle',
  'aiFriendsVideoCallSubtitle',
  'aiFriendsAudioCallTitle',
  'aiFriendsAudioCallSubtitle',
  'aiFriendsAudioConnecting',
  'aiFriendsVideoConnecting',
  'aiFriendsEndCall',
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
  'Live 通话',
  '和智友面对面，实时回应',
  '语音实时对话，解放双手',
  '正在连接实时语音通话',
  '正在连接智友虚拟形象',
]) {
  assert(!aiFriends.includes(forbidden), `PortalAiFriendsPreview still contains hard-coded interaction text: ${forbidden}`);
}

assert(
  pkg.scripts['test:ai-friends-interaction-i18n'] === 'node scripts/ai-friends-interaction-i18n.test.mjs',
  'package.json must expose test:ai-friends-interaction-i18n.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:ai-friends-interaction-i18n'),
  'test:contracts must include test:ai-friends-interaction-i18n.',
);

console.log('ai-friends-interaction-i18n checks passed');
