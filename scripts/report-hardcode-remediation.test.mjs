import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyHardcodeFinding,
  summarizeClassifications,
} from '../lib/portal/hardcode-remediation-classifier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportScript = path.join(__dirname, 'report-hardcode-remediation.mjs');

const cases = [
  {
    name: 'provider endpoint is provider-config',
    finding: {
      file: 'app/api/secretary/chat/route.ts',
      line: 4,
      text: "const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';",
      match: 'https://api.openai.com/v1/chat/completions',
    },
    expected: 'provider-config',
  },
  {
    name: 'runtime production fallback is runtime',
    finding: {
      file: 'storage-web/config.js',
      line: 1,
      text: "window.STORAGE_API = window.STORAGE_API || 'https://storage-kohl.vercel.app';",
      match: 'https://storage-kohl.vercel.app',
    },
    expected: 'runtime',
  },
  {
    name: 'module route source is route-contract',
    finding: {
      file: 'lib/portal/module-routes.mjs',
      line: 1,
      text: "export const LOCAL_STATIC_MODULE_PATHS = Object.freeze(['/fitness']);",
      match: '/fitness',
    },
    expected: 'route-contract',
  },
  {
    name: 'documentation example is docs-example',
    finding: {
      file: 'adhd-flow-ios/IOS-BUILD.md',
      line: 36,
      text: "window.ADHD_FLOW_API = 'https://YOUR_URL.vercel.app';",
      match: 'https://YOUR_URL.vercel.app',
    },
    expected: 'docs-example',
  },
  {
    name: 'localhost is acceptable constant',
    finding: {
      file: 'README.md',
      line: 19,
      text: 'Open http://localhost:3000.',
      match: 'http://localhost:3000',
    },
    expected: 'acceptable-constant',
  },
];

for (const testCase of cases) {
  const classification = classifyHardcodeFinding(testCase.finding);
  assert.equal(
    classification.category,
    testCase.expected,
    `${testCase.name}: expected ${testCase.expected}, got ${classification.category}`,
  );
}

const summary = summarizeClassifications(
  cases.map((testCase) => ({
    ...testCase.finding,
    classification: classifyHardcodeFinding(testCase.finding),
  })),
);

assert.equal(summary.total, cases.length);
assert.equal(summary.byCategory.runtime, 1);
assert.equal(summary.byCategory['docs-example'], 1);
assert.equal(summary.byCategory['route-contract'], 1);
assert.equal(summary.byCategory['provider-config'], 1);
assert.equal(summary.byCategory['acceptable-constant'], 1);

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'hardcode-report-'));
const docsDir = path.join(fixtureRoot, 'docs');
const appDir = path.join(fixtureRoot, 'app');
const providerDir = path.join(appDir, 'api', 'secretary', 'chat');
const innerShelterApiDir = path.join(appDir, 'api', 'inner-shelter', 'chat');
const calendarApiDir = path.join(appDir, 'api', 'portal', 'calendar');
const adhdScriptsDir = path.join(fixtureRoot, 'adhd-flow-ios', 'scripts');
const adhdWebDir = path.join(fixtureRoot, 'adhd-flow-ios', 'web');
const libPortalDir = path.join(fixtureRoot, 'lib', 'portal');
const publicDir = path.join(fixtureRoot, 'public');

for (const dir of [
  docsDir,
  providerDir,
  innerShelterApiDir,
  calendarApiDir,
  adhdScriptsDir,
  adhdWebDir,
  libPortalDir,
  publicDir,
]) {
  mkdirSync(dir, { recursive: true });
}

for (let index = 1; index <= 13; index += 1) {
  writeFileSync(
    path.join(docsDir, `example-${String(index).padStart(2, '0')}.md`),
    `Example ${index}: https://example-${index}.vercel.app\n`,
    'utf8',
  );
}

