import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const portal = read('components/portal/Portal.tsx');
// Today 表面已按工程 PRD 拆分(容器+today/);契约约束整个表面
const todayFeed = [
  read('components/portal/TodayFeed.tsx'),
  read('components/portal/today/useTodayData.ts'),
  read('components/portal/today/ProactiveGuidanceCard.tsx'),
  read('components/portal/today/FocusSection.tsx'),
  read('components/portal/today/FocusCardDetail.tsx'),
  read('components/portal/today/CalendarCards.tsx'),
  read('components/portal/today/DormantReviewCard.tsx'),
  read('components/portal/today/NightTimeline.tsx'),
].join('\n');
const dailyBrief = read('components/portal/DailyBriefCard.tsx');
const todayViewModel = read('lib/platform/view-models/today-view-model.ts');
const memoryTab = read('components/portal/MemoryTab.tsx');
const nodeDetail = read('components/portal/MemoryNodeDetail.tsx');
const lifeGraph = read('lib/portal/life-graph.ts');
const integrations = read('lib/portal/integrations.ts');
const calendarRoute = read('app/api/portal/calendar/route.ts');
const gmailRoute = read('app/api/portal/gmail/route.ts');
const packageJson = JSON.parse(read('package.json'));

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0, `${message} Missing marker: ${first}`);
  assert.ok(secondIndex >= 0, `${message} Missing marker: ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

assert.match(
  calendarRoute,
  /requireAuthenticatedCalendarAccess/,
  'Calendar API must require Nesio auth or an explicit lab-mode request before returning real events.',
);
assert.match(
  calendarRoute,
  /calendar_auth_required/,
  'Calendar API must fail closed with a safe auth-required response for anonymous callers.',
);
assert.match(
  gmailRoute,
  /requireAuthenticatedGmailAccess/,
  'Gmail API must require Nesio auth or explicit lab-mode before returning metadata from a mailbox.',
);
assert.match(
  integrations,
  /allowCookieIntegrationFallback/,
  'Integration cookie fallback must be explicit and disabled by default, not an anonymous data path.',
);
assert.match(
  integrations,
  /if \(allowCookieIntegrationFallback\(\)\) \{\s*return readTokensFromCookies\(provider\);/s,
  'Integration token lookup must only fall back to OAuth cookies inside the explicit escape hatch.',
);

assert.match(
  portal,
  /fetch\('\/api\/auth\/session'/,
  'Portal must check the Nesio auth session before running real connectors.',
);
assert.match(
  portal,
  /canUsePrivateRuntime/,
  'Portal must derive one runtime gate for private data connectors and surfaces.',
);
assert.doesNotMatch(
  portal,
  /useEffect\(\(\) => \{\s*pruneDisposableSignals\(\);\s*runConnectors\(\)/,
  'Portal must not run real connectors unconditionally on anonymous mount.',
);
assert.match(
  portal,
  /<TodayFeed[\s\S]*canUsePrivateData=\{canUsePrivateRuntime\}/,
  'TodayFeed must receive the same private-data gate used by connectors.',
);
assert.match(
  portal,
  /sessionStorage\.removeItem\(PORTAL_CACHE_KEYS\.calendar\)/,
  'Portal must clear stale private calendar cache while signed out.',
);
assert.match(
  portal,
  /<MemoryTab[\s\S]*canUsePrivateData=\{canUsePrivateRuntime\}/,
  'MemoryTab must receive the same private-data gate used by connectors.',
);

for (const [name, source] of [
  ['TodayFeed', todayFeed],
  ['DailyBriefCard', dailyBrief],
  ['MemoryTab', memoryTab],
]) {
  assert.match(
    source,
    /canUsePrivateData/,
    `${name} must support a signed-out empty/demo state instead of reading the Life Graph unconditionally.`,
  );
}
// Calendar reads live behind lib/portal/environment.getCachedCalendarEvents()
// since the environment-layer refactor; the gate must still come first.
assertBefore(
  dailyBrief,
  'if (canUsePrivateData)',
  'getCachedCalendarEvents()',
  'DailyBriefCard must check the private-data gate before reading cached calendar events.',
);
assert.match(
  dailyBrief,
  /if \(canUsePrivateData\) \{[\s\S]*localStorage\.getItem\(BRIEF_CACHE_KEY\)/,
  'DailyBriefCard must only load cached private brief scripts while signed in.',
);
assert.doesNotMatch(
  dailyBrief,
  /getRecentNodes/,
  'DailyBriefCard must not read Life Graph directly; gated memory notes must come from TodayViewModel.',
);
// LifeStateCard retired; cross-signal life state now computes inside the
// gated TodayViewModel (runDEC → computeLifeState) — the gate must come first.
assertBefore(
  todayViewModel,
  'if (!input.canUsePrivateData)',
  'generateTodayCards(',
  'TodayViewModel must check the private-data gate before running DEC / computing life state.',
);
assert.match(
  todayFeed,
  /buildTodayViewModel\(\{ canUsePrivateData,[\s\S]*cloudSignals/,
  'TodayFeed must derive Today cards and memory notes through the gated TodayViewModel.',
);
// 听简报卡在批次 40 从 Today 下架,停在路线图(待开发)。若它回归 Today,
// 隐私门不能绕过:必须仍然只收 gated 的 canUsePrivateData + memoryNotes。
// DailyBriefCard.tsx 自身的门(上面 97-122 行)始终强制,故停用期间也不漏。
if (/<DailyBriefCard/.test(todayFeed)) {
  assert.match(
    todayFeed,
    /<DailyBriefCard[\s\S]*canUsePrivateData=\{canUsePrivateData\}[\s\S]*memoryNotes=\{memoryNotes\}/,
    'DailyBriefCard, when rendered in TodayFeed, must receive gated memoryNotes.',
  );
}
assertBefore(
  memoryTab,
  'visibleMemoryNodes',
  'const results',
  'MemoryTab must filter private external calendar/email nodes before rendering signed-out Memory results.',
);
assert.match(
  memoryTab,
  /isPrivateExternalNode/,
  'MemoryTab must use the Life Graph private external-node classifier instead of hiding all local records.',
);
assert.doesNotMatch(
  memoryTab,
  /if \(!canUsePrivateData\) \{\s*setNodes\(\[\]\);/,
  'Signed-out Memory should keep local voice/photo/manual records visible while filtering external private nodes.',
);

assert.match(
  lifeGraph,
  /isPrivateExternalNode/,
  'Life Graph must classify private external nodes such as calendar/email imports.',
);
assert.match(
  lifeGraph,
  /prunePrivateExternalNodes/,
  'Life Graph must expose a local cleanup hook for previously cached anonymous external nodes.',
);
assert.match(
  nodeDetail,
  /HIDDEN_ATTRIBUTE_KEYS/,
  'Memory detail must hide production-sensitive debug attributes by default.',
);
assert.doesNotMatch(
  nodeDetail,
  /const attrs = Object\.entries\(n\.attributes\)\.filter\(\(\[, v\]\) => v !== null && v !== ''\);/,
  'Memory detail must not display every raw attribute such as calendarId/start/end/calendarName.',
);

assert.equal(
  packageJson.scripts['test:anonymous-private-data-gate'],
  'node scripts/anonymous-private-data-gate.test.mjs',
  'package.json must expose test:anonymous-private-data-gate.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:anonymous-private-data-gate/,
  'test:security must include anonymous private data gate coverage.',
);

console.log('anonymous private data gate checks passed');
