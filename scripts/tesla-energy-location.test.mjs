/**
 * 行为契约:特斯拉的**能源**和**位置**要真的用上(2026-07-30,用户点名的功能)。
 *
 * 用户原话:「特斯拉的 API 是有能源,位置 API 的,目前一直未实现。
 * 如果可以,做成图 2,和 4 这样的可视化,在车的页面。」
 *   图 2 = 车在地图上的位置;图 4 = 随时间变化的曲线。
 *
 * 「一直未实现」的具体原因,查出来是这个:授权页里「Energy Product Information」
 * 本来就是勾上的,可 `TESLA_SCOPES` 串里**从来没有 energy_device_data** ——
 * 于是家里那套能源产品的数据一次都没取过。位置那边坐标早就取到了,
 * 只是没有任何地方把它画出来。
 *
 * 这条契约钉四件事:
 *   ① scope 里必须有 energy_device_data(否则整条线从源头就是空的);
 *   ② 能源与车辆**分开失败** —— 家里没有太阳能/Powerwall 的人,
 *      不能因此连车辆数据都看不到;
 *   ③ 图 4 那条曲线必须来自**真的时间序列**,不许拿「此刻」这一个点重复画成一条线;
 *   ④ 稀疏的曲线要照实说稀疏 —— 车的接口只回「此刻」,那条线只有
 *      「你打开过这一页的时刻」,画成平滑折线就是在假装全天候采样。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ══ ① scope ══════════════════════════════════════════════════════ */
{
  const src = read('lib/portal/tesla.ts');
  assert.match(src, /export const TESLA_SCOPES = '[^']*\benergy_device_data\b/,
    '授权页里 Energy Product Information 本来就是勾上的,可 scope 串里一直没有它 —— ' +
    '「能源 API 一直未实现」的根就在这一行');
  assert.match(src, /vehicle_location/, '位置权限还得在,它是坐标的前提');
  assert.match(src, /重新授权/, 'scope 是发 token 时定死的:加了也要重新授权一次才生效,这句话得写在代码旁边');
}

