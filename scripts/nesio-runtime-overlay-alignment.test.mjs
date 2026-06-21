import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function groupedRulesFor(selector) {
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const index = css.indexOf(selector, cursor);
    if (index === -1) break;
    const nextChar = css[index + selector.length];
    if (![' ', '\n', '\t', ',', '{'].includes(nextChar)) {
      cursor = index + selector.length;
      continue;
    }
    const open = css.indexOf('{', index);
    const close = css.indexOf('\n}', open);
    if (open !== -1 && close !== -1) {
      rules.push(css.slice(index, close + 2));
    }
    cursor = index + selector.length;
  }
  assert.ok(rules.length > 0, `Expected CSS rule containing ${selector}.`);
  return rules;
}

function finalContractRuleFor(selector, requiredFragment) {
  const rules = groupedRulesFor(selector);
  const rule = rules.find((candidate) => candidate.includes(requiredFragment));
  assert.ok(rule, `Expected final contract rule for ${selector} containing ${requiredFragment}.`);
  return rule;
}

function numericZIndex(rule, label) {
  const match = rule.match(/z-index:\s*(\d+)/);
  assert.ok(match, `Expected ${label} to define a numeric z-index.`);
  return Number(match[1]);
}

function maxZIndexFor(selector, label) {
  const values = groupedRulesFor(selector)
    .map((rule) => rule.match(/z-index:\s*(\d+)/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  assert.ok(values.length > 0, `Expected ${label} to define at least one numeric z-index.`);
  return Math.max(...values);
}

for (const token of [
  '--modal-backdrop-bg',
  '--modal-backdrop-blur',
  '--modal-card-bg',
  '--modal-card-blur',
  '--modal-card-saturate',
  '--portal-bottom-nav-clearance',
]) {
  assert.match(css, new RegExp(`${token}:`), `Expected ${token} token to exist.`);
}

const overlayRule = finalContractRuleFor('.portal-ai-modal-layer', 'var(--modal-backdrop-bg)');
for (const selector of [
  '.portal-ai-conversation-sheet',
  '.portal-crush-sheet',
  '.portal-mood-sheet',
  '.portal-reminder-sheet',
  '.portal-purchased-tools-sheet',
]) {
  assert.match(overlayRule, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Overlay layer must include ${selector}.`);
}
assert.match(overlayRule, /place-items:\s*center\s*!important/, 'Runtime overlays must center sheets like the shared iOS folder-style popover.');
assert.match(overlayRule, /background:\s*var\(--modal-backdrop-bg\)\s*!important/, 'Runtime overlays must use shared backdrop color.');
assert.match(overlayRule, /blur\(var\(--modal-backdrop-blur\)\) saturate\(var\(--modal-backdrop-saturate\)\)/, 'Runtime overlays must use shared backdrop blur tokens.');

const sheetRule = finalContractRuleFor('.portal-ai-call-sheet', 'var(--modal-card-bg)');
for (const selector of [
  '.portal-ai-conversation-sheet > section',
  '.portal-crush-sheet-card',
  '.portal-mood-card',
  '.portal-reminder-card',
  '.portal-purchased-tools-card',
]) {
  assert.match(sheetRule, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Sheet card rule must include ${selector}.`);
}
assert.match(sheetRule, /background:\s*var\(--modal-card-bg\)\s*!important/, 'Sheet cards must use shared modal card surface.');
assert.match(sheetRule, /blur\(var\(--modal-card-blur\)\) saturate\(var\(--modal-card-saturate\)\)/, 'Sheet cards must use shared modal blur tokens.');

const runtimeClearanceMatch = css.match(/^\.portal-dashboard-root,[\s\S]*?^\.portal-settings\s*\{[\s\S]*?\n\}/m);
assert.ok(runtimeClearanceMatch, 'Expected a shared runtime surface bottom-clearance rule.');
assert.match(
  runtimeClearanceMatch[0],
  /padding-bottom:\s*var\(--portal-bottom-nav-clearance\)\s*!important/,
  'Home, AI, toolbox, and settings surfaces must reserve bottom nav clearance.',
);

const finalBottomNavRules = css.match(/\.portal-bottom-nav\s*\{[\s\S]*?\n\}/g) || [];
const tokenizedBottomNavRule = finalBottomNavRules.find((rule) =>
  /background:\s*var\(--glass-bg-pop\)/.test(rule) &&
  /blur\(var\(--modal-card-blur\)\) saturate\(var\(--modal-card-saturate\)\)/.test(rule),
);
assert.ok(tokenizedBottomNavRule, 'Bottom nav must have a final tokenized glass rule.');

const overlayZIndex = numericZIndex(overlayRule, 'runtime overlay layer');
const bottomNavZIndex = maxZIndexFor('.portal-bottom-nav', 'bottom nav');
assert.ok(
  overlayZIndex > bottomNavZIndex,
  `Runtime overlays must stack above the bottom nav so open sheets are clickable. overlay=${overlayZIndex}, bottomNav=${bottomNavZIndex}`,
);

const nightBottomNavRules = css.match(/html\[data-portal-theme="night"\] \.portal-bottom-nav\s*\{[\s\S]*?\n\}/g) || [];
const nightBottomNavRule = nightBottomNavRules.find((rule) => /background:\s*var\(--glass-bg-pop\)/.test(rule));
assert.ok(nightBottomNavRule, 'Expected a night-specific tokenized bottom nav rule.');
assert.match(
  nightBottomNavRule,
  /background:\s*var\(--glass-bg-pop\)\s*!important/,
  'Night bottom nav must use the shared pop glass surface.',
);
assert.match(
  nightBottomNavRule,
  /blur\(var\(--modal-card-blur\)\) saturate\(var\(--modal-card-saturate\)\)/,
  'Night bottom nav must use modal blur tokens instead of a hard-coded blur value.',
);

assert.equal(
  pkg.scripts['test:nesio-runtime-overlay-alignment'],
  'node scripts/nesio-runtime-overlay-alignment.test.mjs',
  'package.json must expose test:nesio-runtime-overlay-alignment.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:nesio-runtime-overlay-alignment/,
  'test:contracts must include test:nesio-runtime-overlay-alignment.',
);

console.log('Nesio runtime overlay alignment contract OK');
