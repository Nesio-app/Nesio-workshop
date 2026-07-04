import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = readFileSync(join(root, 'app/api/portal/quote/route.ts'), 'utf8');
const catalog = readFileSync(join(root, 'lib/portal/positive-quote-catalog.mjs'), 'utf8');

assert.match(source, /positive-quote-catalog\.mjs/, 'quote route must import the shared quote catalog');
assert.doesNotMatch(source, /const POSITIVE_TERMS = \[/, 'positive allowlist must live in the shared quote catalog');
assert.doesNotMatch(source, /const BLOCKED_TERMS = \[/, 'blocked term list must live in the shared quote catalog');
assert.doesNotMatch(
  source,
  /const POSITIVE_FALLBACK_QUOTES_BY_LOCALE/,
  'fallback quote dictionaries must live in the shared quote catalog',
);
assert.match(catalog, /export const POSITIVE_TERMS = \[/, 'quote catalog must keep an explicit positive allowlist');
assert.match(catalog, /export const BLOCKED_TERMS = \[/, 'quote catalog must reject known negative terms');
assert.match(
  catalog,
  /export const POSITIVE_FALLBACK_QUOTES_BY_LOCALE/,
  'quote catalog must keep fallback quotes by locale',
);
assert.match(source, /isPositiveEnough\(quote\)/, 'external quote must prove positive intent before display');
assert.match(source, /normalizeQuoteLocale/, 'quote route must normalize locale into supported quote dictionaries');
assert.match(source, /locale: 'en'/, 'quote route must return English quote metadata when requested');
assert.match(source, /searchParams\.get\('locale'\)/, 'quote route must read requested locale from the URL');
assert.match(source, /source: 'local_fallback'/, 'quote route must fall back locally when upstream fails');
assert.doesNotMatch(source, /ok: false,\s*quote: null/, 'quote route must not render an empty quote on upstream failure');
assert.match(catalog, /并无新事/, 'previously observed neutral-cold external quote must stay blocked');
// Quote UI retired with the v14 dashboard — no living consumer today.
// Tracked as REG-001 in docs/regression-backlog.json (revive in Today or
// retire the engine). Route/catalog contracts above still guard the API.

console.log('portal quote positive boundary tests passed');
