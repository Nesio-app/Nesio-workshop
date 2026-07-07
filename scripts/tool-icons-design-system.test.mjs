import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const assetContractPath = join(root, 'lib', 'portal', 'nesio-design-system-assets.mjs');
// ToolCard/ToolSidebar retired with the v14 dashboard (2026-07 contract
// migration); ToolGridIcon is the living icon surface.
const toolGridIconPath = join(root, 'components', 'portal', 'ToolGridIcon.tsx');
const packagePath = join(root, 'package.json');

const assetContract = readFileSync(assetContractPath, 'utf8');
const toolGridIcon = readFileSync(toolGridIconPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  assetContract.includes('moduleIconAliases') && assetContract.includes('getNesioToolIcon'),
  'Nesio asset contract must expose a moduleId-aware tool icon resolver.',
);

for (const [moduleId, iconKey] of [
  ['psychoanalysis', 'psych'],
  ['finance', 'finance'],
]) {
  assert(
    assetContract.includes(`${moduleId}: "${iconKey}"`) || assetContract.includes(`${moduleId}: '${iconKey}'`),
    `Expected module icon alias ${moduleId} -> ${iconKey}.`,
  );
}

for (const [name, source] of [
  ['ToolGridIcon', toolGridIcon],
]) {
  assert(
    source.includes('getNesioToolIcon'),
    `${name} must resolve tool icons through getNesioToolIcon.`,
  );
  assert(
    !source.includes('tool.iconUrl ? withBase(tool.iconUrl) : null'),
    `${name} must not use portal-config iconUrl as the primary display source.`,
  );
}

assert(
  toolGridIcon.includes('next/image') && !toolGridIcon.includes('const TOOL_ICONS'),
  'ToolGridIcon must render synced asset icons with next/image instead of its old inline SVG registry.',
);

assert(
  pkg.scripts['test:tool-icons-design-system'] === 'node scripts/tool-icons-design-system.test.mjs',
  'package.json must expose test:tool-icons-design-system.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:tool-icons-design-system'),
  'test:contracts must include tool icon design-system coverage.',
);

assert(
  pkg.scripts['test:release-contracts'].includes('test:tool-icons-design-system'),
  'test:release-contracts must include tool icon design-system coverage.',
);

console.log('tool-icons-design-system checks passed');
