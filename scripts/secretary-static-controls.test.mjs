import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const chatHtml = read('tools/secretary/chat.html');
const chatJs = read('tools/secretary/chat.js');
const chatCss = read('tools/secretary/styles.css');
const groupHtml = read('tools/secretary/group.html');
const groupJs = read('tools/secretary/group.js');
const attachJs = read('tools/secretary/attach.js');

for (const inertCopy of ['语音通话功能开发中', '视频功能开发中', '视频通话需 WebRTC 信令服务', '位置功能开发中']) {
  assert.doesNotMatch(
    chatJs,
    new RegExp(inertCopy),
    `Secretary chat controls must not fall back to inert "${inertCopy}" toasts.`,
  );
  assert.doesNotMatch(
    groupJs,
    new RegExp(inertCopy),
    `Secretary group controls must not fall back to inert "${inertCopy}" toasts.`,
  );
}

assert.doesNotMatch(
  attachJs,
  /即将上线/,
  'Secretary shared attachment sheet must not default missing handlers to inert coming-soon toasts.',
);
assert.match(
  attachJs,
  /function defaultAttachAction/,
  'Secretary shared attachment sheet must expose a default local action for every tool.',
);
assert.match(
  attachJs,
  /saveNoteEntry\('attachment_action'/,
  'Secretary shared attachment fallback must persist a local action record instead of dropping the click.',
);
assert.match(
  attachJs,
  /window\.WxCommon\?\.toast\(`已记录/,
  'Secretary shared attachment fallback must give immediate user feedback for handled clicks.',
);

for (const id of [
  'voiceCall',
  'voiceCallStatus',
  'voiceCallTranscript',
  'voiceCallAvatar',
  'voiceCallName',
  'voiceCallOrb',
  'voiceCallHangup',
]) {
  assert.match(
    chatHtml,
    new RegExp(`id="${id}"`),
    `Secretary chat page must include shared Live call overlay node #${id}.`,
  );
}

for (const id of [
  'voiceCall',
  'voiceCallStatus',
  'voiceCallTranscript',
  'voiceCallAvatar',
  'voiceCallName',
  'voiceCallOrb',
  'voiceCallHangup',
]) {
  assert.match(
    groupHtml,
    new RegExp(`id="${id}"`),
    `Secretary group page must include shared Live call overlay node #${id}.`,
  );
}

assert.match(
  groupHtml,
  /src="\/secretary\/voice-call\.js"/,
  'Secretary group page must load the shared Live call controller.',
);
assert.match(
  chatHtml,
  /src="\/secretary\/voice-call\.js"/,
  'Secretary chat page must load the shared Live call controller.',
);

assert.match(
  chatJs,
  /createLiveVoiceCall/,
  'Secretary chat page must mount the shared Live voice call controller.',
);
assert.match(
  groupJs,
  /createLiveVoiceCall/,
  'Secretary group page must mount the shared Live voice call controller.',
);
assert.match(
  groupJs,
  /openGroupLiveCall/,
  'Secretary group page must expose a real call opener for audio and video actions.',
);
assert.match(
  chatJs,
  /video:\s*\(\)\s*=>\s*\{[\s\S]*openLiveVoiceCall\(\)/,
  'Secretary chat video attachment must open the shared Live call flow.',
);
assert.match(
  chatHtml,
  /id="btnMention"/,
  'Secretary chat page must include a real @ mention button.',
);
assert.match(
  chatHtml,
  /id="mentionPanel"/,
  'Secretary chat page must include a mention suggestion panel.',
);
assert.match(
  chatJs,
  /const TOOL_MENTIONS = \[/,
  'Secretary chat @ panel must include tool mention candidates.',
);
assert.match(
  chatJs,
  /Flomo[\s\S]*物品库[\s\S]*日期[\s\S]*待办/,
  'Secretary chat @ panel must expose AI-adjacent tool shortcuts.',
);
assert.match(
  chatJs,
  /currentMentionQuery/,
  'Secretary chat input must detect typed @ mention queries.',
);
assert.match(
  chatJs,
  /btnMention\.addEventListener\('click'[\s\S]*renderMentionPanel/,
  'Secretary chat @ button must open the mention panel.',
);
assert.match(
  chatJs,
  /insertMention/,
  'Secretary chat @ panel must insert selected mentions into the composer.',
);
assert.match(
  chatCss,
  /\.wx-mention-panel/,
  'Secretary chat @ panel must have visible mobile styling.',
);
assert.match(
  groupJs,
  /navigator\.geolocation\.getCurrentPosition/,
  'Secretary group location action must attempt browser geolocation before falling back.',
);
assert.match(
  groupJs,
  /call:\s*\(\)\s*=>\s*\{[\s\S]*openGroupLiveCall\('audio'\)/,
  'Secretary group call attachment must open the shared Live call flow.',
);
assert.match(
  groupJs,
  /video:\s*\(\)\s*=>\s*\{[\s\S]*openGroupLiveCall\('video'\)/,
  'Secretary group video attachment must open the shared Live call flow.',
);

assert.equal(
  packageJson.scripts['test:secretary-static-controls'],
  'node scripts/secretary-static-controls.test.mjs',
  'package.json must expose test:secretary-static-controls.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:secretary-static-controls/,
  'test:contracts must include secretary static controls coverage.',
);

console.log('secretary-static-controls checks passed');
