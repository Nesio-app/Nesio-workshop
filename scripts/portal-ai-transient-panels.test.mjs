import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const component = fs.readFileSync(path.join(root, 'components', 'portal', 'PortalAiFriendsPreview.tsx'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function functionBody(name) {
  const match = component.match(new RegExp(`const ${name} = \\(.*?\\) => \\{([\\s\\S]*?)\\n  \\};`));
  assert.ok(match, `Expected ${name} handler to exist.`);
  return match[1];
}

const openMentionMenu = functionBody('openMentionMenu');
assert.match(
  openMentionMenu,
  /setAttachmentTrayOpen\(false\)/,
  '@ menu must close the attachment rail so recent @ targets are visible.',
);
assert.match(
  openMentionMenu,
  /setConversationListOpen\(false\)/,
  '@ menu must close the conversation list before showing mention candidates.',
);

const openAttachmentTray = functionBody('openAttachmentTray');
assert.match(
  openAttachmentTray,
  /setConversationListOpen\(false\)/,
  'Attachment rail must close the conversation list before opening.',
);
assert.match(
  openAttachmentTray,
  /setCallSheetOpen\(false\)/,
  'Attachment rail must close call options before opening.',
);

const openCallSheet = functionBody('openCallSheet');
assert.match(
  openCallSheet,
  /setAttachmentTrayOpen\(false\)/,
  'Opening live call options must close the attachment rail.',
);
assert.match(
  openCallSheet,
  /setConversationListOpen\(false\)/,
  'Opening live call options must close the conversation list.',
);
assert.match(
  component,
  /aria-label=\{t\(locale, 'aiFriendsCall'\)\}[\s\S]*onClick=\{openCallSheet\}/,
  'The composer call button must use the shared openCallSheet handler.',
);

const openAudioCall = functionBody('openAudioCall');
assert.match(
  openAudioCall,
  /setAttachmentTrayOpen\(false\)/,
  'Opening voice call must close the attachment rail.',
);
assert.match(
  component,
  /aria-label=\{t\(locale, 'aiFriendsVoiceInput'\)\}[\s\S]*onClick=\{openAudioCall\}/,
  'The composer voice button must use the shared openAudioCall handler.',
);

assert.equal(
  pkg.scripts['test:portal-ai-transient-panels'],
  'node scripts/portal-ai-transient-panels.test.mjs',
  'package.json must expose test:portal-ai-transient-panels.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:portal-ai-transient-panels/,
  'test:contracts must include test:portal-ai-transient-panels.',
);

console.log('portal-ai-transient-panels checks passed');
