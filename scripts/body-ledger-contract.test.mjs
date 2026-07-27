/**
 * 身体账本契约:美味记一餐 × 健康目标 × 护理入口。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const core = read('lib/portal/body-ledger.ts');
assert.match(core, /buildDayLedger/, '日账本');
assert.match(core, /suggestDinnerForGap/, '缺口∩库存补餐');
assert.match(core, /rankFoodReactions/, '稳飙探索');
assert.match(core, /listBeautyCareItems/, '护肤护理物品');
assert.match(core, /getMeals/, '吃来自记一餐');

const meals = read('lib/cooking/meals.ts');
assert.match(meals, /身体账本|occurredAt/, '记一餐喂账本');

const dash = read('components/portal/health/HealthDashboard.tsx');
assert.match(dash, /BodyLedgerPanel/, '健康挂身体账本');
assert.match(dash, /BeautyCarePanel/, '健康挂护理');
assert.match(dash, /身体账本|Body ledger/, '身体账本 tab');
assert.match(dash, /护理|Care/, '护理 tab');

const panel = read('components/portal/health/BodyLedgerPanel.tsx');
assert.match(panel, /BodyLedgerQuickLinks/, '概览快捷进入');
assert.match(panel, /suggestDinnerForGap|去做/, '补餐去做');

const css = read('app/globals.css');
assert.match(css, /\.nesio-body-ledger/, '账本样式');
assert.match(css, /\.nesio-beauty-care/, '护理样式');

console.log('body-ledger-contract: OK');
