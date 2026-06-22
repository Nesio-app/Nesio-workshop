import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportScript = path.join(__dirname, 'report-i18n-hardcode.mjs');
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

assert.equal(
  packageJson.scripts['report:i18n-hardcode'],
  'node scripts/report-i18n-hardcode.mjs --markdown',
  'package.json should expose report:i18n-hardcode',
);
assert.equal(
  packageJson.scripts['test:i18n-hardcode'],
  'node scripts/i18n-hardcode-scan.test.mjs',
  'package.json should expose test:i18n-hardcode',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:i18n-hardcode/,
  'test:contracts should include i18n hard-code scan contract',
);

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'i18n-hardcode-'));
const componentDir = path.join(fixtureRoot, 'components', 'portal');
const appDir = path.join(fixtureRoot, 'app', 'settings');
const scriptDir = path.join(fixtureRoot, 'scripts');

mkdirSync(componentDir, { recursive: true });
mkdirSync(appDir, { recursive: true });
mkdirSync(scriptDir, { recursive: true });

writeFileSync(
  path.join(componentDir, 'DemoPanel.tsx'),
  [
    'export function DemoPanel() {',
    '  const label = "保存日历链接";',
    '  return <button aria-label="返回宝盒">智友</button>;',
    '}',
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  path.join(componentDir, 'DemoPanel 2.tsx'),
  'export const copied = "复制副本不算 UI 文案";\n',
  'utf8',
);

writeFileSync(
  path.join(appDir, 'page.tsx'),
  [
    'export default function SettingsPage() {',
    '  return <main><h1>软件设置</h1><button>Google Calendar</button><button>Settings</button></main>;',
    '}',
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  path.join(scriptDir, 'ignored.test.tsx'),
  'export const ignored = "测试脚本不算 UI 文案";\n',
  'utf8',
);

const jsonOutput = path.join(fixtureRoot, 'i18n-hardcode.json');

execFileSync(process.execPath, [
  reportScript,
  '--root',
  'components/portal',
  '--root',
  'app',
  '--json-output',
  jsonOutput,
], {
  cwd: fixtureRoot,
  encoding: 'utf8',
});

const report = JSON.parse(readFileSync(jsonOutput, 'utf8'));

assert.equal(report.version, 'i18n-hardcode-report-v0');
assert.equal(report.mode, 'report-only');
assert.equal(report.summary.scannedFileCount, 2);
assert.equal(report.summary.findingCount, 5);
assert.equal(report.summary.byKind.cjk, 4);
assert.equal(report.summary.byKind.userFacingEnglish, 1);
assert.equal(report.summary.highPriorityFindingCount, 5);
assert.ok(
  report.findings.every((finding) => finding.owner === 'Qiao / Luma'),
  'every finding should have an owner',
);
assert.ok(
  report.findings.some((finding) => finding.file === 'components/portal/DemoPanel.tsx'),
  'component UI findings should be reported',
);
assert.ok(
  report.findings.some((finding) => finding.match === 'Settings'),
  'generic user-facing English labels should be reported',
);
assert.ok(
  report.findings.every((finding) => finding.match !== 'Google Calendar'),
  'provider and product proper nouns should not be reported as translation drift',
);
assert.ok(
  report.findings.every((finding) => !finding.file.includes('ignored.test')),
  'test fixtures should be excluded from UI string scan',
);
assert.ok(
  report.findings.every((finding) => !finding.file.includes('DemoPanel 2')),
  'local duplicate files should be excluded from UI string scan',
);
assert.deepEqual(report.boundaries, {
  implementation: 'static-ui-string-scan',
  reportOnly: true,
  sourceWrites: false,
  translationWrites: false,
  runtimeEnforcement: false,
  externalServiceCalls: false,
});

console.log('i18n hard-code scan tests passed');
