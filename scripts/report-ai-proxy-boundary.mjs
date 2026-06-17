#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_INCLUDE_DIRS = [
  'app/api',
  'adhd-flow-ios/api',
  'inner-shelter-ios/api',
  'adhd-flow-ios/scripts',
  'inner-shelter-ios/scripts',
  'adhd-flow-ios/web',
  'inner-shelter-ios/web',
];

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.md', '.html']);
const EXCLUDED_DIRS = new Set(['.git', '.next', 'node_modules', 'dist', 'build']);
const PROVIDER_ENDPOINT_RE =
  /https:\/\/(?:generativelanguage\.googleapis\.com|api\.openai\.com|ark\.cn-beijing\.volces\.com)[^\s'"`)<>]*/gi;
const PROVIDER_ENV_RE =
  /\b(?:GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GOOGLE_AI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY|OpenAI_KEY|OPENAI_MODEL|GEMINI_MODEL|DOUBAO_KEY|DOUBAO_API_KEY|ARK_API_KEY|VOLCENGINE_API_KEY|DOUBAO_MODEL|DOUBAO_ENDPOINT)\b/g;
const MODEL_ID_RE =
  /\b(?:gemini-[a-z0-9.-]+|gpt-[a-z0-9.-]+|doubao-[a-z0-9.-]+)\b/gi;
const PROXY_FALLBACK_RE = /https:\/\/(?:inner-shelter-ios|adhd-flow-ios)[a-z0-9.-]*\.vercel\.app/gi;

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function lineAt(text, lineNumber) {
  return text.split(/\r?\n/)[lineNumber - 1]?.trim() || '';
}

function addRegexFindings(findings, file, text, kind, re, severity, reason) {
  for (const match of text.matchAll(re)) {
    const line = lineNumberAt(text, match.index || 0);
    findings.push({
      file,
      line,
      kind,
      severity,
      ceoGate: true,
      match: match[0],
      reason,
      excerpt: lineAt(text, line),
    });
  }
}

function addLineFindings(findings, file, text) {
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    const line = index + 1;
    if (/Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*/.test(lineText)) {
      findings.push({
        file,
        line,
        kind: 'wildcard-cors',
        severity: 'P1',
        ceoGate: true,
        match: 'Access-Control-Allow-Origin: *',
        reason: 'Public wildcard CORS on AI/provider route can expose server provider keys to browser-origin abuse.',
        excerpt: lineText.trim(),
      });
    }

    if (/Authorization\s*:\s*`?Bearer\b/.test(lineText) || /Bearer\s+\$\{?/.test(lineText)) {
      findings.push({
        file,
        line,
        kind: 'provider-auth',
        severity: 'P1',
        ceoGate: true,
        match: 'Bearer provider auth',
        reason: 'Server-side provider authorization header is a real external-service boundary.',
        excerpt: lineText.trim(),
      });
    }

    if (/\bfetch\s*\(/.test(lineText) && /api\/(?:inner-shelter|adhd-flow|secretary)\/chat|generateContent|chat\/completions/.test(lineText)) {
      findings.push({
        file,
        line,
        kind: 'ai-fetch-call',
        severity: 'P1/P2',
        ceoGate: true,
        match: 'fetch AI/provider/proxy',
        reason: 'AI/provider/proxy fetch call requires mock-only QA and CEO-gated behavior changes.',
        excerpt: lineText.trim(),
      });
    }
  });
}

export function scanText(file, text) {
  const findings = [];
  addLineFindings(findings, file, text);
  addRegexFindings(
    findings,
    file,
    text,
    'provider-endpoint',
    PROVIDER_ENDPOINT_RE,
    'P1/P2',
    'Hard-coded AI provider endpoint or external provider URL.',
  );
  addRegexFindings(
    findings,
    file,
    text,
    'provider-env',
    PROVIDER_ENV_RE,
    'P1/P2',
    'Provider key/model env boundary; changing names/order requires CEO gate.',
  );
  addRegexFindings(
    findings,
    file,
    text,
    'model-id',
    MODEL_ID_RE,
    'P2',
    'Hard-coded provider model ID or default fallback model.',
  );
  addRegexFindings(
    findings,
    file,
    text,
    'public-proxy-fallback',
    PROXY_FALLBACK_RE,
    'P1',
    'Hard-coded public proxy/production fallback URL.',
  );
  return findings;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }
  return out;
}

function countBy(findings, key) {
  return findings.reduce((acc, finding) => {
    const value = finding[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function buildRiskFamilies(findings) {
  const has = (kind) => findings.some((finding) => finding.kind === kind);
  const families = [];
  if (has('wildcard-cors') || has('provider-auth')) {
    families.push({
      id: 'public-cors-provider-key',
      severity: 'P1',
      needsCeoGateForBehaviorChange: true,
      risk: 'Wildcard CORS plus server provider authorization can turn API routes into public AI proxies.',
      minimumNextSlice: 'Report-only first; later add allowed-origin/app-auth/rate-limit guard only after CEO gate.',
    });
  }
  if (has('provider-endpoint') || has('model-id') || has('provider-env')) {
    families.push({
      id: 'provider-model-config',
      severity: 'P1/P2',
      needsCeoGateForBehaviorChange: true,
      risk: 'Provider endpoints, env names, and model fallback order are production behavior boundaries.',
      minimumNextSlice: 'Introduce compatibility-preserving provider config inventory before any fallback/order change.',
    });
  }
  if (has('public-proxy-fallback') || has('ai-fetch-call')) {
    families.push({
      id: 'public-ai-proxy-fallback',
      severity: 'P1',
      needsCeoGateForBehaviorChange: true,
      risk: 'Public proxy fallback or proxy fetch can route user prompts through production/shared services.',
      minimumNextSlice: 'Plan fail-closed or explicit opt-in proxy behavior with mock-only tests after CEO gate.',
    });
  }
  return families;
}

export function buildAiProxyBoundaryReport(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const includeDirs = options.includeDirs || DEFAULT_INCLUDE_DIRS;
  const files = includeDirs.flatMap((dir) => walkFiles(path.join(rootDir, dir)));
  const findings = files.flatMap((filePath) => {
    const rel = path.relative(rootDir, filePath);
    const text = fs.readFileSync(filePath, 'utf8');
    return scanText(rel, text);
  });

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'static-report-only',
    networkCallsMade: false,
    rootDir,
    includeDirs,
    fileCount: files.length,
    totalFindings: findings.length,
    byKind: countBy(findings, 'kind'),
    bySeverity: countBy(findings, 'severity'),
    riskFamilies: buildRiskFamilies(findings),
    findings,
  };
}

export function formatMarkdownReport(report) {
  const topFindings = report.findings.slice(0, 40);
  const lines = [
    '# Public AI Proxy / Provider / CORS Boundary Inventory',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Network calls made: ${report.networkCallsMade ? 'yes' : 'no'}`,
    `Files scanned: ${report.fileCount}`,
    `Total findings: ${report.totalFindings}`,
    '',
    '## Counts By Kind',
    '',
    ...Object.entries(report.byKind).map(([kind, count]) => `- ${kind}: ${count}`),
    '',
    '## Risk Families',
    '',
    ...report.riskFamilies.flatMap((family) => [
      `### ${family.id}`,
      '',
      `- severity: ${family.severity}`,
      `- CEO gate for behavior change: ${family.needsCeoGateForBehaviorChange ? 'yes' : 'no'}`,
      `- risk: ${family.risk}`,
      `- minimum next slice: ${family.minimumNextSlice}`,
      '',
    ]),
    '## Representative Findings',
    '',
    ...topFindings.map(
      (finding) =>
        `- ${finding.file}:${finding.line} [${finding.kind}/${finding.severity}] ${finding.match} — ${finding.reason}`,
    ),
    '',
    '## Boundary',
    '',
    '- Static report only.',
    '- Does not import runtime routes.',
    '- Does not call real OpenAI, Gemini, Doubao, Vercel, or shared proxy services.',
    '- Does not change CORS, provider fallback order, env names, production URLs, UI, or real data flow.',
    '- CEO gate remains required before changing production AI proxy/provider/CORS behavior.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(arg, next);
      i += 1;
    } else {
      args.set(arg, true);
    }
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = args.get('--root') || process.cwd();
  const report = buildAiProxyBoundaryReport({ rootDir });
  const output = args.get('--markdown') ? formatMarkdownReport(report) : JSON.stringify(report, null, 2);
  const outPath = args.get('--out');
  if (outPath) {
    fs.writeFileSync(outPath, output);
  } else {
    process.stdout.write(output);
    if (!output.endsWith('\n')) process.stdout.write('\n');
  }
}
