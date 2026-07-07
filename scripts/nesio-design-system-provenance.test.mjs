import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const designSystemRoot = join(root, 'design-system', 'nesio');
const packagePath = join(root, 'package.json');
const contractPath = join(root, 'lib', 'portal', 'nesio-design-system-contract.mjs');

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const contract = await import(`file://${contractPath}`);

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertRepoFile(relativePath) {
  const filePath = join(designSystemRoot, relativePath);
  assert.ok(existsSync(filePath), `Expected repo-local design-system file ${relativePath}`);
  return filePath;
}

assert.equal(
  contract.nesioDesignSystemSource.sourcePath,
  'design-system/nesio',
  'The canonical design-system source must be repo-local.',
);

assert.equal(
  contract.nesioDesignSystemSource.productionImportMode,
  'lift-token-values-not-wholesale-css-import',
  'Production must lift reviewed token values instead of importing the design-system bundle directly.',
);

for (const relativePath of [
  'readme.md',
  'SKILL.md',
  '_ds_manifest.json',
  'styles.css',
  'tokens/fonts.css',
  'tokens/colors.css',
  'tokens/typography.css',
  'tokens/spacing.css',
  'tokens/effects.css',
  'assets/logo/treasurebox.svg',
]) {
  assertRepoFile(relativePath);
}

const readme = readFileSync(assertRepoFile('readme.md'), 'utf8');
assert.match(readme, /Nesio · 宝盒 Design System/, 'Design-system readme must use canonical Nesio naming.');
assert.match(readme, /warm coach/i, 'Design-system readme must preserve the warm-coach voice rules.');
assert.match(readme, /The day \*\*and\*\* night palettes here are taken directly from the shipped shell/, 'Design system must remain documentation of the shipped shell, not a redesign source.');

const manifest = JSON.parse(readFileSync(assertRepoFile('_ds_manifest.json'), 'utf8'));
assert.equal(manifest.namespace, 'NesioDesignSystem_d76dec', 'Expected repo-local design-system namespace to use canonical Nesio naming.');
assert.ok(
  manifest.cards.some((card) => card.path === 'ui_kits/shell/index.html'),
  'Expected shell UI kit to remain available as reference provenance.',
);

const requiredTokenFiles = contract.nesioDesignSystemSource.requiredTokenFiles;
assert.deepEqual(
  requiredTokenFiles,
  manifest.globalCssPaths.filter((file) => file.startsWith('tokens/')),
  'Contract token order must match the design-system manifest token order.',
);

for (const relativePath of requiredTokenFiles) {
  const sourceFile = assertRepoFile(relativePath);
  const globals = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
  const tokenSource = readFileSync(sourceFile, 'utf8');
  for (const token of ['--portal-blue-deep', '--portal-blue-mid', '--portal-blue-light', '--glass-blur']) {
    if (tokenSource.includes(token)) {
      assert.ok(globals.includes(token), `Expected runtime globals.css to include token ${token} from ${relativePath}`);
    }
  }
}

for (const [kind, names] of [
  ['tools', ['reading', 'fitness', 'quiz', 'sanctuary', 'psych', 'health', 'finance', 'lifesim']],
  ['ai', ['claude', 'chatgpt', 'gemini', 'doubao', 'deepseek', 'grok']],
]) {
  for (const name of names) {
    const sourceIcon = assertRepoFile(`assets/icons/${kind}/${name}.svg`);
    const publicIcon = join(root, 'public', 'icons', kind, `${name}.svg`);
    assert.ok(existsSync(publicIcon), `Expected public ${kind} icon ${name}.svg`);
    assert.equal(
      sha256(publicIcon),
      sha256(sourceIcon),
      `Expected public ${kind} icon ${name}.svg to match the repo-local design-system source.`,
    );
  }
}

const runtimeFiles = [
  join(root, 'app', 'page.tsx'),
  join(root, 'app', 'globals.css'),
  join(root, 'components', 'portal', 'ToolsTreasureSheet.tsx'),
  join(root, 'components', 'portal', 'PortalBottomNav.tsx'),
];

for (const filePath of runtimeFiles) {
  const source = readFileSync(filePath, 'utf8');
  assert.doesNotMatch(
    source,
    /NesioDesignSystem_d76dec|NosioDesignSystem_d76dec|_ds_bundle|ui_kits\/shell\/Home\.jsx|design-system\/nesio\/styles\.css/,
    `${filePath} must not directly import the design-system demo bundle or sample shell.`,
  );
}

assert.equal(
  pkg.scripts['test:nesio-design-system-provenance'],
  'node scripts/nesio-design-system-provenance.test.mjs',
  'package.json must expose test:nesio-design-system-provenance.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:nesio-design-system-provenance/,
  'test:contracts must include design-system provenance coverage.',
);

console.log('Nesio design-system provenance checks passed');
