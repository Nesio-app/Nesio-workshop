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

const ingest = read('../lib/life-domain/ingest-node.ts');
assert.match(ingest, /export function ingestLifeNodesBatch/, '批量入口存在');

const settings = read('../components/portal/SettingsSheets.tsx');
assert.match(settings, /applyAllLocalNotifications/, '设置开关必须真的去排系统通知');
assert.match(settings, /teslaLowBatt/, 'Tesla 低电量是可勾选类目');
assert.match(settings, /familyChores/, '家庭家务是可勾选类目');

const tesla = read('../components/portal/TeslaPanel.tsx');
assert.match(tesla, /saveTeslaSnapshot/, '车页把快照写入 IDB');
assert.match(tesla, /mergeLastKnownLocation/, '没坐标时用上次停车点');

const family = read('../components/portal/today/FamilyTodayStrip.tsx');
assert.match(family, /saveFamilyBoards/, '家务板写入 IDB durable');

console.log('sync-memory-wipe: OK(水合再并本地 / Gmail 批量 / 通知类目 / Tesla·家务 durable)');
