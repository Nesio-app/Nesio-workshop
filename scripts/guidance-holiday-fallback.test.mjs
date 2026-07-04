/**
 * 契约:节日识别 + 未来预测轮播兜底(2026-07-04 批次 3 用户反馈)。
 *
 * 守护意图:
 * 1. 「Independence Day」这类日历/记忆条目必须被识别为 holiday,
 *    永远不能再以「今天截止」的任务口吻出现(用户原话:他要告诉我
 *    明天是 Holiday,有什么活动安排么)。
 * 2. holiday 卡不给任务式「开始」按钮,只给轻确认。
 * 3. 未来预测区永远有内容:管线空窗时走 buildRotatingFallback
 *    (历史上的今天 / 记忆回顾 / 时间段建议 / 小技巧),随机轮播。
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

// ── 3. 未来预测永远有内容:轮播兜底 ──────────────────────────────────────────
assert.match(proactiveTypes, /export function buildRotatingFallback/, 'proactive-types must export the rotating fallback builder.');
assert.match(proactiveTypes, /历史上的今天/, 'Fallback pool must include on-this-day memories.');
assert.match(proactiveTypes, /记忆回顾/, 'Fallback pool must include memory resurfacing.');
assert.match(proactiveTypes, /Math\.random\(\)/, 'Fallback must rotate (different card per open).');
assert.match(todayFeed, /buildRotatingFallback/, 'TodayFeed must render the rotating fallback when the pipeline is empty.');
assert.match(todayFeed, /activeProactiveCards\.length === 0 && cardBudget > 0/, 'Fallback only fills真空窗,且尊重安静模式(预算 0 不出)。');

console.log('guidance holiday + rotating fallback contract OK');
