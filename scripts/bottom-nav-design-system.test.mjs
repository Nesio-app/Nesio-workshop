import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const componentPath = join(root, 'components', 'portal', 'PortalBottomNav.tsx');
const cssPath = join(root, 'app', 'globals.css');
const packagePath = join(root, 'package.json');

const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} Expected ${expected}, got ${actual}`);
}

assert(
  component.includes('nesioBrandAssets') &&
    component.includes('nesioToolIcons') &&
    component.includes('bottomNavItems') &&
    component.includes('portal-bottom-nav-icon--mask') &&
    component.includes('--portal-bottom-nav-icon-url'),
  'PortalBottomNav must render icons from the Nesio design-system asset contract.',
);

assert(
  !component.includes('⌂') && !component.includes('▦') && !component.includes('>✦<'),
  'PortalBottomNav must not use temporary unicode glyphs as primary nav icons.',
);

assert(
  /bottomNavItems\.map\(\(item\)[\s\S]*style=\{\{\s*'--portal-bottom-nav-icon-url': `url\("\$\{item\.iconUrl\}"\)`/.test(component),
  'PortalBottomNav must map nav items through a single item list with mask icon URLs.',
);

assert(
  /\.portal-bottom-nav-icon--mask[\s\S]*mask-image:\s*var\(--portal-bottom-nav-icon-url\)/.test(css),
  'Bottom nav mask CSS must use the icon URL variable.',
);

assertEqual(
  pkg.scripts['test:bottom-nav-design-system'],
  'node scripts/bottom-nav-design-system.test.mjs',
  'package.json must expose test:bottom-nav-design-system.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:bottom-nav-design-system'),
  'test:contracts must include bottom nav design-system coverage.',
);

console.log('bottom-nav-design-system checks passed');