/* ══ ② 能源和车辆分开失败 ═════════════════════════════════════════ */
{
  const src = read('lib/portal/tesla.ts');
  assert.match(src, /export async function collectTeslaEnergy/, '能源单独一个采集函数');
  assert.match(src, /\/api\/1\/products/, '能源站点从 products 列出来');
  assert.match(src, /energy_sites\/\$\{s\.siteId\}\/live_status/, '此刻的功率流向');
  assert.match(src, /teslaGet\(`\/api\/1\/energy_sites\/\$\{s\.siteId\}\/history\?kind=energy&period=day`/,
    '按天的进出电量必须**真去调那个历史接口**(不是只在注释里提一句)—— ' +
    '图 4 不能拿此刻这一个点重复画成一条线');

  const route = read('app/api/portal/tesla/route.ts');
  assert.match(route, /try \{\s*const e = await collectTeslaEnergy/,
    '能源必须 best-effort:家里没有能源产品、或 token 缺 scope,都不能把车辆数据拖没了');
  assert.match(route, /unavailable: 'scope'/,
    '403 = 这枚 token 没有 energy_device_data。要如实告诉前端 —— ' +
    '直接显示「没有能源产品」会把「没授权」说成「你家没有」,那是两回事');
  // 2026-08-01:中间多了 health(胎压/待装更新/门锁,给车况格用)。
  // 判据要压的是「车辆数据照旧返回」,不是这三个字段挨在一起。
  assert.match(route, /drives: snapshot\.drives/, '车辆 drives 照旧返回');
  assert.match(route, /charges: snapshot\.charges/, '车辆 charges 照旧返回');
  assert.match(route, /energy,/, 'energy 与车辆一起返回');
  assert.match(route, /locationHint/, '位置原因 hint 给前端');

  const panel = read('components/portal/TeslaPanel.tsx');
  assert.match(panel, /energy\.unavailable === 'scope'/, '前端要把「没授权」这一态说出来');
  assert.match(panel, /Energy Product Information/, '并且告诉用户去哪把它勾上');
}

/* ══ ③ 图 2:位置真的画出来了,且不为它再引一套地图 ═══════════════ */
{
  const charts = read('components/portal/TeslaCharts.tsx');
  assert.match(charts, /import PlaceMap/,
    '复用足迹那张 PlaceMap(OSM 瓦片,零依赖)—— 站内已经有一张地图了,不该有第二套');
  assert.match(charts, /export function TeslaLocationMap/, '图 2 本体');
  assert.match(charts, /if \(!points\.length\) return null;/,
    '没坐标就什么都不画 —— 画一张空地图比不画更让人困惑');
  assert.match(charts, /不是连续轨迹/,
    '只读快照 = 同步时的采样点。不说清楚会被当成实时追踪,那是个隐私误解');

  const panel = read('components/portal/TeslaPanel.tsx');
  assert.match(panel, /\n      <TeslaLocationMap dict=\{dict\} vehicles=\{/,
    '车页要**无条件**渲染它(没坐标时组件自己返回 null)—— ' +
    '包一层 {false && …} 之类的等于写了没接上,那是这个仓库的老毛病');
  assert.match(panel, /locationHint === 'scope'|Vehicle Location/,
    '没坐标时不能一律说没授权 —— 要按 scope/asleep 区分');
}

/* ══ ④ 图 4:曲线有真数据,稀疏就说稀疏 ═══════════════════════════ */
{
  const charts = read('components/portal/TeslaCharts.tsx');
  assert.match(charts, /export function EnergyDaysChart/, '能源按天曲线');
  assert.match(charts, /if \(rows\.length < 2\) return null;/,
    '一个点连不成线。硬画一条平线会让人以为「一直没变」');
  assert.match(charts, /export function BatteryTimeline/, '车的电量时间线');
  assert.match(charts, /按你查看过的时刻画的/,
    '车的接口只回「此刻」,这条线只有你打开过这一页的时刻 —— ' +
    '不说的话它看起来就像全天候记录');
  assert.match(charts, /\{pts\.map\(\(p\) => \(\s*\n\s*<circle/,
    '每一个采样点都要画出来:点就是真实采样时刻。' +
    '光有一条平滑折线是在假装连续采样');

  const panel = read('components/portal/TeslaPanel.tsx');
  assert.match(panel, /\n      <BatteryTimeline log=\{log\} dict=\{dict\} \/>/, '车页要真的渲染它');
  assert.match(panel, /\n      <EnergyDaysChart days=\{energy\.days \|\| \[\]\} dict=\{dict\} \/>/, '同上');

  // 采样判据
  const src = read('lib/portal/tesla-history.ts');
  const js = ts.transpileModule(src.replace("'use client';", ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (String(id).includes('idb-blob-store')) {
        return {
          createBlobStore: () => ({
            load: () => [],
            save: () => {},
          }),
        };
      }
      return { logDropped() {} };
    },
    Date,
    Math,
    Number,
    Array,
    Object,
    String,
    JSON,
    isNaN,
    Boolean,
  });
  const { shouldRecord, prune, MIN_GAP_MS, KEEP_DAYS } = mod.exports;

  const NOW = Date.parse('2026-07-30T12:00:00Z');
  const ago = (ms) => new Date(NOW - ms).toISOString();

  assert.equal(shouldRecord([], { vehicleId: 'v1', batteryPct: 59 }, NOW), true, '第一条当然记');
  assert.equal(
    shouldRecord([{ at: ago(60_000), vehicleId: 'v1', batteryPct: 59 }], { vehicleId: 'v1', batteryPct: 59 }, NOW),
    false,
    '一分钟前刚记过 —— 来回切页面会把曲线堆成一堵墙',
  );
  assert.equal(
    shouldRecord([{ at: ago(MIN_GAP_MS + 1000), vehicleId: 'v1', batteryPct: 59 }], { vehicleId: 'v1', batteryPct: 60 }, NOW),
    true,
    '隔够了就记',
  );
  assert.equal(
    shouldRecord([{ at: ago(60_000), vehicleId: 'v1', batteryPct: 59 }], { vehicleId: 'v2', batteryPct: 80 }, NOW),
    true,
    '节流按车算 —— 两辆车互不影响',
  );
  assert.equal(shouldRecord([], { vehicleId: 'v1', batteryPct: null }, NOW), false,
    '没有电量就没什么可画的。正向判据:有电量才记,不是「没被拦住就记」');
  assert.equal(shouldRecord([], { vehicleId: '', batteryPct: 50 }, NOW), false, '没有车 id 认不出是谁的点');

  const old = prune([
    { at: ago((KEEP_DAYS + 5) * 86_400_000), vehicleId: 'v1', batteryPct: 10 },
    { at: ago(86_400_000), vehicleId: 'v1', batteryPct: 90 },
    { at: 'not-a-date', vehicleId: 'v1', batteryPct: 50 },
  ], NOW);
  assert.equal(old.length, 1, `超过 ${KEEP_DAYS} 天的和读不出日期的都掐掉`);
  assert.equal(old[0].batteryPct, 90);
}

/* ══ ⑤ 存储键登记(电量日志现为 durable,换端可见稀疏采样)═══════ */
{
  const reg = read('scripts/storage-key-registry.test.mjs');
  assert.match(reg, /\["nesio-tesla-battery-log-v1", "durable"\]/,
    '2026-08-10:用户要求未上云数据全部上云 —— 电量日志改为 durable+IDB+module-sync');
  assert.doesNotMatch(read('lib/portal/storage-manifest.ts'), /'nesio-tesla-battery-log-v1'/,
    'durable 键不得再躺在 CACHE_KEYS 里');

  assert.match(read('lib/portal/tesla-history.ts'), /logDropped\('tesla\.battery_log'/,
    '存储写失败不许静默吞掉(CLAUDE.md 红线)');
}

console.log('tesla-energy-location: OK(scope 有能源 / 能源与车辆分开失败 / 位置画在地图上 / 曲线真数据且稀疏照实说 / 键已登记)');
