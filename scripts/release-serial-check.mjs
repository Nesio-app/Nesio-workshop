import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = join(repoRoot, '.next');

const steps = [
  { name: 'static QA', command: ['npm', 'run', 'test:qa:static'], cleanNext: true },
  { name: 'release build', command: ['npm', 'run', 'build'], cleanNext: true },
  { name: 'release E2E', command: ['npm', 'run', 'test:e2e'], cleanNext: true },
  { name: 'mobile/iOS shell precheck', command: ['npm', 'run', 'precheck:mobile-app'], cleanNext: false },
];

function cleanNext() {
  rmSync(nextDir, { recursive: true, force: true });
}

for (const step of steps) {
  if (step.cleanNext) {
    console.log(`[release:serial] cleaning .next before ${step.name}`);
    cleanNext();
  }

  console.log(`[release:serial] running ${step.name}: ${step.command.join(' ')}`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, BAOHE_RELEASE_SERIAL: '1' },
  });

  if (result.status !== 0) {
    console.error(`[release:serial] failed at ${step.name}`);
    process.exit(result.status || 1);
  }
}

console.log('[release:serial] release RC checks passed');
