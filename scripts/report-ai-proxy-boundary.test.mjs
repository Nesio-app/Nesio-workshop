import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildAiProxyBoundaryReport,
  formatMarkdownReport,
  scanText,
} from './report-ai-proxy-boundary.mjs';

const fixture = `
const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const proxy = process.env.INNER_SHELTER_API_URL || 'https://inner-shelter-ios.vercel.app';
const key = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
await fetch(OPENAI_API_URL, { headers: { Authorization: \`Bearer \${key}\` } });
return { model: 'gpt-4o-mini' };
`;

const findings = scanText('fixture/api/chat.ts', fixture);
assert.ok(findings.some((finding) => finding.kind === 'wildcard-cors'));
assert.ok(findings.some((finding) => finding.kind === 'provider-endpoint'));
assert.ok(findings.some((finding) => finding.kind === 'provider-env'));
assert.ok(findings.some((finding) => finding.kind === 'provider-auth'));
assert.ok(findings.some((finding) => finding.kind === 'model-id'));
assert.ok(findings.some((finding) => finding.kind === 'public-proxy-fallback'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-proxy-boundary-'));
fs.mkdirSync(path.join(tmpRoot, 'api'), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 'api', 'chat.ts'), fixture);

const originalFetch = global.fetch;
global.fetch = async () => {
  throw new Error('static AI proxy boundary report must not call fetch');
};

try {
  const report = buildAiProxyBoundaryReport({
    rootDir: tmpRoot,
    includeDirs: ['api'],
  });

  assert.equal(report.totalFindings, findings.length);
  assert.equal(report.networkCallsMade, false);
  assert.equal(report.byKind['wildcard-cors'], 1);
  assert.equal(report.byKind['provider-endpoint'], 2);
  assert.equal(report.byKind['provider-env'], 2);
  assert.equal(report.byKind['public-proxy-fallback'], 1);
  assert.ok(report.riskFamilies.some((family) => family.id === 'public-cors-provider-key'));
  assert.ok(report.riskFamilies.some((family) => family.id === 'provider-model-config'));

  const markdown = formatMarkdownReport(report);
  assert.match(markdown, /Public AI Proxy/);
  assert.match(markdown, /fixture|chat\.ts|api\/chat\.ts/);
  assert.match(markdown, /CEO gate/i);
} finally {
  global.fetch = originalFetch;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('AI proxy boundary static report tests passed');
