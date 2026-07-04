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

// 导航已重设计为三键(Today / 中央记录 / Memory):图标为内联描边 SVG
// (design-system 线性图标语言)+ 品牌 PWA 中键;mask 图标系统随旧宫格退役。
assert(
  component.includes('nesio-bottom-nav-icon') &&
    component.includes('/icons/treasurebox-pwa-192.png'),
  'PortalBottomNav must render design-system stroke icons and the brand center icon.',
);

assert(
  !component.includes('⌂') && !component.includes('▦') && !component.includes('>✦<'),
  'PortalBottomNav must not use temporary unicode glyphs as primary nav icons.',
);

assert(
  /\.nesio-bottom-nav-icon/.test(css),
  'Bottom nav icon class must be styled in globals.css.',
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
