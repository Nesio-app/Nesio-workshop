/**
 * buildPlaceTimeline:有 Google import 的那天,不应再整段丢掉 live。
 * - 手动标记(manual)永不丢
 * - 最近 6h 的 live 仍保留
 * - 更早的粗粒度 live ping 仍让位给 import
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

function loadModule(rel, requireImpl = () => ({})) {
  const store = Object.create(null);
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const mod = { exports: {} };
  vm.runInNewContext(compile(rel), {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Set, Map, Intl,
    window: { localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
    localStorage,
    document: undefined,
    CustomEvent: class { constructor(t) { this.type = t; } },
    require: requireImpl,
  });
  return mod.exports;
}

const placeTime = await import('../lib/portal/place-time.mjs');
const geo = loadModule('../lib/portal/geo.ts');
const countryNorm = loadModule('../lib/portal/country-normalize.ts');
const storageHealth = { reportStorageDropped() {} };
const idbStores = Object.create(null);
const idb = {
  createBlobStore: (opts) => ({
    load: () => {
      if (opts.key === 'nesio-place-trail-v1') return [];
      return idbStores[opts.key] ?? {};
    },
    save(v) { idbStores[opts.key] = v; },
    ready: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
  }),
};

const trail = loadModule('../lib/portal/place-trail.ts', (p) => {
  if (p.includes('place-time')) return placeTime;
  if (p.includes('/geo') || p.endsWith('geo')) return geo;
  if (p.includes('country-normalize')) return countryNorm;
  if (p.includes('storage-health')) return storageHealth;
  if (p.includes('idb-blob-store')) return idb;
  return {};
});

const day = new Date();
day.setHours(12, 0, 0, 0);
const dayIso = (h, m = 0) => {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const oldLiveIso = (() => {
  const d = new Date(day);
  d.setHours(8, 0, 0, 0);
  // 确保距「现在」超过 6h:若当前就是上午,把旧 ping 挪到昨天
  if (Date.now() - d.getTime() <= 6 * 3_600_000) d.setDate(d.getDate() - 1);
  return d.toISOString();
})();

const visits = [
  { ts: dayIso(14, 56), end: dayIso(17, 12), label: 'Mellow Mushroom', lat: 35.79, lon: -78.78, source: 'import' },
  { ts: dayIso(10, 0), label: 'Cary, NC', lat: 35.79, lon: -78.78, source: 'live' }, // 可能被 6h 规则影响
  { ts: new Date().toISOString(), label: 'Cary, NC', lat: 35.791, lon: -78.781, source: 'live', manual: true },
  { ts: oldLiveIso, label: 'Old City Ping', lat: 35.7, lon: -78.7, source: 'live' },
];

// 旧 live(>6h 且非 manual)在同有 import 的那天应让位;若 oldLive 不在同一天则不影响「今天」段。
const days = trail.buildPlaceTimeline(visits, 30);
const todayKey = placeTime.wallDateKey(dayIso(12, 0));
const today = days.find((d) => d.dateKey === todayKey);
assert.ok(today, '今天应有时间线');

const labels = today.segments.map((s) => s.label);
assert.ok(labels.includes('Mellow Mushroom'), 'import 段应保留');
assert.ok(labels.some((l) => l.includes('Cary')), '手动标记 Cary 应保留(不被 import 吃掉)');
assert.ok(!labels.includes('Old City Ping') || placeTime.wallDateKey(oldLiveIso) !== todayKey,
  '同天且超过 6h 的粗粒度 live 应让位给 import');

// 无 import 的天:live 全留
{
  const onlyLive = trail.buildPlaceTimeline([
    { ts: dayIso(9, 0), label: 'Home', source: 'live' },
    { ts: dayIso(11, 0), label: 'Gym', source: 'live' },
  ], 14);
  assert.equal(onlyLive[0]?.segments.length, 2, '无 import 时 live 不丢');
}

console.log('place-trail timeline filter tests passed');

// 地址元数据走 IDB blob(durable),不再写 localStorage
trail.setPlaceGeo('Test Cafe', { name: 'Test Cafe', city: 'Raleigh', country: 'United States' });
assert.equal(idbStores['nesio-place-geo-v1']?.['Test Cafe']?.city, 'Raleigh', 'place-geo 落 IDB');
assert.ok(trail.loadPlaceGeo()['Test Cafe']?.city === 'Raleigh', 'loadPlaceGeo 读 IDB 缓存');

console.log('place-trail geo IDB tests passed');
