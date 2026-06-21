import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const nightModalMatch = css.match(
  /html\[data-portal-theme="night"\] \.portal-ai-call-sheet,[\s\S]*?\{[\s\S]*?\}/,
);

assert.ok(nightModalMatch, 'Expected a shared night-theme modal card rule.');

const nightModalRule = nightModalMatch[0];
for (const selector of [
  '.portal-ai-call-sheet',
  '.portal-ai-conversation-sheet > section',
  '.portal-crush-sheet-card',
  '.portal-mood-card',
  '.portal-reminder-card',
  '.portal-purchased-tools-card',
]) {
  assert.match(
    nightModalRule,
    new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `Night modal rule must include ${selector}.`,
  );
}

assert.match(
  nightModalRule,
  /background:\s*var\(--modal-card-bg\)/,
  'Night modal cards must use --modal-card-bg instead of hard-coded per-surface colors.',
);

assert.match(
  nightModalRule,
  /backdrop-filter:\s*blur\(var\(--modal-card-blur\)\) saturate\(var\(--modal-card-saturate\)\)/,
  'Night modal cards must keep using the shared modal blur tokens.',
);

assert.equal(
  pkg.scripts['test:nesio-modal-theme'],
  'node scripts/nesio-modal-theme-contract.test.mjs',
  'package.json must expose test:nesio-modal-theme.',
);

assert.match(
  pkg.scripts['test:contracts'],
  /test:nesio-modal-theme/,
  'test:contracts must include test:nesio-modal-theme.',
);

console.log('Nesio modal theme contract OK');
