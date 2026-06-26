#!/usr/bin/env node
/**
 * Platform Leak Check (PRD v3.0 §3.3 / §4.2).
 *
 * Static guardrail: Today-surface components must consume the Experience
 * view-model only. They must NOT import Integration-layer collection modules
 * (raw connectors / external fetchers). The Experience layer reasons through
 * the DEC + Life Domain, never reaches into connectors.
 *
 * Forbidding the Integration layer in Today keeps platform complexity from
 * leaking into the UI. A leak fails the build (physical fuse).
 *
 * Scope is intentionally tight for Stage 1: the Today surface components.
 * Allowed: lib/life-domain/*, lib/intelligence/* (platform), lib/portal/profile,
 * lib/portal/life-graph, lib/portal/prefetch-cache (normalized cache).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Today-surface components (the home output layer).
const TODAY_SURFACE = [
  'components/portal/TodayFeed.tsx',
  'components/portal/DailyBriefCard.tsx',
  'components/portal/LifeStateCard.tsx',
  'components/portal/VoiceBrief.tsx',
];

// Integration-layer modules forbidden in the Today surface.
const FORBIDDEN = [
  /@\/lib\/portal\/connectors/,
  /@\/lib\/portal\/weather/,
  /@\/lib\/portal\/flomo-api/,
  /@\/lib\/portal\/flomo-demo/,
  /@\/lib\/portal\/ics(['"/])/,
  /@\/lib\/integrations\//,
  /@\/app\/api\/portal\//,
];

const IMPORT_RE = /import[\s\S]*?from\s+['"]([^'"]+)['"]/g;

let leaks = 0;
for (const rel of TODAY_SURFACE) {
  let src;
  try {
    src = readFileSync(join(root, rel), 'utf8');
  } catch {
    continue; // file may not exist; skip
  }
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1];
    for (const pat of FORBIDDEN) {
      if (pat.test(spec)) {
        console.error(`✗ Platform Leak: ${rel} imports Integration module "${spec}"`);
        leaks++;
      }
    }
  }
}

if (leaks > 0) {
  console.error(`\nPlatform Leak Check failed: ${leaks} leak(s). Today must consume the view-model, not connectors.`);
  process.exit(1);
}
console.log('✓ Platform Leak Check passed — Today surface is decoupled from Integration layer.');
