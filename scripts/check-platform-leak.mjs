#!/usr/bin/env node
/**
 * Platform Leak Check (PRD v3.0 §3.1 / §3.3).
 *
 * Enforces the first production-grade dependency fuses for:
 * Experience -> Intelligence -> Life Domain -> Integration.
 *
 * The checker is intentionally static and local. It parses import/export
 * statements with AST tooling and fails build before a UI surface can couple
 * itself to raw connectors or private domain DTOs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { parse as parseTypeScript } from '@typescript-eslint/typescript-estree';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_EXT = /\.(tsx?|jsx?|mjs)$/;
const IGNORE_DIRS = new Set(['.git', '.next', 'node_modules', 'out', 'coverage', 'test-results']);

export const LAYER_RULES = [
  {
    name: 'components/portal/** must not import raw Integration modules',
    include: [/^components\/portal\//],
    forbidden: [
      /^@\/lib\/integrations\//,
      /^@\/lib\/portal\/connectors$/,
      /^@\/app\/api\/portal\//,
      /^@\/storage\//,
      /^@\/health\//,
      /^@\/finance\//,
      /^@\/lib\/portal\/gmail/,
      /^@\/lib\/portal\/weather$/,
      /^@\/lib\/portal\/flomo-api/,
    ],
  },
  {
    name: 'components/portal Today surface must consume TodayViewModel',
    include: [
      /^components\/portal\/TodayFeed\.tsx$/,
      /^components\/portal\/DailyBriefCard\.tsx$/,
      /^components\/portal\/LifeStateCard\.tsx$/,
      /^components\/portal\/VoiceBrief\.tsx$/,
      /^components\/portal\/today\//,
    ],
    forbidden: [
      /^@\/lib\/intelligence(\/dec)?$/,
      /^@\/lib\/life-domain\/signal$/,
      /^@\/lib\/portal\/life-graph$/,
    ],
    requireAnyImport: [/^@\/lib\/platform\/view-models\/today-view-model$/],
    requireAnyImportOnlyFor: [/^components\/portal\/TodayFeed\.tsx$/],
  },
  {
    name: 'lib/intelligence/** must not import raw Integration connectors',
    include: [/^lib\/intelligence\//],
    forbidden: [
      /^@\/lib\/integrations\//,
      /^\.\.\/integrations\//,
      /^@\/app\/api\//,
      /^@\/lib\/portal\/connectors$/,
      /^\.\.\/portal\/connectors$/,
      /^@\/lib\/portal\/gmail/,
      /^\.\.\/portal\/gmail/,
    ],
  },
  {
    name: 'lib/life-domain/** must stay UI-free and Integration-free',
    include: [/^lib\/life-domain\//],
    forbidden: [
      /^react$/,
      /^next\//,
      /^@\/components\//,
      /^\.\.\/components\//,
      /^@\/lib\/integrations\//,
      /^\.\.\/integrations\//,
      /^@\/app\/api\//,
    ],
  },
  {
    name: 'lib/integrations/** is the raw external boundary',
    include: [/^lib\/integrations\//],
    forbidden: [
      /^@\/components\//,
      /^\.\.\/components\//,
      /^@\/lib\/intelligence\//,
      /^\.\.\/intelligence\//,
    ],
  },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, files);
    else if (SOURCE_EXT.test(entry)) files.push(abs);
  }
  return files;
}

function importsFromAst(source, file) {
  const imports = new Set();
  const isTs = /\.[tj]sx?$/.test(file);
  try {
    const ast = isTs
      ? parseTypeScript(source, { jsx: true, loc: false, range: false, comment: false })
      : acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    for (const node of ast.body || []) {
      if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) {
        imports.add(String(node.source.value));
      }
    }
  } catch (err) {
    throw new Error(`Unable to parse imports in ${file}: ${err.message}`);
  }
  return [...imports];
}

function included(rule, rel) {
  return rule.include.some((pattern) => pattern.test(rel));
}

function importMatches(patterns, spec) {
  return patterns.some((pattern) => pattern.test(spec));
}

let leaks = 0;
const scanned = walk(root);

for (const abs of scanned) {
  const rel = relative(root, abs).replaceAll('\\', '/');
  const rules = LAYER_RULES.filter((rule) => included(rule, rel));
  if (rules.length === 0) continue;

  const src = readFileSync(abs, 'utf8');
  const imports = importsFromAst(src, rel);
  for (const rule of rules) {
    for (const spec of imports) {
      if (importMatches(rule.forbidden, spec)) {
        console.error(`✗ Platform Leak: ${rel} imports "${spec}" (${rule.name})`);
        leaks++;
      }
    }

    if (rule.requireAnyImport && (!rule.requireAnyImportOnlyFor || rule.requireAnyImportOnlyFor.some((pattern) => pattern.test(rel)))) {
      const ok = imports.some((spec) => importMatches(rule.requireAnyImport, spec));
      if (!ok) {
        console.error(`✗ Platform Leak: ${rel} must consume TodayViewModel (${rule.name})`);
        leaks++;
      }
    }
  }
}

if (leaks > 0) {
  console.error(`\nPlatform Leak Check failed: ${leaks} leak(s).`);
  process.exit(1);
}

console.log('✓ Platform Leak Check passed — Experience/Intelligence/Life Domain/Integration fuses are clean.');
