import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const portalDir = join(root, 'components', 'portal');
const packagePath = join(root, 'package.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

function lineFor(source, index) {
  return source.slice(0, index).split('\n').length;
}

const inertButtons = [];

for (const file of walk(portalDir)) {
  const source = readFileSync(file, 'utf8');
  const buttonPatterns = [
    /<button\b[\s\S]*?<\/button>/g,
    /<button\b(?:(?!<\/button>)[\s\S])*?\/>/g,
  ];
  for (const buttonPattern of buttonPatterns) {
    let match;
    while ((match = buttonPattern.exec(source))) {
      const block = match[0];
      const isInteractive =
        /onClick=/.test(block) ||
        /type=["']submit["']/.test(block) ||
        /disabled=/.test(block) ||
        /aria-disabled=/.test(block);
      if (!isInteractive) {
        inertButtons.push(`${relative(root, file)}:${lineFor(source, match.index)}`);
      }
    }
  }
}

const inertInputs = [];

for (const file of walk(portalDir)) {
  const source = readFileSync(file, 'utf8');
  const checkboxPattern = /<input\b(?=[^>]*type=["']checkbox["'])(?:(?!>).)*>/g;
  let match;
  while ((match = checkboxPattern.exec(source))) {
    const block = match[0];
    const isInteractive =
      /onChange=/.test(block) ||
      /disabled=/.test(block) ||
      /readOnly/.test(block) ||
      /aria-disabled=/.test(block);
    if (!isInteractive) {
      inertInputs.push(`${relative(root, file)}:${lineFor(source, match.index)}`);
    }
  }
}

assert(
  inertButtons.length === 0,
  `Portal buttons must have an explicit runtime action or disabled reason. Inert buttons: ${inertButtons.join(', ')}`,
);

assert(
  inertInputs.length === 0,
  `Portal checkbox inputs must have an explicit runtime action or read-only reason. Inert inputs: ${inertInputs.join(', ')}`,
);

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

assert(
  pkg.scripts['test:portal-no-inert-buttons'] === 'node scripts/portal-no-inert-buttons.test.mjs',
  'package.json must expose test:portal-no-inert-buttons.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:portal-no-inert-buttons'),
  'test:contracts must include test:portal-no-inert-buttons.',
);

console.log('portal-no-inert-buttons checks passed');
