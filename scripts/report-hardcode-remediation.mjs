#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  classifyHardcodeFinding,
  summarizeClassifications,
} from '../lib/portal/hardcode-remediation-classifier.mjs';

const DEFAULT_SCAN_ROOTS = Object.freeze([
  'app',
  'lib',
  'public',
  'scripts',
  'adhd-flow-ios',
  'fitness',
  'inner-shelter-ios',
  'storage-ios',
  'questionbank-ios',
  'treasurebox-ios',
  'README.md',
  'DEPLOY.md',
  'vercel.json',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'ios',
  'resources',
  'Assets.xcassets',
  'exhibits',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
]);

const SKIP_FILE_RE =
  /(^|\/)(package-lock\.json|hardcode-remediation-classifier\.mjs|report-hardcode-remediation(\.test)?\.mjs)$/;

const FINDING_PATTERNS = Object.freeze([
  { kind: 'url', re: /https?:\/\/[^\s'"`),\]]+/g },
  { kind: 'env', re: /\b(?:[A-Z][A-Z0-9]+_)+(?:URL|URI|HOST|KEY|TOKEN|WEBHOOK|MODEL|ORIGINS?|API|ICAL|ICS)\b/g },
  { kind: 'route-contract', re: /\b(?:LOCAL_STATIC_MODULE_PATHS|routeKey|moduleId|openHref|returnHref|rewrites)\b/g },
  { kind: 'rendering', re: /\binnerHTML\b/g },
  { kind: 'provider', re: /\b(?:doubao|gemini|openai|FLOMO|FIDELITY|GOOGLE_CALENDAR)\b/g },
]);

const REMEDIATION_BATCHES = Object.freeze(['A', 'B', 'C', 'D']);

const CEO_GATE_TEXT_RE =
  /FLOMO|flomoapp|ICAL|ICS|FIDELITY|0x0\.st|WEBHOOK|Bearer|PRODUCTION_URL|LIFEFLOW_PRODUCTION_URL|DEPLOY_URL|DEFAULT_API|ADHD_FLOW_API|INNER_SHELTER_API(?:_HOST|_URL)?|SECRETARY_API|STORAGE_API|API_URL|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GOOGLE_AI_API_KEY|GOOGLE_API_KEY|DEFAULT_MODELS|GEMINI_MODEL|api\.openai\.com|generativelanguage\.googleapis\.com|ark\.cn-beijing\.volces\.com|https:\/\/[a-z0-9-]+\.vercel\.app/i;

const PROVIDER_LABEL_RE = /\b(?:openai|gemini|doubao|GOOGLE_CALENDAR|FIDELITY|FLOMO)\b/i;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const scanRoots = args.roots.length ? args.roots : DEFAULT_SCAN_ROOTS;
  const files = await collectFiles(root, scanRoots);
  const findings = [];

  for (const file of files) {
    const absoluteFile = path.join(root, file);
    const content = await readFile(absoluteFile, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((lineText, index) => {
      const line = index + 1;
      for (const pattern of FINDING_PATTERNS) {
        pattern.re.lastIndex = 0;
        for (const match of lineText.matchAll(pattern.re)) {
          const finding = {
            file,
            line,
            kind: pattern.kind,
            match: match[0],
            text: lineText.trim(),
          };
          findings.push({
            ...finding,
            classification: classifyHardcodeFinding(finding),
          });
        }
      }
    });
  }

  const reportData = buildReportData({
    findings: dedupeFindings(findings),
    scanRoots,
  });
  const report = renderReport(reportData);

  if (args.output) {
    await writeFile(args.output, report, 'utf8');
  } else {
    process.stdout.write(report);
  }

  if (args.jsonOutput) {
    await writeFile(args.jsonOutput, `${JSON.stringify(reportData, null, 2)}\n`, 'utf8');
  }
}

function buildReportData({ findings, scanRoots }) {
  const taggedFindings = findings.map((finding) => ({
    ...finding,
    remediationBatch: classifyRemediationBatch(finding),
  }));
  const summary = {
    ...summarizeClassifications(taggedFindings),
    byRemediationBatch: summarizeRemediationBatches(taggedFindings),
  };
  return {
    schemaVersion: 1,
    reportKind: 'hardcode-remediation',
    mode: 'report-only',
    scanRoots,
    summary,
    findings: taggedFindings,
  };
}

function renderReport({ findings, scanRoots, summary }) {
  const byCategory = groupBy(findings, (finding) => finding.classification.category);
  const ceoGateFindings = findings.filter((finding) => finding.classification.ceoGate);
  const topRuntime = firstN(byCategory.runtime || [], 24);
  const topProvider = firstN(byCategory['provider-config'] || [], 24);
  const topRoute = firstN(byCategory['route-contract'] || [], 18);
  const topDocs = firstN(byCategory['docs-example'] || [], 12);
  const topAcceptable = firstN(byCategory['acceptable-constant'] || [], 12);

  return `# 2026-06-15 Hard-code Remediation v3 Batch Tagging Engineering

Agent: Ren / Hard-code & Security Remediation Engineer
Mode: report-only remediationBatch JSON/Markdown tagging QA-blocker fix; no runtime behavior change; no UI change; no route change; no deploy.
Workspace: /Users/jing/Documents/Codex/treasurebox-src

## Scope Guard

- Did not edit Shell Route active files: \`lib/portal/module-manager-core.mjs\`, \`lib/portal/module-manager-core.d.ts\`, \`lib/portal/module-manager.ts\`, \`scripts/report-module-registry.mjs\`.
- Did not change production URL values, provider fallback order, env/secret names, external authorization, real services, UI, routes, Notion, or real data.
- Fixed only report visibility metadata: expanded C batch tagging for production URL/provider/calendar/public-AI-proxy/env boundary findings.
- Kept complete JSON, Markdown full-list appendix, and derived A/B/C/D remediation batch tags report-only.
- Did not change classifier risk category semantics or remediation priority.

## Classifier Summary

- scanned roots: ${scanRoots.map((root) => `\`${root}\``).join(', ')}
- total findings: ${summary.total}
- runtime: ${summary.byCategory.runtime}
- provider-config: ${summary.byCategory['provider-config']}
- route-contract: ${summary.byCategory['route-contract']}
- docs-example: ${summary.byCategory['docs-example']}
- acceptable-constant: ${summary.byCategory['acceptable-constant']}
- CEO-gated finding signals: ${summary.ceoGateCount}

## Remediation Batch Summary

- A: ${summary.byRemediationBatch.A}
- B: ${summary.byRemediationBatch.B}
- C: ${summary.byRemediationBatch.C}
- D: ${summary.byRemediationBatch.D}

## Runtime Findings

${renderFindingList(topRuntime)}

## Provider Config Findings

${renderFindingList(topProvider)}

## Route Contract Findings

${renderFindingList(topRoute)}

## Docs / Example Findings

${renderFindingList(topDocs)}

## Acceptable Constants

${renderFindingList(topAcceptable)}

## CEO Gate Items

These are report signals only, not remediated changes:

${renderFindingList(firstN(ceoGateFindings, 24))}

CEO gate remains required before changing real production URL defaults, external provider authorization, Flomo/calendar/private data exposure, upload provider behavior, public AI proxy boundaries, or provider fallback order.

## Full Findings Appendix

This appendix intentionally lists every deduped finding for Ming/Zhao false-positive and false-negative review. It does not change classifier risk semantics or remediation priority.

${renderFindingList(findings)}

## Minimal Engineering Plan

1. Keep this classifier and batch tagger report-only until Zhao validates batch counts and C-gate separation.
2. Use \`remediationBatch\` to filter A/B/C/D without changing \`classification.category\`, \`classification.severity\`, or \`classification.ceoGate\`.
3. QA-blocker fix covered \`PRODUCTION_URL\`, \`LIFEFLOW_PRODUCTION_URL\`, \`GOOGLE_CALENDAR_ICS_URL\`, \`ADHD_FLOW_API\`, \`INNER_SHELTER_API\`, provider labels/branches, and portal-config production URLs as C.
4. Runtime URL fallback changes, provider/env changes, real-service enable/disable decisions, upload behavior, public AI proxy boundaries, secret naming, and provider fallback order remain CEO-gated.

\`\`\`handoff
status: ready
from: Ren
to: Zhao
reason: hard-code remediation v3 QA-blocker fix expanded C batch tagging for production/provider/calendar/public-AI/env-boundary findings
needs_ceo_gate: no
resume_action: reset 后先运行 node scripts/report-hardcode-remediation.test.mjs，再运行 node scripts/report-hardcode-remediation.mjs --output /Users/jing/Documents/Codex/2026-06-12/https-treasurebox-nu-vercel-app-https/outputs/2026-06-15-hardcode-remediation-v3-batch-tagging-engineering.md --json-output /Users/jing/Documents/Codex/2026-06-12/https-treasurebox-nu-vercel-app-https/outputs/2026-06-15-hardcode-remediation-v3-findings.json，然后由 Zhao 复核 batch counts、JSON remediationBatch 覆盖率、C 组 gate 分离
artifact: outputs/2026-06-15-hardcode-remediation-v3-batch-tagging-engineering.md; outputs/2026-06-15-hardcode-remediation-v3-findings.json
blocker: 无
\`\`\`
`;
}