writeFileSync(
  path.join(providerDir, 'route.ts'),
  [
    "const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';",
    "if (provider === 'gemini') return 'gemini';",
    "if (provider === 'openai') return 'openai';",
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  path.join(innerShelterApiDir, 'route.ts'),
  "import OpenAI from 'openai';\n",
  'utf8',
);

writeFileSync(
  path.join(calendarApiDir, 'route.ts'),
  "add(process.env.GOOGLE_CALENDAR_ICS_URL, 'Google');\n",
  'utf8',
);

writeFileSync(
  path.join(adhdScriptsDir, 'deploy-api.sh'),
  'PRODUCTION_URL="${LIFEFLOW_PRODUCTION_URL:-https://adhd-flow-ios.vercel.app}"\n',
  'utf8',
);

writeFileSync(
  path.join(adhdWebDir, 'app.js'),
  "window.ADHD_FLOW_API = window.ADHD_FLOW_API || 'https://adhd-flow-ios.vercel.app'; window.INNER_SHELTER_API = '/api/inner-shelter';\n",
  'utf8',
);

writeFileSync(
  path.join(publicDir, 'portal-config.json'),
  '{"openHref":"https://questionbank-ios.vercel.app/"}\n',
  'utf8',
);

writeFileSync(
  path.join(appDir, 'client.js'),
  "document.getElementById('status').innerHTML = '<span>Loading</span>';\n",
  'utf8',
);

writeFileSync(
  path.join(libPortalDir, 'module-routes.mjs'),
  "export const LOCAL_STATIC_MODULE_PATHS = Object.freeze(['/fitness']);\n",
  'utf8',
);

const markdownOutput = path.join(fixtureRoot, 'hardcode-report.md');
const jsonOutput = path.join(fixtureRoot, 'hardcode-report.json');

execFileSync(process.execPath, [
  reportScript,
  '--root',
  'docs',
  '--root',
  'app',
  '--root',
  'adhd-flow-ios',
  '--root',
  'lib',
  '--root',
  'public',
  '--output',
  markdownOutput,
  '--json-output',
  jsonOutput,
], {
  cwd: fixtureRoot,
  encoding: 'utf8',
});

const jsonReport = JSON.parse(readFileSync(jsonOutput, 'utf8'));
assert.equal(jsonReport.summary.total, 30);
assert.equal(jsonReport.findings.length, 30);
assert.deepEqual(jsonReport.summary.byRemediationBatch, {
  A: 1,
  B: 1,
  C: 15,
  D: 13,
});
assert.ok(
  jsonReport.findings.every((finding) => ['A', 'B', 'C', 'D'].includes(finding.remediationBatch)),
  'JSON output should tag every finding with remediationBatch A/B/C/D',
);
assert.ok(
  jsonReport.findings.some((finding) => finding.classification.category === 'provider-config'),
  'JSON output should preserve provider-config classifications using existing classifier semantics',
);
assert.ok(
  jsonReport.findings
    .filter((finding) =>
      finding.classification.ceoGate ||
      /PRODUCTION_URL|LIFEFLOW_PRODUCTION_URL|GOOGLE_CALENDAR_ICS_URL|ADHD_FLOW_API|INNER_SHELTER_API|api\.openai\.com|OPENAI_API_URL|openai|gemini|questionbank-ios\.vercel\.app/i.test(
        `${finding.file} ${finding.match} ${finding.text}`,
      ),
    )
    .every((finding) => finding.remediationBatch === 'C'),
  'CEO-gated production/provider/calendar/public-AI/env-boundary findings should stay in C and never be tagged A/B',
);
assert.ok(
  jsonReport.findings.some((finding) => finding.file === 'docs/example-13.md'),
  'JSON output should include every finding, including entries beyond markdown summary top-N sections',
);

const markdownReport = readFileSync(markdownOutput, 'utf8');
assert.match(markdownReport, /## Classifier Summary/);
assert.match(markdownReport, /## Remediation Batch Summary/);
assert.match(markdownReport, /## Full Findings Appendix/);
assert.match(markdownReport, /- A: 1/);
assert.match(markdownReport, /- B: 1/);
assert.match(markdownReport, /- C: 15/);
assert.match(markdownReport, /- D: 13/);
assert.match(markdownReport, /`batch:C`/);
assert.match(
  markdownReport,
  /docs\/example-13\.md:1/,
  'Markdown full-list appendix should include findings beyond the docs-example summary top-N section',
);

console.log('report-hardcode-remediation classifier tests passed');
