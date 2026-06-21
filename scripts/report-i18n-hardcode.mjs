#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SCAN_ROOTS = Object.freeze([
  'components/portal',
  'app',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'test-results',
]);

const SCAN_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
]);

const SKIP_FILE_RE = /(^|\/)(.*\.(test|spec)\.(js|jsx|ts|tsx)|route\.test\.mjs|report-i18n-hardcode\.mjs|i18n-hardcode-scan\.test\.mjs)$/;

const CJK_UI_TEXT_RE = /[\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9 /·，。！？、：“”‘’《》（）【】\-]+/g;

const USER_FACING_ENGLISH_RE =
  /\b(?:Google Calendar|Local-first|Display name|Appearance|Language|Settings|Account|Home|Inventory|ChatGPT|Gemini|Claude|Live|Search)\b/g;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const scanRoots = args.roots.length ? args.roots : DEFAULT_SCAN_ROOTS;
  const files = await collectFiles(cwd, scanRoots);
  const findings = [];

  for (const file of files) {
    const content = await readFile(path.join(cwd, file), 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((text, index) => {
      const line = index + 1;
      findings.push(...extractFindings({ file, line, text, kind: 'cjk', re: CJK_UI_TEXT_RE }));
      findings.push(
        ...extractFindings({
          file,
          line,
          text,
          kind: 'userFacingEnglish',
          re: USER_FACING_ENGLISH_RE,
        }),
      );
    });
  }

  const report = buildReport({
    scanRoots,
    files,
    findings: dedupeFindings(findings),
  });

  if (args.jsonOutput) {
    await writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  const markdown = renderMarkdown(report);

  if (args.output) {
    await writeFile(args.output, markdown, 'utf8');
  }

  if (!args.jsonOutput || args.markdown || !args.output) {
    process.stdout.write(markdown);
  }
}

function extractFindings({ file, line, text, kind, re }) {
  re.lastIndex = 0;
  const findings = [];

  for (const match of text.matchAll(re)) {
    const value = match[0].trim();
    if (!value) continue;

    findings.push({
      file,
      line,
      kind,
      match: value,
      owner: 'Qiao / Luma',
      priority: isHighPriorityFile(file) ? 'P1' : 'P2',
      evidence: text.trim().slice(0, 160),
      suggestedAction:
        kind === 'cjk'
          ? 'Move this visible UI copy behind the portal i18n dictionary.'
          : 'Confirm this English UI label is intentional or move it behind the portal i18n dictionary.',
    });
  }

  return findings;
}

function buildReport({ scanRoots, files, findings }) {
  const byKind = {};
  const byFile = {};
  let highPriorityFindingCount = 0;

  for (const finding of findings) {
    byKind[finding.kind] = (byKind[finding.kind] || 0) + 1;
    byFile[finding.file] = (byFile[finding.file] || 0) + 1;
    if (finding.priority === 'P1') highPriorityFindingCount += 1;
  }

  return {
    version: 'i18n-hardcode-report-v0',
    mode: 'report-only',
    scanRoots,
    boundaries: {
      implementation: 'static-ui-string-scan',
      reportOnly: true,
      sourceWrites: false,
      translationWrites: false,
      runtimeEnforcement: false,
      externalServiceCalls: false,
    },
    summary: {
      scannedFileCount: files.length,
      findingCount: findings.length,
      highPriorityFindingCount,
      byKind,
      topFiles: Object.entries(byFile)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([file, count]) => ({ file, count })),
    },
    findings,
  };
}

function renderMarkdown(report) {
  const topFiles = report.summary.topFiles.length
    ? report.summary.topFiles.map((item) => `- ${item.file}: ${item.count}`).join('\n')
    : '- none';
  const findings = report.findings.length
    ? report.findings
        .slice(0, 120)
        .map(
          (finding) =>
            `- \`${finding.priority}\` \`${finding.kind}\` ${finding.file}:${finding.line} ${quote(
              finding.match,
            )} - owner: ${finding.owner}; action: ${finding.suggestedAction}`,
        )
        .join('\n')
    : '- none';

  return `# i18n Hard-code Report v0

Mode: report-only static UI string scan. No source writes, no runtime enforcement, no translation writes, no external calls.

## Summary

- scanned roots: ${report.scanRoots.map((root) => `\`${root}\``).join(', ')}
- scanned files: ${report.summary.scannedFileCount}
- findings: ${report.summary.findingCount}
- high priority findings: ${report.summary.highPriorityFindingCount}
- CJK findings: ${report.summary.byKind.cjk || 0}
- user-facing English findings: ${report.summary.byKind.userFacingEnglish || 0}

## Top Files

${topFiles}

## Findings

${findings}
`;
}

async function collectFiles(root, scanRoots) {
  const files = [];

  for (const scanRoot of scanRoots) {
    const absolute = path.join(root, scanRoot);
    if (!(await exists(absolute))) continue;

    const info = await stat(absolute);
    if (info.isFile()) {
      if (shouldScanFile(scanRoot)) files.push(normalizePath(scanRoot));
      continue;
    }

    await walkDirectory(root, absolute, files);
  }

  return files.sort();
}

async function walkDirectory(root, dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = normalizePath(path.relative(root, absolute));

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDirectory(root, absolute, files);
      continue;
    }

    if (entry.isFile() && shouldScanFile(relative)) {
      files.push(relative);
    }
  }
}

function shouldScanFile(file) {
  if (SKIP_FILE_RE.test(file)) return false;
  return SCAN_EXTENSIONS.has(path.extname(file));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function dedupeFindings(findings) {
  const seen = new Set();
  const result = [];

  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.kind}:${finding.match}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }

  return result;
}

function isHighPriorityFile(file) {
  if (/^components\/portal\//.test(file)) return true;
  if (/^app\/(?!api\/)/.test(file)) return true;
  return /(^|\/)(DashboardHome|AccountSettings|Portal|Secretary|Tools|Toolbox|Settings|page)\.(tsx|jsx|ts|js)$/.test(
    file,
  );
}

function parseArgs(argv) {
  const args = {
    roots: [],
    output: '',
    jsonOutput: '',
    markdown: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.roots.push(argv[++index]);
    } else if (arg === '--output') {
      args.output = argv[++index];
    } else if (arg === '--json-output') {
      args.jsonOutput = argv[++index];
    } else if (arg === '--markdown') {
      args.markdown = true;
    }
  }

  return args;
}

function normalizePath(file) {
  return String(file || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function quote(value) {
  return JSON.stringify(String(value));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
