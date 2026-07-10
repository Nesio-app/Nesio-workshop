/**
 * 契约:节日识别 + 未来预测轮播兜底(2026-07-04 批次 3 用户反馈)。
 *
 * 守护意图:
 * 1. 「Independence Day」这类日历/记忆条目必须被识别为 holiday,
 *    永远不能再以「今天截止」的任务口吻出现(用户原话:他要告诉我
 *    明天是 Holiday,有什么活动安排么)。
 * 2. holiday 卡不给任务式「开始」按钮,只给轻确认。
 * 3. (2026-07 v1 规格 §1 修订)回忆/引导区**不再硬凑**:轮播兜底废除,
 *    没有强触发就整格消失;「页面活着」由收据首行(nesio-today-receipt)负责;
 *    回忆卡日间 ≤1、晚间 ≤2,且尊重安静模式(预算 0 不出)。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');

const adapters = read('lib/platform/guidance-engine/source-adapters.ts');
const pipeline = read('lib/platform/guidance-engine/guidance-pipeline.ts');
const actionability = read('lib/platform/guidance-engine/actionability.ts');
const actionWindow = read('lib/platform/guidance-engine/action-window.ts');
const types = read('lib/platform/guidance-engine/types.ts');
const proactiveTypes = read('components/portal/today/proactive-types.ts');
const todayFeed = read('components/portal/TodayFeed.tsx');

// ── 1. holiday 类型存在且接入了识别 ──────────────────────────────────────────
assert.match(types, /'holiday'/, 'GuidanceEventType must include holiday.');
assert.match(adapters, /export function isHolidayTitle/, 'source-adapters must export the holiday title detector.');
assert.match(adapters, /independence day/i, 'Holiday regex must recognize Independence Day (the reported case).');
assert.match(adapters, /国庆|春节/, 'Holiday regex must cover Chinese holidays too.');
assert.match(adapters, /isHolidayTitle\(e\.title\)\) guidanceType = 'holiday'/, 'Calendar adapter must reclassify holiday titles before type mapping.');
assert.match(adapters, /isHolidayTitle\(node\.name\) \? 'holiday' : 'deadline'/, 'Focus-node adapter must not turn holidays into deadlines.');

// ── 2. holiday 的口吻是节日,不是任务 ────────────────────────────────────────
assert.match(pipeline, /case 'holiday':[\s\S]{0,200}今天是 \$\{n\}/, 'Holiday card title must read 今天是 X, not 今天截止.');
assert.match(pipeline, /明天是 \$\{n\}/, 'Holiday card must support the 明天是 X phrasing.');
assert.match(pipeline, /放假[\s\S]{0,60}活动安排/, 'Holiday card body must mention day-off and invite activity planning.');
const holidayAction = actionability.slice(actionability.indexOf("case 'holiday'"), actionability.indexOf("case 'deadline'"));
assert.ok(holidayAction.length > 0, 'actionability must handle holiday before deadline.');
assert.doesNotMatch(holidayAction, /开始/, 'Holiday action must not be a task-style 开始 button.');
assert.match(actionWindow, /case 'holiday':/, 'action-window must open a window for holiday (today/tomorrow).');

// ── 3. v1 规格 §1:不硬凑 —— 轮播兜底废除,收据首行负责「页面活着」 ────────────
assert.doesNotMatch(todayFeed, /buildRotatingFallback/, 'TodayFeed must NOT render the rotating fallback (v1 spec: no filler when nothing is due).');
assert.match(todayFeed, /nesio-today-receipt/, 'TodayFeed must render the receipt line (①安心态:the page stays alive via the receipt, not filler cards).');
assert.doesNotMatch(todayFeed, /cloudSyncSummary|getLifeGraphCloudSyncSummary|待同步/, 'Receipt must never surface sync counters (P0-1).');
assert.match(todayFeed, /getProactiveCardBudget\(\)/, 'Memory/guidance cards must respect the quiet-mode budget.');
assert.match(todayFeed, /isEvening \? 2 : 1/, 'Memory cards cap at 1 by day, 2 in the evening (§1.2).');
assert.match(todayFeed, /nesio-capture-hint/, 'TodayFeed must render the capture hint pointing at the FAB (④,the only hero action).');
// 兜底轮播的确定性纪律(builder 保留待删,若存在仍不得用 Math.random)
assert.doesNotMatch(proactiveTypes, /Math\.random\(\)/, 'proactive-types must not use Math.random (visual jumping).');

console.log('guidance holiday + today-receipt contract OK');
