/**
 * 点同步记忆被掏空 —— 两处根因必须同时钉住:
 *   ① mergeCloudMemorySnapshot 在 saveAll 前再 loadAll 一次(水合竞态)
 *   ② Gmail 走 ingestLifeNodesBatch,禁止 forEach ingestLifeNode
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const merge = read('../lib/portal/life-graph.ts');
const region = merge.slice(
  merge.indexOf('export function mergeCloudMemorySnapshot'),
  merge.indexOf('export async function backfillLocalLifeGraphToCloud'),
);
assert.match(region, /for \(const localNode of loadAll\(\)\)/, '合并开头读本地');
const second = region.lastIndexOf('for (const localNode of loadAll())');
const first = region.indexOf('for (const localNode of loadAll())');
assert.ok(second > first, 'saveAll 前必须再 loadAll 一次,否则水合完成会把空种子 ∪ 云快照盖掉 IDB');
assert.match(merge, /export function whenGraphHydrated/, '同步路径要能等图谱水合');

const sync = read('../lib/portal/cloud-memory-sync.ts');
assert.match(sync, /whenGraphHydrated/, '拉云前等水合');

const gmail = read('../lib/portal/providers/connector-sync.ts');
assert.match(gmail, /ingestLifeNodesBatch/, 'Gmail 批量写入');
const runGmail = gmail.slice(gmail.indexOf('export async function runGmailSync'), gmail.indexOf('export async function syncAllConnectors'));
assert.doesNotMatch(runGmail, /nodes\.forEach\(\(n\) => ingestLifeNode/, '禁止逐条 ingestLifeNode 灌邮件');
assert.match(gmail, /CAL_PAST_MS/, '日历进记忆要覆盖 Granola 过去 30 天,不能只留昨天起');
assert.match(gmail, /relinkMeetingNotesToCalendar/, '日历同步后要补挂会议记录');

const hub = read('../components/portal/ConnectorsHub.tsx');
assert.match(hub, /ingestLifeNodesBatch/, '连接中心同步必须批量写图');
assert.doesNotMatch(hub, /data\.nodes!\.forEach\(\(n\) => ingestLifeNode/, '连接中心禁止逐条 ingest 邮件');
assert.match(hub, /whenGraphHydrated/, '点同步先等图谱水合');
assert.match(hub, /洞察 → 日程/, 'Granola 同步成功要告诉人会议记录在哪');

const calRoute = read('../app/api/portal/calendar/route.ts');
assert.match(calRoute, /CAL_PAST_MS/, 'Google 日历要从过去 35 天拉,否则历史会议挂不到日程');
assert.match(calRoute, /windowCalendarEvents/, '过去+未来不能整表 slice(80)把即将开始挤掉');

const settings = read('../components/portal/SettingsSheets.tsx');
assert.match(settings, /系统通知只在「宝盒」App 里响/, '浏览器里要明说系统通知不是 Safari/Chrome 那一项');

const ingest = read('../lib/life-domain/ingest-node.ts');
assert.match(ingest, /export function ingestLifeNodesBatch/, '批量入口存在');

assert.match(settings, /applyAllLocalNotifications/, '设置开关必须真的去排系统通知');
assert.match(settings, /teslaLowBatt/, 'Tesla 低电量是可勾选类目');
assert.match(settings, /familyChores/, '家庭家务是可勾选类目');

const tesla = read('../components/portal/TeslaPanel.tsx');
assert.match(tesla, /saveTeslaSnapshot/, '车页把快照写入 IDB');
assert.match(tesla, /mergeLastKnownLocation/, '没坐标时用上次停车点');
assert.match(tesla, /whenTeslaSnapshotReady/, '进页等本机快照水合');
assert.match(tesla, /本机还没有存过/, '有快照时禁止进页就打 Tesla API');
assert.match(read('../lib/portal/tesla-snapshot-store.ts'), /syncSeed:\s*true/, '车况首屏种子');

const family = read('../components/portal/today/FamilyTodayStrip.tsx');
assert.match(family, /saveFamilyBoards/, '家务板写入 IDB durable');
assert.match(family, /if \(!fr\.ok\) return/, '拉失败不许抹掉已存家务');
assert.match(family, /FETCH_DAY_KEY/, '同一天不重复拉家务 API');
assert.match(read('../lib/portal/family-board-store.ts'), /syncSeed:\s*true/, '家务板首屏种子');

const notify = read('../lib/portal/notify-apply.ts');
assert.match(notify, /checkLocalNotifyDisplay/, '排程前问系统权限,不只看 App 内开关');
assert.match(notify, /hasLocalNotifyChoice\(\) && display === 'granted'/, 'iOS 已授权且从未点过开关 → 自动开');
assert.match(notify, /plugin_missing/, '壳没插件要有可见原因');

const wardrobe = read('../components/portal/insights/WardrobePanel.tsx');
assert.match(wardrobe, /ZoomableImage/, '试穿图全屏可捏合放大');
assert.match(read('../app/globals.css'), /\.nesio-tryon-lightbox \{[\s\S]*?z-index:\s*950/,
  '试穿灯箱必须盖过洞察全屏(930),80 会被整页盖住');

console.log('sync-memory-wipe: OK(水合再并本地 / Gmail 批量 / 通知类目 / Tesla·家务 durable / 试穿全屏)');
