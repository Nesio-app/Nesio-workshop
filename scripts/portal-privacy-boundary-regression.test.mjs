import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const analyzeRoute = read('app/api/portal/analyze/route.ts');
const gmailRoute = read('app/api/portal/gmail/route.ts');
const todayFeed = read('components/portal/TodayFeed.tsx');
const lifeStateRoute = read('app/api/portal/life-state/route.ts');

assert.match(analyzeRoute, /isAnalyzeAiAllowed/, 'analyze route must gate real AI provider calls');
assert.match(analyzeRoute, /x-nesio-stage5-secret/, 'analyze route must support the Stage 5 invocation secret gate');
assert.match(analyzeRoute, /x-baohe-access-mode/, 'analyze route must support explicit personal lab mode');
assert.match(analyzeRoute, /analyzeFallback/, 'analyze route must keep local fallback available');

assert.match(gmailRoute, /metadataOnly/, 'Gmail route must expose metadata-only mode');
assert.match(gmailRoute, /includeBody/, 'Gmail route must require explicit body opt-in before reading email bodies');
assert.match(gmailRoute, /analyze=true/, 'Gmail route must require explicit analyze=true before AI extraction');
assert.doesNotMatch(
  gmailRoute,
  /const nodes = await extractNodes\(messages\);[\s\S]*emailCount: messages\.length/,
  'Gmail route must not automatically send fetched messages to AI extraction on every GET',
);

assert.doesNotMatch(todayFeed, /Linda|嗓子|灰色外套|储物间蓝盒子/, 'public Today fallback must not imply private personal knowledge');
assert.match(todayFeed, /sourceStatus/, 'Today cards must expose source status');
assert.match(todayFeed, /还没有足够记忆|告诉 Nesio 一件事/, 'Today fallback must invite explicit user input');

assert.match(lifeStateRoute, /fallbackExplanation/, 'life-state route must provide a non-error fallback explanation');
assert.doesNotMatch(lifeStateRoute, /status: 502/, 'life-state route must not surface provider empty responses as 502 in public runtime');

console.log('portal privacy boundary regression checks passed');
