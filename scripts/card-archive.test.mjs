/**
 * 行为契约:卡片档案 —— AI 判决层的唯一监测面(设计定稿 2026-07-29,Step 1)。
 *
 * 没有档案就不该开 AI:误报看「说了的」改判率,漏报看「没说的」+「该提醒我」。
 * 钉死:同卡去重累计 / 90 天+条数上限 / 改判可覆盖 / 统计喂口味 / 警示阈值 /
 * 双轨接线(规则卡入档、影子卡入档、面板挂在洞察·回望)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, extra = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: (p) => (String(p).includes('storage-health') ? { reportStorageDropped: () => { dropped += 1; } } : {}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, ...extra,
  });
  return mod.exports;
}

let dropped = 0;
const store = new Map();
const A = loadTs('../lib/portal/card-archive.ts', {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
});

const T0 = new Date('2026-07-29T10:00:00Z');
const plus = (days) => new Date(T0.getTime() + days * 86_400_000);
const mkShown = (id, over = {}) => ({
  id, lane: 'shadow', group: '财务', title: `卡${id}`, body: 'b', whyNow: 'w',
  evidence: ['plaid:due=2026-07-31'], severity: 2, gates: [], ...over,
});

// ── 同卡去重累计 ──
A.archiveShownCard(mkShown('fp1'), T0);
A.archiveShownCard(mkShown('fp1'), plus(1));
let arc = A.readArchive();
assert.equal(arc.shown.length, 1, '同 id 再出不重复建条');
assert.equal(arc.shown[0].times, 2, 'times 累计');
assert.equal(arc.shown[0].firstAt, T0.toISOString(), 'firstAt 不动');

// ── 改判:可写、可覆盖;影子期没有实弹手势,档案是唯一表态入口 ──
A.recordArchiveVerdict('fp1', 'wrong', plus(1));
assert.equal(A.readArchive().shown[0].verdict.v, 'wrong');
A.recordArchiveVerdict('fp1', 'useful', plus(2));
assert.equal(A.readArchive().shown[0].verdict.v, 'useful', '点错了可以改');

// ── 没说的:幂等 + 该提醒我 ──
A.archiveDeclined([
  { id: 'd1', lane: 'shadow', title: '家长会邮件', reason: '像广告' },
  { id: 'd1', lane: 'shadow', title: '家长会邮件', reason: '像广告' },
], T0);
assert.equal(A.readArchive().declined.length, 1, '同 id 幂等');
A.markDeclinedWanted('d1', T0);
assert.equal(A.readArchive().declined[0].wanted, true, '漏报可以被标出来');

// ── 统计:喂判决 prompt 的口味事实 + 警示 ──
for (let i = 2; i <= 6; i += 1) {
  A.archiveShownCard(mkShown(`fp${i}`, { group: i % 2 ? '财务' : '日程' }), T0);
  A.recordArchiveVerdict(`fp${i}`, i <= 4 ? 'useful' : 'wrong', T0);
}
let stats = A.archiveStats();
assert.equal(stats.verdictCount, 6);
assert.deepEqual(stats.groupCounts['财务'][0] + stats.groupCounts['日程'][0], 4, '有用按组计数');
assert.ok(stats.badRatio > 0.15 && stats.alarm, '改判率 >15% 且样本 ≥5 → 警示亮(AI 变差的唯一报警器)');
assert.equal(stats.wantedCount, 1);

// ── 90 天上限:老条目被裁 ──
store.clear();
A.archiveShownCard(mkShown('old'), T0);
A.archiveShownCard(mkShown('new'), plus(95)); // 95 天后再写入,触发裁剪
arc = A.readArchive();
assert.equal(arc.shown.length, 1, '90 天前的条目裁掉');
assert.equal(arc.shown[0].id, 'new');

// ── 条数上限 ──
store.clear();
const cap = A.ARCHIVE_MAX_DECLINED;
A.archiveDeclined(Array.from({ length: cap + 30 }, (_, i) => ({ id: `d${i}`, lane: 'shadow', title: 't', reason: 'r' })), T0);
assert.equal(A.readArchive().declined.length, cap, `declined 封顶 ${cap}`);

// ── 写失败不许静默吞(红线) ──
const src = fs.readFileSync(new URL('../lib/portal/card-archive.ts', import.meta.url), 'utf8');
assert.match(src, /reportStorageDropped\(\)/, '存储写失败必须走 storage-health 可见事件');

// ── 接线 ──
const feed = fs.readFileSync(new URL('../components/portal/TodayFeed.tsx', import.meta.url), 'utf8');
assert.match(feed, /archiveShownCard\(\{\s*\n?\s*id: `rules:\$\{card\.factKey/, '真实上屏的规则卡要双轨入档(id=AI 改写前的 factKey)');
assert.match(feed, /lane: 'rules'/, '规则卡走 rules lane');

const sheet = fs.readFileSync(new URL('../components/portal/InsightsSheet.tsx', import.meta.url), 'utf8');
assert.match(sheet, /<CardArchivePanel onOpenNode=\{setDetailNodeId\}/, '档案面板挂在洞察·回望,节点跳转接 MemoryNodeDetail');

const panel = fs.readFileSync(new URL('../components/portal/insights/CardArchivePanel.tsx', import.meta.url), 'utf8');
assert.match(panel, /recordCardVerdict\(\{ cardId: entry\.id/, '影子卡的改判要桥进静音层 —— 实弹切换那天直接生效');
assert.match(panel, /resolveCardTarget\(/, '跳转必须走 resolver(目标不让 AI 决定);解析不出就不渲染按钮');

const target = fs.readFileSync(new URL('../lib/portal/card-target.ts', import.meta.url), 'utf8');
assert.ok(!/target\s*[:=][^\n]*card\.(action|payload)/.test(target), 'resolver 不读 AI 输出的任何 target 字段');

console.log('card-archive: OK(去重累计 / 改判可覆盖 / 双清单 / 口味统计+警示 / 上限 / 写失败可见 / 双轨接线)');
