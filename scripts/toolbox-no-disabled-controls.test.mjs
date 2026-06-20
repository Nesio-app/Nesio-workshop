import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'components', 'portal', 'ToolsTreasureSheet.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.doesNotMatch(
  source,
  /disabled=|aria-disabled/,
  'ToolsTreasureSheet must not render disabled controls; use a local request/join action instead.',
);

assert.doesNotMatch(
  css,
  /\.portal-treasure-[\w-]+[^{]*button:disabled/,
  'Toolbox CSS must not preserve disabled button styling because every visible toolbox control is actionable.',
);

assert.match(
  source,
  /handleAddTool[\s\S]*setSelectedToolboxAction/,
  'Addable toolbox tools must update local request state.',
);

assert.match(
  source,
  /handleRequestToolAccess[\s\S]*setSelectedToolboxAction/,
  'Unavailable toolbox tools must update local request state instead of becoming inert.',
);

assert.match(
  source,
  /handleSelectPackage[\s\S]*setSelectedToolboxAction/,
  'Toolbox packages must update local selected package state.',
);

assert.equal(
  pkg.scripts['test:toolbox-no-disabled-controls'],
  'node scripts/toolbox-no-disabled-controls.test.mjs',
  'package.json must expose test:toolbox-no-disabled-controls.',
);

assert.match(
  pkg.scripts['test:contracts'],
  /test:toolbox-no-disabled-controls/,
  'test:contracts must include test:toolbox-no-disabled-controls.',
);

console.log('toolbox-no-disabled-controls checks passed');
