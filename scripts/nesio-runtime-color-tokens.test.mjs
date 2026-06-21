import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dashboardPath = join(root, 'components', 'portal', 'DashboardHome.tsx');
const personalizationPath = join(root, 'lib', 'portal', 'personalization-insights.ts');
const packagePath = join(root, 'package.json');

const dashboard = readFileSync(dashboardPath, 'utf8');
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

const moodOptions = extractConstArray(dashboard, 'MOOD_OPTIONS');
const rawHexColor = /color:\s*['"]#[0-9a-fA-F]{3,8}['"]/;

assert(
  !rawHexColor.test(moodOptions),
  'MOOD_OPTIONS must use Nesio theme-aware color tokens instead of raw hex colors.',
);

for (const token of [
  'var(--status-calm)',
  'var(--status-go)',
  'var(--status-gentle)',
  'var(--portal-cool-accent)',
  'var(--portal-warm-accent)',
  'var(--portal-neutral-accent)',
]) {
  assert(
    moodOptions.includes(token),
    `MOOD_OPTIONS should include the design-system token ${token}.`,
  );
}

assert(
  !/moodDotColor:\s*['"]#[0-9a-fA-F]{3,8}['"]/.test(personalization),
  'personalization-insights moodDotColor must use Nesio theme-aware color tokens instead of raw hex colors.',
);

assert(
  personalization.includes("moodDotColor: 'var(--status-gentle)'") &&
    personalization.includes("moodDotColor: 'var(--status-calm)'"),
  'personalization-insights must map default mood dots to warm-coach status tokens.',
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
