import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = readFileSync(join(root, 'app/api/portal/quote/route.ts'), 'utf8');

assert.match(source, /const POSITIVE_TERMS = \[/, 'quote route must keep an explicit positive allowlist');
assert.match(source, /BLOCKED_TERMS\.some/, 'quote route must reject known negative terms');
assert.match(source, /POSITIVE_TERMS\.some/, 'external quote must prove positive intent before display');
assert.match(source, /source: 'local_fallback'/, 'quote route must fall back locally when upstream fails');
assert.doesNotMatch(source, /ok: false,\s*quote: null/, 'quote route must not render an empty quote on upstream failure');
assert.match(source, /并无新事/, 'previously observed neutral-cold external quote must stay blocked');

console.log('portal quote positive boundary tests passed');
