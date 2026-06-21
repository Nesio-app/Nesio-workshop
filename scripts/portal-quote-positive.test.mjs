import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = readFileSync(join(root, 'app/api/portal/quote/route.ts'), 'utf8');
const dashboardHome = readFileSync(join(root, 'components/portal/DashboardHome.tsx'), 'utf8');

assert.match(source, /const POSITIVE_TERMS = \[/, 'quote route must keep an explicit positive allowlist');
assert.match(source, /BLOCKED_TERMS\.some/, 'quote route must reject known negative terms');
assert.match(source, /POSITIVE_TERMS\.some/, 'external quote must prove positive intent before display');
assert.match(source, /type QuoteLocale = 'zh' \| 'en'/, 'quote route must normalize locale into supported quote dictionaries');
assert.match(source, /POSITIVE_FALLBACK_QUOTES_BY_LOCALE/, 'quote route must keep fallback quotes by locale');
assert.match(source, /locale: 'en'/, 'quote route must return English quote metadata when requested');
assert.match(source, /searchParams\.get\('locale'\)/, 'quote route must read requested locale from the URL');
assert.match(source, /source: 'local_fallback'/, 'quote route must fall back locally when upstream fails');
assert.doesNotMatch(source, /ok: false,\s*quote: null/, 'quote route must not render an empty quote on upstream failure');
assert.match(source, /并无新事/, 'previously observed neutral-cold external quote must stay blocked');
assert.match(
  dashboardHome,
  /URLSearchParams\(\{ locale \}\)/,
  'Dashboard external quote fetch must pass the current portal locale.',
);
assert.match(
  dashboardHome,
  /\/api\/portal\/quote\?\$\{quoteQuery\.toString\(\)\}/,
  'Dashboard external quote fetch must call the locale-aware quote endpoint.',
);

console.log('portal quote positive boundary tests passed');
