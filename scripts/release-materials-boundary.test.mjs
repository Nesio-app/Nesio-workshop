import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const docPath = path.join(root, 'docs', 'release', 'app-store-materials-v01.md');
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';

const failures = [];

if (!doc) {
  failures.push('docs/release/app-store-materials-v01.md is missing');
} else {
  for (const marker of [
    'www.nesio.app',
    'Shell + Inventory / purchase-memory + Todo',
    '不承诺 AI',
    '不承诺心理',
    '不承诺健康',
    '不承诺财务',
    '不承诺 10+ 工具全可用',
    '不承诺云同步',
    '不承诺订阅',
    'Privacy Policy URL',
    'Support URL',
    'CEO Gate',
  ]) {
    if (!doc.includes(marker)) failures.push(`release materials missing marker: ${marker}`);
  }
}

if (failures.length) {
  console.error('Release materials boundary contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release materials boundary contract passed');
