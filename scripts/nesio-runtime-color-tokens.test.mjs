import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const personalizationPath = join(root, 'lib', 'portal', 'personalization-insights.ts');
const packagePath = join(root, 'package.json');

const personalization = readFileSync(personalizationPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractConstArray(source, constName) {
  const match = source.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\] as const;`));
  assert(match, `Expected ${constName} to be declared as a const array.`);
  return match[1];
}

// v14 dashboard retired — mood colors now live in MoodSheet's EMOTIONS wheel.
const moodSheet = readFileSync(join(root, 'components', 'portal', 'MoodSheet.tsx'), 'utf8');
const moodOptions = extractConstArray(moodSheet, 'EMOTIONS');
const rawHexColor = /color:\s*['"]#[0-9a-fA-F]{3,8}['"]/;

assert(
  !rawHexColor.test(moodOptions),
  'MOOD_OPTIONS must use Nesio theme-aware color tokens instead of raw hex colors.',
);

// The v14 six-tone MOOD_OPTIONS became the Russell 12-emotion wheel;
// colors must come from the --emotion-* design-token family (globals.css).
assert(
  /var\(--emotion-[a-z]+\)/.test(moodOptions),
  'EMOTIONS must reference the --emotion-* design-token family.',
);
assert(
  !/#[0-9a-fA-F]{3,8}/.test(moodOptions),
  'EMOTIONS must not contain raw hex colors.',
);

assert(
  !/moodDotColor:\s*['"]#[0-9a-fA-F]{3,8}['"]/.test(personalization),
  'personalization-insights moodDotColor must use Nesio theme-aware color tokens instead of raw hex colors.',
);

assert(
  personalization.includes("moodDotColor: 'var(--status-gentle)'") &&
    personalization.includes("moodDotColor: 'var(--status-calm)'"),
  'personalization-insights must map default mood dots to warm-coach status tokens.',
);

// EmailComposeSheet 曾从别的设计系统移植,内联了 --accent/--status-stop/--text-muted/
// --surface-2/--border 这些 Nesio 里根本没定义的 token,fallback 直接渲染被拉黑的
// #10b981/#ef4444(且 --text-muted 无 fallback → 文字无色)。守护它只用 Nesio token 家族。
const emailCompose = readFileSync(join(root, 'components', 'portal', 'EmailComposeSheet.tsx'), 'utf8');
for (const banned of ['#10b981', '#ef4444', '#8b5cf6', '#3b6ef0', '#f59e0b', '#f0f4ff']) {
  assert(
    !emailCompose.includes(banned),
    `EmailComposeSheet must not render the deprecated hex ${banned} (CLAUDE.md blacklist).`,
  );
}
for (const foreign of ['--accent', '--status-stop', '--text-muted', '--surface-2', '--border']) {
  assert(
    !emailCompose.includes(`var(${foreign}`),
    `EmailComposeSheet must not reference the undefined foreign token ${foreign}; use the Nesio --portal-*/--status-* family.`,
  );
}
assert(
  /var\(--portal-blue-deep\)/.test(emailCompose) && /var\(--portal-muted\)/.test(emailCompose),
  'EmailComposeSheet must use Nesio tokens (--portal-blue-deep / --portal-muted).',
);

assert(
  pkg.scripts['test:nesio-runtime-colors'] === 'node scripts/nesio-runtime-color-tokens.test.mjs',
  'package.json must expose test:nesio-runtime-colors.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:nesio-runtime-colors'),
  'test:contracts must include test:nesio-runtime-colors.',
);

console.log('nesio-runtime-color-tokens checks passed');
