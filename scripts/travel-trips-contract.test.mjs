/**
 * 行为契约:足迹「计划」行程 + 世界落点 + 真功能钩子。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const store = read('lib/portal/travel-trips.ts');
assert.match(store, /nesio-travel-trips-v1/, '行程 durable key');
assert.match(store, /createBlobStore/, '走 IDB blob store');
assert.match(store, /completeTrip/, '完成后沉进足迹/世界');
assert.match(store, /parseBookingConfirmation|importBookingIntoTrip/, '订票确认解析');
assert.match(store, /generatePackingList/, '生成打包清单');
assert.match(store, /appendShoppingReceipt/, '小票入行程');
assert.match(store, /setFlightCheckInReminder/, '值机提醒');
assert.match(store, /armTravelReceiptCapture/, '拍小票挂行程');
assert.match(store, /addPoisToTrip|kind: 'poi'/, '离线景点可写入行程');

const poi = read('lib/portal/travel-poi.ts');
assert.match(poi, /\/data\/travel-poi\//, 'POI 走 public 静态包');
assert.match(poi, /suggestPoisForDestination/, '按目的地推荐');
assert.ok(fs.existsSync(path.join(root, 'public/data/travel-poi/japan-attractions.json')), '日本景点包存在');
assert.ok(fs.existsSync(path.join(root, 'public/data/travel-poi/tokyo-attractions.json')), '东京景点包存在');

const tab = read('components/portal/insights/TimelineTab.tsx');
assert.doesNotMatch(tab, /FootMode|足迹\(去过\)|nesio-foot-modes/, '不再用顶层去过/计划双栏');
assert.match(tab, /\['plan',\s*'计划'/, '计划为第 4 个 sub tab');
assert.match(tab, /sub === 'world' && doneTrips/, '完成行程在世界 tab');
assert.match(tab, /TravelPlanPanel/, '计划面板接线');

const plan = read('components/portal/travel/TravelPlanPanel.tsx');
assert.doesNotMatch(plan, /ensureDemoTokyoTrip/, '不再自动种 demo');
assert.match(plan, /importBookingIntoTrip|粘贴订票确认/, '订票导入真功能');
assert.match(plan, /TripTimelineSheet/, '进竖轴时间线');

const timeline = read('components/portal/travel/TripTimelineSheet.tsx');
assert.match(timeline, /is-todo|is-booked/, '实心/描边节点态');
assert.match(timeline, /addTripNode|generatePackingList/, '时间线可加节点/打包');
assert.match(timeline, /完成 · 进世界|Done · to World/, '完成进世界');
assert.match(timeline, /TripPoiPicker|\+ 离线景点/, '时间线可加离线景点');

const detail = read('components/portal/travel/TripNodeDetailSheets.tsx');
assert.match(detail, /setFlightCheckInReminder/, '航班提醒真功能');
assert.match(detail, /armTravelReceiptCapture/, '拍小票挂行程');
assert.match(detail, /openstreetmap|nesio-trip-map/, '酒店真地图');
assert.match(detail, /PoiDetail|kind === 'poi'/, '景点详情');

const camera = read('components/portal/CameraSheet.tsx');
assert.match(camera, /consumeTravelReceiptTripId|appendShoppingReceipt/, '相机保存写入行程购物');

const portal = read('components/portal/Portal.tsx');
assert.match(portal, /nesio-open-camera/, 'Portal 监听拍小票');

const css = read('app/globals.css');
assert.match(css, /\.nesio-insights-sheet-card\s*\{[^}]*inset:\s*0/s, '洞察真全屏 inset:0');
assert.match(css, /\.cooking-skin\s*\{[^}]*var\(--portal-bg\)/s, '美味跟主题底色');
assert.doesNotMatch(css, /\.cooking-skin\s*\{[^}]*--portal-accent:#5c7389/s, '美味不得锁死石板蓝');
assert.match(css, /\.nesio-trip-node-dot\.is-booked/, '实心节点');
assert.match(css, /\.nesio-travel-plan/, '计划列表样式');
assert.match(css, /\.nesio-trip-poi-list/, '离线景点选择器样式');

const sw = read('public/sw.js');
assert.match(sw, /pathname\.startsWith\('\/data\/'\)/, 'SW 缓存 /data 离线包');

const portalMount = read('components/portal/Portal.tsx');
assert.match(portalMount, /insightsOpen[\s\S]*?variant=["']fullscreen["']/s, '洞察 fullscreen 挂载');

console.log('travel-trips-contract: OK');
