import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const route = read('app/api/secretary/chat/route.ts');
const packageJson = JSON.parse(read('package.json'));

assert.match(
  route,
  /import \{[^}]*normalizePortalLocale[^}]*type PortalLocale[^}]*\} from '@\/lib\/portal\/profile'/s,
  'secretary chat route must import the shared portal locale normalizer.',
);
assert.match(
  route,
  /function buildSecretarySystemPrompt\(locale: PortalLocale\)/,
  'secretary chat route must build system prompts from the requested portal locale.',
);
assert.match(
  route,
  /function buildSecretaryPersonaPrompt\(\s*locale: PortalLocale,\s*modelId: string,\s*message: string\s*\)/,
  'secretary chat route must build fallback persona prompts from the requested portal locale.',
);
assert.match(
  route,
  /locale\?: string/,
  'secretary chat request body must accept an optional locale field.',
);
assert.match(
  route,
  /const locale = normalizePortalLocale\(body\.locale\)/,
  'secretary chat route must normalize body.locale through the shared locale contract.',
);
assert.match(
  route,
  /buildSecretarySystemPrompt\(locale\)/,
  'secretary chat provider calls must use the locale-aware system prompt.',
);
assert.match(
  route,
  /buildSecretaryPersonaPrompt\(locale, requestedModel, message\)/,
  'Gemini fallback routing must use the locale-aware persona prompt.',
);
assert.doesNotMatch(
  route,
  /const SYSTEM_PROMPT = `[^`]*回答用简体中文[^`]*`;/s,
  'secretary chat route must not keep a single Simplified-Chinese-only system prompt.',
);
assert.match(
  route,
  /Please respond as "\$\{label\}" in Nesio AI Friends\./,
  'secretary fallback persona prompt must include an English locale branch.',
);
assert.doesNotMatch(
  route,
  /function buildPersonaPrompt\(modelId: string, message: string\)/,
  'secretary fallback persona prompt must no longer use the old locale-free builder.',
);

assert.equal(
  packageJson.scripts['test:secretary-api-i18n'],
  'node scripts/secretary-api-i18n.test.mjs',
  'package.json must expose test:secretary-api-i18n.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:secretary-api-i18n/,
  'test:contracts must include secretary API i18n coverage.',
);

console.log('secretary API i18n checks passed');
