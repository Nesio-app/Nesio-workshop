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

function buttonBlockByRuntimeAction(action) {
  const blocks = component.match(/<button\b[\s\S]*?<\/button>/g) || [];
  const block = blocks.find((candidate) => candidate.includes(`data-runtime-action="${action}"`));
  assert.ok(block, `Expected button with data-runtime-action="${action}".`);
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

const chatListButton = buttonBlockByRuntimeAction('ai-open-conversation-list');
assert.match(chatListButton, /aria-expanded=\{conversationListOpen\}/, 'Conversation list button must expose expanded state.');
assert.match(chatListButton, /aria-controls="portal-ai-conversation-list"/, 'Conversation list button must point at its sheet.');
assert.match(chatListButton, /onClick=\{openConversationList\}/, 'Conversation list button must use the shared handler.');
assert.match(chatListButton, /data-runtime-action="ai-open-conversation-list"/, 'Conversation list button must expose a traceable runtime action.');

assert.match(
  component,
  /id="portal-ai-conversation-list"[\s\S]*className="portal-ai-conversation-sheet"/,
  'Conversation list sheet must have a stable id for the trigger.',
);

const mentionButton = buttonBlockByRuntimeAction('ai-open-mention-menu');
assert.match(mentionButton, /aria-expanded=\{mentionOptions\.length > 0\}/, '@ button must expose whether mention candidates are visible.');
assert.match(mentionButton, /aria-controls="portal-ai-mention-menu"/, '@ button must point at mention candidates.');
assert.match(mentionButton, /data-runtime-action="ai-open-mention-menu"/, '@ button must expose a traceable runtime action.');
assert.match(
  component,
  /id="portal-ai-mention-menu"[\s\S]*className="portal-ai-mention-menu"/,
  'Mention candidates must have a stable id for the @ trigger.',
);

const searchButton = buttonBlockByRuntimeAction('ai-open-search');
assert.match(searchButton, /data-runtime-action="ai-open-search"/, 'Search button must expose a traceable runtime action.');

const attachmentButton = buttonBlockByRuntimeAction('ai-open-attachment-tray');
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

assert.match(
  component,
  /id:\s*'audio'[\s\S]*id:\s*'live'/,
  'Voice and live controls must stay available through the plus capability rail.',
);

assert.match(
  component,
  /case 'audio':[\s\S]*openAudioCall\(\);[\s\S]*case 'live':[\s\S]*openCallSheet\(\);/,
  'Plus capability rail must dispatch audio and live actions to the shared call handlers.',
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