function renderFindingList(findings) {
  if (!findings.length) return '- none';

  return findings
    .map((finding) => {
      const reason = finding.classification.reason;
      return `- \`batch:${finding.remediationBatch}\` \`${finding.classification.category}\` ${finding.classification.severity}: ${finding.file}:${finding.line} (${finding.kind}) ${quote(finding.match)} - ${reason}`;
    })
    .join('\n');
}

function classifyRemediationBatch(finding) {
  const text = `${finding.file || ''} ${finding.match || ''} ${finding.text || ''}`;
  const category = finding.classification?.category;

  if (category === 'docs-example') {
    return 'D';
  }

  if (isCeoGatedRemediation(text, finding)) {
    return 'C';
  }

  if (category === 'acceptable-constant') {
    return 'D';
  }

  if (category === 'runtime' && /\binnerHTML\b/i.test(text)) {
    return 'B';
  }

  return 'A';
}

function isCeoGatedRemediation(text, finding) {
  if (finding.classification?.ceoGate) return true;
  if (CEO_GATE_TEXT_RE.test(text)) return true;

  return (
    ['provider-config', 'runtime', 'route-contract'].includes(finding.classification?.category) &&
    PROVIDER_LABEL_RE.test(text)
  );
}

function summarizeRemediationBatches(findings) {
  const counts = Object.fromEntries(REMEDIATION_BATCHES.map((batch) => [batch, 0]));

  for (const finding of findings) {
    counts[finding.remediationBatch] = (counts[finding.remediationBatch] || 0) + 1;
  }

  return counts;
}

