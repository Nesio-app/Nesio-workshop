/**
 * 行为契约:业务层禁止直调 addLifeNode(合法门 = createSignal / ingestLifeNode)。
 * 例外:create-signal.ts / ingest-node.ts / life-graph 自身。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const allow = new Set([
  'lib/life-domain/create-signal.ts',
  'lib/life-domain/ingest-node.ts',
  'lib/portal/life-graph.ts',
]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const abs of walk(path.join(root, 'lib')).concat(walk(path.join(root, 'components'))).concat(walk(path.join(root, 'app')))) {
  const rel = path.relative(root, abs).replaceAll('\\', '/');
  if (allow.has(rel)) continue;
  if (rel.includes('.test.') || rel.includes('/scripts/')) continue;
  const src = fs.readFileSync(abs, 'utf8');
  // 直调写入形态:addLifeNode({ 或 addLifeNode(input — 允许类型 import / 注释
  if (/\baddLifeNode\s*\(\s*\{/.test(src) || /\baddLifeNode\s*\(\s*[a-zA-Z_]/.test(src)) {
    // 排除纯类型引用注释里的「复用 addLifeNode」
    const lines = src.split('\n').filter((l) => /\baddLifeNode\s*\(/.test(l) && !/^\s*(\*|\/\/)/.test(l));
    if (lines.some((l) => /\baddLifeNode\s*\(/.test(l) && !/typeof addLifeNode|Parameters<typeof addLifeNode/.test(l))) {
      offenders.push(rel);
    }
  }
}

assert.deepEqual(offenders, [], `业务旁路 addLifeNode:\n${offenders.join('\n')}`);

// 烹饪/报告应走 ingest
for (const f of ['lib/cooking/meals.ts', 'lib/portal/daily-report-persist.ts', 'lib/portal/mirror-letter-persist.ts']) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(src, /ingestLifeNode/, `${f} 必须走 ingestLifeNode`);
}

console.log('write-gate-addLifeNode: OK');
