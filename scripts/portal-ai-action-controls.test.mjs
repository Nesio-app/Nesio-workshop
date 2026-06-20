import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const componentPath = path.join(root, 'components', 'portal', 'PortalAiFriendsPreview.tsx');
const component = fs.readFileSync(componentPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function functionBody(name) {
  const match = component.match(new RegExp(`const ${name} = \\(.*?\\) => \\{([\\s\\S]*?)\\n  \\};`));
  assert.ok(match, `Expected ${name} handler to exist.`);
  return match[1];
}

function buttonBlockByLabel(label) {
  const blocks = component.match(/<button\b[\s\S]*?<\/button>/g) || [];
  const block = blocks.find((candidate) => candidate.includes(`aria-label="${label}"`));
  assert.ok(block, `Expected button with aria-label="${label}".`);
  return block;
}

const openConversationList = functionBody('openConversationList');
for (const required of [
  'setSurface(\'chat\')',
  'setAttachmentTrayOpen(false)',
  'setSearchToolsOpen(false)',
  'setCallSheetOpen(false)',
  'setAudioCallOpen(false)',
  'setVideoCallOpen(false)',
  'setConversationListOpen(true)',
]) {
  assert.match(openConversationList, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `openConversationList must call ${required}.`);
}

const chatListButton = buttonBlockByLabel('打开对话列表');
assert.match(chatListButton, /aria-expanded=\{conversationListOpen\}/, 'Conversation list button must expose expanded state.');
assert.match(chatListButton, /aria-controls="portal-ai-conversation-list"/, 'Conversation list button must point at its sheet.');
assert.match(chatListButton, /onClick=\{openConversationList\}/, 'Conversation list button must use the shared handler.');
assert.match(chatListButton, /data-runtime-action="ai-open-conversation-list"/, 'Conversation list button must expose a traceable runtime action.');

assert.match(
  component,
  /id="portal-ai-conversation-list"[\s\S]*className="portal-ai-conversation-sheet"/,
  'Conversation list sheet must have a stable id for the trigger.',
);

const mentionButton = buttonBlockByLabel('@ 调度');
assert.match(mentionButton, /aria-expanded=\{mentionOptions\.length > 0\}/, '@ button must expose whether mention candidates are visible.');
assert.match(mentionButton, /aria-controls="portal-ai-mention-menu"/, '@ button must point at mention candidates.');
assert.match(mentionButton, /data-runtime-action="ai-open-mention-menu"/, '@ button must expose a traceable runtime action.');
assert.match(
  component,
  /id="portal-ai-mention-menu"[\s\S]*className="portal-ai-mention-menu"/,
  'Mention candidates must have a stable id for the @ trigger.',
);

const audioButton = buttonBlockByLabel('语音输入');
assert.match(audioButton, /aria-expanded=\{audioCallOpen\}/, 'Voice button must expose audio call state.');
assert.match(audioButton, /onClick=\{openAudioCall\}/, 'Voice button must open the audio call flow.');
assert.match(audioButton, /data-runtime-action="ai-open-audio-call"/, 'Voice button must expose a traceable runtime action.');

const callButton = buttonBlockByLabel('通话');
assert.match(callButton, /aria-expanded=\{callSheetOpen \|\| videoCallOpen \|\| audioCallOpen\}/, 'Call button must expose live call state.');
assert.match(callButton, /onClick=\{openCallSheet\}/, 'Call button must open live call options.');
assert.match(callButton, /data-runtime-action="ai-open-live-call"/, 'Call button must expose a traceable runtime action.');

const searchButton = buttonBlockByLabel('搜索');
assert.match(searchButton, /data-runtime-action="ai-open-search"/, 'Search button must expose a traceable runtime action.');

const attachmentButton = buttonBlockByLabel('添加附件');
assert.match(attachmentButton, /data-runtime-action="ai-open-attachment-tray"/, 'Attachment button must expose a traceable runtime action.');

assert.match(
  component,
  /data-runtime-action=\{`ai-search-shortcut-\$\{shortcut\.action\}`\}/,
  'Search shortcut buttons must expose traceable runtime actions per shortcut.',
);

assert.match(
  component,
  /data-runtime-action=\{`ai-select-conversation-\$\{item\.id\}`\}/,
  'Conversation rows must expose traceable runtime actions per conversation.',
);

assert.match(
  component,
  /data-runtime-action=\{`ai-insert-mention-\$\{target\.key\}`\}/,
  'Mention options must expose traceable runtime actions per target.',
);

assert.match(
  component,
  /data-runtime-action=\{`ai-capability-\$\{capability\.id\}`\}/,
  'Capability rail buttons must expose traceable runtime actions per capability.',
);

assert.equal(
  pkg.scripts['test:portal-ai-action-controls'],
  'node scripts/portal-ai-action-controls.test.mjs',
  'package.json must expose test:portal-ai-action-controls.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:portal-ai-action-controls/,
  'test:contracts must include test:portal-ai-action-controls.',
);

console.log('portal-ai-action-controls checks passed');
