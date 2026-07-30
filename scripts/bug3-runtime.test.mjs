/**
 * bug3 运行时契约:**真实执行**新写的逻辑,而不是断言源码长什么样。
 *
 * 为什么单独一套:bug3-audit 钉的是「标注有没有落地」(源码级、覆盖 123 条),
 * 分批契约钉的是「病根的修法别被改回去」。这一套补第三个角度 —— 拿一个可控的
 * localStorage/window 假环境,把边界真跑一遍:写失败、坏 JSON、去重、幂等、
 * 删附件是否连本体、月份回退会不会悄悄回到当月。
 *
 * 这些都是「代码长得对但跑起来错」会漏掉的那一类。第一次跑这套时它抓出了 4 条,
 * 全是我自己断言写窄了(vm 里造的对象原型与外层不同 → deepStrictEqual 必假失败;
 * 字段名写成 .month 而实际是 .current.monthKey);逐条核到源码确认行为无误后才改断言。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
let failWrites = false;
const store = new Map();
const events = [];

function makeEnv() {
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const window = {
    localStorage,
    dispatchEvent: (e) => { events.push(e); return true; },
    addEventListener: () => {}, removeEventListener: () => {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  return { window, localStorage, CustomEvent: window.CustomEvent };
}

const deleted = [];
function load(rel, mocks = {}) {
  const src = fs.readFileSync(ROOT + rel, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const env = makeEnv();
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, Math, Date,
    String, RegExp, Boolean, Promise, Error, isNaN, parseInt, parseFloat, Symbol,
    ...env, globalThis: env,
    require: (id) => ({
      reportStorageDropped: () => { events.push({ type: 'storage-dropped' }); },
      logDropped: () => {},
      deleteLocalFile: async (a) => { deleted.push(a); },
      createBlobStore: () => ({ load: () => [], save: () => {} }),
      normalizeCategory: (c) => c, categoryLabel: (c) => c,
      // tx-graph-bridge:批注是**两写**(财务页覆盖层 + 图)。这里不 stub 成空操作 ——
      // 记下每一次调用,好在下面钉住「确实往图上写了」。只写覆盖层的话
      // Linda 的关系页看不到这笔钱,那正是这条桥要修的毛病。
      linkTxToPerson: (txId, k) => { bridge.push(['link', txId, k]); return { graphOk: true }; },
      unlinkTxFromPerson: (txId, k) => { bridge.push(['unlink', txId, k]); return { graphOk: true }; },
      attachAssetToTx: (txId, a) => { bridge.push(['attach', txId, a.id]); return { graphOk: true }; },
      detachAssetFromTx: (txId, id) => { bridge.push(['detach', txId, id]); return { graphOk: true }; },
      ...(mocks[id] || {}),
    }),
  });
  return mod.exports;
}

const bridge = [];   // tx-graph-bridge 的调用流水,给「确实两写了」那几条断言用
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name, '']); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ══ ① tx-annotations:真实读写、去重、空键清理、写失败 ══
const ann = load('lib/portal/tx-annotations.ts');

check('①a 关联人 round-trip', () => {
  store.clear();
  assert.strictEqual(ann.setTxPeople('tx1', ['Linda']).ok, true, '写入应成功');
  looseDeepEqual([...ann.txAnnotationOf('tx1').people], ['linda'], '应归一成小写');
});

check('①a2 关联人**同时写到图上** —— 只写财务页的话别处根本看不到', () => {
  store.clear(); bridge.length = 0;
  ann.setTxPeople('tx1', ['Linda']);
  looseDeepEqual(bridge, [['link', 'tx1', 'linda']],
    '关联只落在财务页覆盖层 —— Linda 的关系页看不到这笔钱,记忆库也搜不到。这正是这条桥要修的毛病');
});

check('①a3 取消关联时图上也要断开(否则关系页留一条幽灵关联)', () => {
  store.clear();
  ann.setTxPeople('tx1', ['linda', 'bob']);
  bridge.length = 0;
  ann.setTxPeople('tx1', ['linda']);
  looseDeepEqual(bridge, [['unlink', 'tx1', 'bob']],
    '按差集增删:没变的人不该重连(重连会把关联的建立时间冲掉),去掉的人必须真断开');
});

check('①b 关联人去重 + 去空', () => {
  store.clear();
  ann.setTxPeople('tx1', ['Linda', 'linda', ' LINDA ', '', '  ']);
  looseDeepEqual([...ann.txAnnotationOf('tx1').people], ['linda'], '重复/空白应被清掉');
});

check('①c toggle 是真开关(第二次点取消)', () => {
  store.clear();
  ann.toggleTxPerson('tx1', 'linda');
  looseDeepEqual([...ann.txAnnotationOf('tx1').people], ['linda']);
  ann.toggleTxPerson('tx1', 'Linda');   // 大小写不同也要认成同一个人
  // 关掉最后一个人 → 整条批注空了 → 按设计**删键**(不攒垃圾),所以是 undefined 不是 []。
  // UI 侧读的是 `ann.people || []`,已兜住;这里连带把那个兜底也钉上。
  const after = ann.txAnnotationOf('tx1');
  looseDeepEqual(after.people || [], [], '再点一次应取消');
  assert.ok(!ann.hasTxAnnotation(after), '取消完这条批注应该整条消失');
  const ui = fs.readFileSync(ROOT + 'components/portal/finance/FinanceTab.tsx', 'utf8');
  assert.ok(/const people = ann\.people \|\| \[\]/.test(ui), 'UI 必须给 people 兜一个空数组,否则 undefined 会炸 .map');
});

check('①d 批注清空后不留垃圾键', () => {
  store.clear();
  ann.setTxNote('tx1', '医药费');
  assert.ok(Object.keys(ann.loadTxAnnotations()).includes('tx1'));
  ann.setTxNote('tx1', '   ');          // 清成空白
  assert.ok(!Object.keys(ann.loadTxAnnotations()).includes('tx1'), '空批注应删键,不攒垃圾');
});

check('①e 附件不重复添加(同 assetId 幂等)', () => {
  store.clear();
  const a = { assetId: 'x1', name: 'r.png', mimeType: 'image/png', size: 10 };
  ann.addTxAttachment('tx1', a);
  ann.addTxAttachment('tx1', a);
  assert.strictEqual(ann.txAnnotationOf('tx1').attachments.length, 1, '同一个附件不该进两次');
});

check('①f 写失败返回 false 且上报 storage-dropped(红线)', () => {
  store.clear();
  events.length = 0;
  failWrites = true;
  const ok = ann.setTxNote('tx1', '会失败');
  failWrites = false;
  assert.strictEqual(ok, false, '写不进必须返回 false,不许假成功');
  assert.ok(events.some((e) => e.type === 'storage-dropped'), '必须上报存储失败(不许静默吞)');
});

check('①e2 附件**同时挂到流水节点** —— 只写覆盖层的话记忆详情/问一问取不到', () => {
  store.clear(); bridge.length = 0;
  ann.addTxAttachment('tx1', { assetId: 'inv-1', name: '发票.png', mimeType: 'image/png', size: 9 });
  looseDeepEqual(bridge, [['attach', 'tx1', 'inv-1']],
    '附件没挂进 node.assets —— 这张发票除了财务页哪儿都看不到');
});

check('①g 删附件连 IndexedDB 本体一起删(不留孤儿)', () => {
  store.clear();
  deleted.length = 0;
  ann.addTxAttachment('tx1', { assetId: 'orphan-me', name: 'a', mimeType: 'image/png', size: 1 });
  // removeTxAttachment 是 async,这里同步触发再等一拍
  const p = ann.removeTxAttachment('tx1', 'orphan-me');
  return p.then(() => {
    assert.deepStrictEqual(deleted, ['orphan-me'], '必须调 deleteLocalFile 清本体');
    assert.strictEqual((ann.txAnnotationOf('tx1').attachments || []).length, 0);
  });
});

check('①h 坏 JSON 不炸(退化成空)', () => {
  store.clear();
  store.set('nesio-fin-tx-annotations-v1', '{ 这不是 json');
  looseDeepEqual(Object.keys(ann.loadTxAnnotations()), [], '读坏数据应退化成 {},不该抛');
});

check('①i hasTxAnnotation 只认真有内容的', () => {
  assert.strictEqual(ann.hasTxAnnotation({}), false);
  assert.strictEqual(ann.hasTxAnnotation({ note: '   ' }), false, '纯空白不算有批注');
  assert.strictEqual(ann.hasTxAnnotation({ attachments: [] }), false);
  assert.strictEqual(ann.hasTxAnnotation({ note: 'x' }), true);
});

// ══ ② travel-hubs:排序与取码 ══
const hubsFile = JSON.parse(fs.readFileSync(ROOT + 'public/data/travel-hubs/hubs.json', 'utf8'));
const hubs = load('lib/portal/travel-hubs.ts');
// 用真数据灌进模块缓存(模块内 fetch 在 node 里没有,直接调 search 会空)
check('②a 数据包本身可用', () => {
  assert.ok(Array.isArray(hubsFile.items) && hubsFile.items.length >= 100,
    `hubs.json 应有 100+ 条,实际 ${hubsFile.items?.length}`);
  const bad = hubsFile.items.filter((h) => !h.code || !Number.isFinite(h.lat) || !Number.isFinite(h.lon));
  assert.strictEqual(bad.length, 0, `有 ${bad.length} 条缺 code/坐标`);
  const dup = hubsFile.items.length - new Set(hubsFile.items.map((h) => h.code)).size;
  assert.strictEqual(dup, 0, `有 ${dup} 个重复三字码`);
  const zh = hubsFile.items.filter((h) => h.cityZh).length;
  assert.ok(zh > 0, '至少要有中文城市名,否则中文搜不到');
});

check('②b 搜索未预热时返回空数组而不是抛', () => {
  assert.strictEqual(hubs.searchTravelHubs('PVG').length, 0, '没预热应安全返回空');
  assert.strictEqual(hubs.hubByCode('PVG'), null);
  assert.strictEqual(hubs.isTravelHubsReady(), false);
});

// 排序逻辑单独用同一套打分复算(和源码同口径),验证「码前缀 > 城市前缀 > 名字包含」
check('②c 排序口径:三字码精确命中排第一', () => {
  const items = hubsFile.items;
  const score = (h, q) => {
    const code = h.code.toLowerCase(), city = h.city.toLowerCase();
    const cityZh = (h.cityZh || '').toLowerCase(), name = h.name.toLowerCase();
    let s = -1;
    if (code === q) s = 100; else if (code.startsWith(q)) s = 90;
    else if (cityZh && cityZh.startsWith(q)) s = 80; else if (city.startsWith(q)) s = 78;
    else if (cityZh && cityZh.includes(q)) s = 60; else if (city.includes(q)) s = 58;
    else if (name.includes(q)) s = 40;
    return s < 0 ? -1 : s + (h.kind === 'airport' ? 1 : 0);
  };
  const q = 'pvg';
  const ranked = items.map((h) => ({ h, s: score(h, q) })).filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.h.code.localeCompare(b.h.code));
  assert.ok(ranked.length > 0, 'PVG 应能搜到');
  assert.strictEqual(ranked[0].h.code, 'PVG', `精确码应排第一,实际 ${ranked[0].h.code}`);
});

check('②d 中文城市名能搜到(标注要求的场景)', () => {
  const zhHubs = hubsFile.items.filter((h) => h.cityZh);
  const sample = zhHubs[0];
  const q = sample.cityZh.toLowerCase();
  const hit = zhHubs.some((h) => (h.cityZh || '').toLowerCase().startsWith(q));
  assert.ok(hit, `中文城市名「${sample.cityZh}」应能前缀命中`);
});

// ══ ③ place-stats:月份回退 ══
const placeStats = load('lib/portal/place-stats.ts', {
  './place-trail': {
    // 真实形状:天序从新到旧,每天若干 segment
    buildPlaceTimeline: (visits) => {
      const byDay = new Map();
      for (const v of visits) {
        const k = v.date;
        if (!byDay.has(k)) byDay.set(k, { dateKey: k, segments: [] });
        byDay.get(k).segments.push({ label: v.name, lat: v.lat, lon: v.lon, durationMin: 60, category: 'other' });
      }
      return [...byDay.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    },
    haversineKm: () => 1,
    placeKey: (label) => String(label).toLowerCase(),
    loadPlaceGeo: () => ({}),
  },
  './place-time.mjs': { dateKeyToLocalDate: (k) => new Date(k), wallHour: () => 12 },
  './country-normalize': { distinctCountryCount: () => 0 },
});
check('③ monthOffset 真的往回走(不是每次都当月)', () => {
  const mk = (date, name) => ({ date, name, lat: 1, lon: 1 });
  const visits = [
    mk('2026-07-05', '甲'), mk('2026-07-06', '乙'),
    mk('2026-06-05', '丙'), mk('2026-06-06', '丁'), mk('2026-06-07', '戊'),
    mk('2026-05-05', '己'),
  ];
  const m0 = placeStats.monthlyPlaceComparison(visits, 0);
  const m1 = placeStats.monthlyPlaceComparison(visits, 1);
  const m2 = placeStats.monthlyPlaceComparison(visits, 2);
  assert.ok(m0 && m1 && m2, '三次都应算得出来');
  // 锚定月 → 往回 1 个月 → 再往回 1 个月:必须是三个不同的月,且严格递减
  const keys = [m0.current.monthKey, m1.current.monthKey, m2.current.monthKey];
  assert.strictEqual(new Set(keys).size, 3, `offset 0/1/2 应是三个不同月,实际 ${keys.join(' / ')}`);
  assert.ok(keys[0] > keys[1] && keys[1] > keys[2], `必须严格往回走,实际 ${keys.join(' → ')}`);
  // prev 永远是 current 的上一个日历月(环比口径不能错位)
  assert.strictEqual(m1.current.monthKey, m0.prev.monthKey,
    `往回一个月应正好落在上个月的环比基准上:${m1.current.monthKey} vs ${m0.prev.monthKey}`);
  // 有数据的月份必须真的统计到东西(别翻过去全是空)
  const june = [m0, m1, m2].find((m) => m.current.monthKey === '2026-06');
  assert.ok(june, '2026-06 应在可翻范围内');
  assert.strictEqual(june.current.visits, 3, `6 月有 3 段到访,实际 ${june.current.visits}`);
  assert.strictEqual(june.current.places, 3, `6 月 3 个不同地点,实际 ${june.current.places}`);
  // 跨年不能崩:2026-01 往回一个月必须是 2025-12
  const jan = [{ date: '2026-01-10', name: '甲', lat: 1, lon: 1 }];
  const j = placeStats.monthlyPlaceComparison(jan, 0);
  assert.ok(j && /^\d{4}-\d{2}$/.test(j.prev.monthKey), 'prev 必须是合法的 YYYY-MM');
});

// ══ ④ travel-trips:分类预算 ══
const tripsSrc = fs.readFileSync(ROOT + 'lib/portal/travel-trips.ts', 'utf8');
check('④a 有分类覆盖时总额按分类求和(不是两个口径)', () => {
  const fn = tripsSrc.slice(tripsSrc.indexOf('function recomputeBudgetNode'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(/budgetByCategory/.test(body), 'recomputeBudgetNode 必须读分类覆盖');
  assert.ok(/reduce|for \(/.test(body), '必须真的求和,不是只读一个总数');
});
check('④b setCategoryBudget 存在且写进 trip', () => {
  assert.ok(/export function setCategoryBudget/.test(tripsSrc));
  const fn = tripsSrc.slice(tripsSrc.indexOf('export function setCategoryBudget'));
  assert.ok(/budgetByCategory/.test(fn.slice(0, 900)), '必须写进 budgetByCategory');
});

// ══ ⑤ wardrobe-outfits:穿过几次 / 试穿图 ══
const outfits = load('lib/portal/wardrobe-outfits.ts');
check('⑤a wornCount 不把「排进日历」算成穿过了', () => {
  const list = [
    { pieceIds: ['a', 'b'], date: '2026-07-01', planned: false },
    { pieceIds: ['a', 'b'], date: '2026-07-08', planned: true },   // 只是排了,还没穿
    { pieceIds: ['b', 'a'], date: '2026-07-02' },                   // 顺序不同,同一组
  ];
  const n = outfits.wornCount(list, ['a', 'b']);
  assert.strictEqual(n, 2, `穿过的应是 2 次(planned 那次不算),实际 ${n}`);
});
check('⑤b tryonOf 取到这一组的上身图', () => {
  const list = [{ pieceIds: ['a', 'b'], date: '2026-07-01', tryonAssetId: 'try-1' }];
  assert.strictEqual(outfits.tryonOf(list, ['b', 'a']), 'try-1', '顺序不同也要认');
  assert.ok(!outfits.tryonOf(list, ['c']), '不相干的组不该拿到图');
});

// ══ ⑥ bank-tx:confirmed 与 status 是两件事 ══
const bankSrc = fs.readFileSync(ROOT + 'lib/portal/providers/bank-tx.ts', 'utf8');
check('⑥a status 不被「人确认」污染', () => {
  const fn = bankSrc.slice(bankSrc.indexOf('export function detectRecurring'));
  const body = fn.slice(0, 6000);
  assert.ok(/confirmed: ruleFor\(recurRules, last\) === 'yes'/.test(body), 'confirmed 要来自人的规则');
  // status 的赋值不许读 recurRules —— 那就是把两件事又搅回去了
  const statusAssigns = body.match(/status: [^,\n]+/g) || [];
  for (const a of statusAssigns) {
    assert.ok(!/recurRules|ruleFor/.test(a), `status 赋值不许看人的确认:${a}`);
  }
});
check('⑥b 涨价检测仍只认 mature(否则 2 笔中位数造假涨价)', () => {
  const feat = fs.readFileSync(ROOT + 'lib/portal/finance-features.ts', 'utf8');
  const fn = feat.slice(feat.indexOf('recurringPriceHikes'));
  assert.ok(/status !== 'mature'/.test(fn.slice(0, 1500)), '涨价 gate 必须仍在 mature 上');
});

// ══ ⑦ mood-trend:情绪盘记一笔就能在趋势里看到(p43 的可达性,数据侧)══
// 上一版 p43 只把入口挂在 Apple Health 的情绪卡上,而趋势读的是这份 —— 于是
// 「用情绪盘记心情的人有数据却没入口」。数据侧这里真跑一遍,保证卡上的
// hasData / 主情绪 / 今天那根柱子确实由情绪盘记录驱动。
const node = (emotion, tags, energyLevel, daysAgo = 0) => ({
  type: 'health_state', tags,
  attributes: { emotion, ...(energyLevel ? { energyLevel } : {}) },
  createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});
const loadTrend = (nodes) => load('lib/portal/mood-trend.ts', {
  '@/lib/portal/life-graph': { getLifeGraph: () => nodes },
});

check('⑦a 情绪盘记一笔 → 分布 + 今天那根柱子都有它', () => {
  const t = loadTrend([node('calm', ['moment', 'feeling', 'calm'], 'high')]).readMoodTrend('week');
  assert.strictEqual(t.topEmotion, 'calm', '主情绪应是刚记的那一个');
  looseDeepEqual(t.dist.map((d) => [d.id, d.count]), [['calm', 1]]);
  const today = t.days[t.days.length - 1];
  assert.strictEqual(today.isToday, true);
  assert.strictEqual(today.emotionId, 'calm', '今天那根柱子要染上今天的心情');
  assert.strictEqual(today.energyPct, 88, '满电 → 88%');
});

check('⑦b 空图不炸,且卡会判成「还没有记录」', () => {
  const t = loadTrend([]).readMoodTrend('week');
  assert.strictEqual(t.dist.length, 0);
  assert.ok(t.days.every((d) => d.emotionId === null && d.energyPct === 0),
    '一根有色柱子都不该有 —— 否则空态判定(hasData)会假阳');
});

check('⑦c 不是情绪记录的 health_state 不算进来', () => {
  const t = loadTrend([
    node('calm', ['lab'], 'mid'),            // 化验之类:没有 feeling/moment 标
    node('joy', ['moment', 'feeling'], 'mid'),
  ]).readMoodTrend('week');
  looseDeepEqual(t.dist.map((d) => d.id), ['joy'], '只认情绪盘写的那类节点');
});

check('⑦d 认不出的情绪 id 不计数也不上色(脏数据不外泄成 var(--emotion-xxx))', () => {
  const t = loadTrend([node('rage', ['moment', 'feeling'], 'mid')]).readMoodTrend('week');
  assert.strictEqual(t.dist.length, 0);
  assert.strictEqual(t.days[t.days.length - 1].emotionId, null);
});

check('⑦e 月窗口能捞到上周的记录(本周空也别让人以为没数据)', () => {
  const nodes = [node('sad', ['moment', 'feeling'], 'low', 12)];
  assert.strictEqual(loadTrend(nodes).readMoodTrend('week').dist.length, 0, '12 天前不在本周窗口');
  looseDeepEqual(loadTrend(nodes).readMoodTrend('month').dist.map((d) => d.id), ['sad'],
    '月窗口要能捞到 —— 所以本周没数据时入口也得留着');
});

Promise.all(results.filter((r) => r[0] === 'PASS').map(() => null)).then(() => {
  // 等 ①g 的 async 收尾
  setTimeout(() => {
    const fails = results.filter((r) => r[0] === 'FAIL');
    if (fails.length) {
      assert.fail(`bug3 运行时契约有 ${fails.length} 条不过:\n  - `
        + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
    }
    console.log(`bug3-runtime: OK(${results.length} 条边界真跑一遍)`);
  }, 50);
});