async function collectFiles(root, scanRoots) {
  const files = [];

  for (const scanRoot of scanRoots) {
    const absolutePath = path.join(root, scanRoot);
    let entryStat;
    try {
      entryStat = await stat(absolutePath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      await walk(root, scanRoot, files);
    } else if (isTextFile(scanRoot)) {
      files.push(scanRoot);
    }
  }

  return files.sort();
}

async function walk(root, relativeDir, files) {
  const entries = await readdir(path.join(root, relativeDir), { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, relativePath, files);
      continue;
    }

    if (entry.isFile() && isTextFile(relativePath)) {
      files.push(relativePath);
    }
  }
}

function isTextFile(file) {
  if (SKIP_FILE_RE.test(file.replaceAll('\\', '/'))) return false;
  return TEXT_EXTENSIONS.has(path.extname(file));
}

function dedupeFindings(findings) {
  const seen = new Set();
  const unique = [];

  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.kind}:${finding.match}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }

  return unique;
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function firstN(items, count) {
  return items.slice(0, count);
}

function quote(value) {
  const text = String(value);
  return `\`${text.length > 96 ? `${text.slice(0, 93)}...` : text}\``;
}

function parseArgs(args) {
  const parsed = {
    jsonOutput: '',
    output: '',
    roots: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output') {
      parsed.output = args[index + 1] || '';
      index += 1;
    } else if (arg === '--json-output') {
      parsed.jsonOutput = args[index + 1] || '';
      index += 1;
    } else if (arg === '--root') {
      parsed.roots.push(args[index + 1]);
      index += 1;
    }
  }

  return parsed;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
