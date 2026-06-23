import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const friends = JSON.parse(read('tools/secretary/friends.json'));
const chatJs = read('tools/secretary/chat.js');
const listJs = read('tools/secretary/list.js');
const groupJs = read('tools/secretary/group.js');
const route = read('app/api/secretary/chat/route.ts');
const promptCatalog = read('lib/portal/secretary-ai-prompt-catalog.mjs');

const aiIds = friends.map((friend) => friend.id);
for (const id of ['gemini', 'claude', 'chatgpt', 'doubao', 'deepseek', 'grok']) {
  assert.ok(aiIds.includes(id), `Secretary friend list must keep ${id}.`);
}

assert.doesNotMatch(
  chatJs,
  /location\.(?:replace|href)\s*=\s*['"]\/secretary\/chat\?friend=gemini/,
  'Secretary chat must not redirect non-Gemini AI entries away from their own chat page.',
);
assert.doesNotMatch(
  chatJs,
  /friend\.ready[\s\S]{0,220}模型未接入/,
  'Secretary chat sendMessage must not reject a visible AI only because friends.json marks it not-ready.',
);
assert.doesNotMatch(
  chatJs,
  /尚未接入/,
  'Secretary chat UI must not show stale not-connected copy for visible AI entries.',
);
assert.doesNotMatch(
  listJs,
  /待接/,
  'Secretary list must not label visible AI entries as unavailable when fallback routing is enabled.',
);
assert.doesNotMatch(
  groupJs,
  /尚未接入/,
  'Secretary group chat must not return inert not-connected replies for visible AI members.',
);

assert.match(
  promptCatalog,
  /export function buildSecretaryPersonaPrompt/,
  'Secretary API must build persona prompts for provider fallback routing.',
);
assert.match(
  route,
  /secretary-ai-prompt-catalog\.mjs/,
  'Secretary API must import fallback persona prompts from the shared prompt catalog.',
);
assert.match(
  route,
  /chatWithGeminiFallback/,
  'Secretary API must expose a Gemini fallback path for provider gaps.',
);
assert.match(
  route,
  /return NextResponse\.json\(\{ text, model: 'gemini', requestedModel: modelId, fallback: true,[\s\S]{0,180}runtime: \{ provider: 'gemini', requestedModel: modelId, fallback: true \}/,
  'Secretary API fallback responses must identify the requested model and fallback state.',
);
for (const id of ['deepseek', 'grok']) {
  assert.match(
    route,
    new RegExp(`modelId === '${id}'`),
    `Secretary API must explicitly route ${id} through the fallback provider until native keys exist.`,
  );
}

assert.equal(
  packageJson.scripts['test:secretary-ai-provider-fallback'],
  'node scripts/secretary-ai-provider-fallback.test.mjs',
  'package.json must expose test:secretary-ai-provider-fallback.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:secretary-ai-provider-fallback/,
  'test:contracts must include secretary AI provider fallback coverage.',
);

console.log('secretary-ai-provider-fallback checks passed');
