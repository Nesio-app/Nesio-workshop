/**
 * 行为契约:足迹「计划(要去)」行程数据层 + UI 接线。
 *
 * - durable key nesio-travel-trips-v1(IDB blob,走通用 module-sync)
 * - TimelineTab 顶层 去过/计划 双模式
 * - 打包 need−have → 购物清单钩子
 * - 拍小票派 nesio-open-camera
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const store = read('lib/portal/travel-trips.ts');
assert.match(store, /nesio-travel-trips-v1/, '行程 durable key');
assert.match(store, /createBlobStore/, '走 IDB blob store');
assert.match(store, /completeTrip/, '完成后沉进足迹');
assert.match(store, /refreshPackingAgainstInventory/, '打包对照物品库');
assert.match(store, /pushPackingNeedsToShopping/, '需买 → 购物清单');
assert.match(store, /buildDemoTokyoTrip|ensureDemoTokyoTrip/, '东京 demo 种籽');
assert.match(store, /addToShopping/, '复用 cooking shopping');

const tab = read('components/portal/insights/TimelineTab.tsx');
assert.match(tab, /FootMode|'visited' \| 'plan'|footMode/, '足迹顶层模式');
assert.match(tab, /足迹\(去过\)|Footprints/, '去过 tab 文案');
assert.match(tab, /计划\(要去\)|Plans/, '计划 tab 文案');
assert.match(tab, /TravelPlanPanel/, '计划面板接线');
assert.match(tab, /listCompletedTrips/, '完成行程进去过');

const plan = read('components/portal/travel/TravelPlanPanel.tsx');
assert.match(plan, /ensureDemoTokyoTrip/, '打开计划种 demo');
assert.match(plan, /TripTimelineSheet/, '进竖轴时间线');
assert.match(plan, /新建行程|New itinerary/, '新建 CTA');

const timeline = read('components/portal/travel/TripTimelineSheet.tsx');
assert.match(timeline, /is-todo|is-booked/, '实心/描边节点态');
assert.match(timeline, /TripNodeDetailBody/, '节点详情');
assert.match(timeline, /completeTrip/, '完成 · 进足迹');

const detail = read('components/portal/travel/TripNodeDetailSheets.tsx');
assert.match(detail, /nesio-open-camera/, '拍小票事件');
assert.match(detail, /pushPackingNeedsToShopping/, '打包推购物清单 UI');
assert.match(detail, /FlightDetail|HotelDetail|ShoppingDetail|PackingDetail|BudgetDetail/, '五类详情');

const portal = read('components/portal/Portal.tsx');
assert.match(portal, /nesio-open-camera/, 'Portal 监听拍小票');
assert.match(portal, /nesio-travel-trips-v1/, '存储键人话标签');

const css = read('app/globals.css');
assert.match(css, /\.nesio-foot-modes/, '去过/计划顶栏样式');
assert.match(css, /\.nesio-trip-node-dot\.is-booked/, '实心节点');
assert.match(css, /\.nesio-trip-node-dot\.is-todo/, '描边节点');
assert.match(css, /\.nesio-travel-plan/, '计划列表样式');
assert.doesNotMatch(
  css.match(/\/\* ── 足迹 · 行程计划[\s\S]*$/)?.[0] || '',
  /#8b5cf6|#3b82f6|#ef4444|#10b981|#f59e0b/,
  '行程 CSS 不得用废弃硬编码色',
);

console.log('travel-trips-contract: OK');
