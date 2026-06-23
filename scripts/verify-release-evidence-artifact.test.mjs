import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.equal(
  packageJson.scripts['verify:release-evidence-artifact'],
  'node scripts/verify-release-evidence-artifact.mjs',
  'package.json must expose verify:release-evidence-artifact for QA-downloaded CI artifacts.',
);
assert.equal(
  packageJson.scripts['test:release-evidence-artifact'],
  'node scripts/verify-release-evidence-artifact.test.mjs',
  'package.json must expose test:release-evidence-artifact.',
);
assert.match(
  packageJson.scripts['test:release-contracts'],
  /test:release-evidence-artifact/,
  'release contracts must include release evidence artifact verification coverage.',
);

const artifactDir = mkdtempSync(join(tmpdir(), 'release-evidence-artifact-'));

try {
  const json = execFileSync('node', [join(scriptDir, 'report-release-evidence.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  const markdown = execFileSync('node', [join(scriptDir, 'report-release-evidence.mjs'), '--markdown'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  writeFileSync(join(artifactDir, 'release-evidence.json'), json);
  writeFileSync(join(artifactDir, 'release-evidence.md'), markdown);

  const output = execFileSync('node', [join(scriptDir, 'verify-release-evidence-artifact.mjs'), artifactDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.match(output, /release evidence artifact verification passed/);
  assert.match(output, /release-evidence\.json/);
  assert.match(output, /release-evidence\.md/);
} finally {
  rmSync(artifactDir, { recursive: true, force: true });
}

const brokenArtifactDir = mkdtempSync(join(tmpdir(), 'release-evidence-artifact-broken-'));

try {
  writeFileSync(join(brokenArtifactDir, 'release-evidence.json'), '{}');
  assert.throws(
    () =>
      execFileSync('node', [join(scriptDir, 'verify-release-evidence-artifact.mjs'), brokenArtifactDir], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 * 20,
      }),
    /release-evidence\.md/,
    'artifact verifier must fail when the markdown evidence file is missing.',
  );
} finally {
  rmSync(brokenArtifactDir, { recursive: true, force: true });
}

console.log('release evidence artifact verifier tests passed');
