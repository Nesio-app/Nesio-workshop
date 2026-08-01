/**
 * 行为契约:同一件事,屏幕上只能有一个数(2026-07-30 真机,bug #14 / #15 / #40)。
 *
 *   #14 记忆总数三个:记忆库首页 2534、同步体检 2541、点一次同步后 2544。
 *       · 2534 vs 2541 —— 体检读的是**全部节点**(天气快照那类环境信号也要上云),
 *         记忆库报的是**用户会当成记忆的那些**。两个数各有各的对,
 *         错的是它们共用一个「条」字。
 *       · 2541 → 2544 —— 那 3 条是别的设备存下、这台机器还没有的记忆,同步取回来了,
 *         完全正确。handleForceSync 早就把这句话算好了(importedNodeCount),
 *         可**那颗按钮和那行字从来没被渲染过**。同一个数字,说清来路就是功能,不说就是 bug。
 *
 *   #15 收纳 22 件 vs 点进去 18 件。上一轮统一了「哪些东西算收纳」,
 *       剩下的分歧在**「件」这个字指什么**:球读 Σ 数量(一盒 5 支笔算 5),
 *       清单是行数。定死:门面上的数 = 你点进去会看到的行数。
 *
 *   #40 「功能走通率 29」被四个正常维度抬着,总评仍写「72 · 良好」。
 *       这块面板是拿来发现问题的,不能把最该被发现的那一项抹平。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

/* ══ #40 总评不许被平均数盖住最弱那一维 ═══════════════════════════ */
{
  const { smartnessVerdict, BAND_LABEL } = loadTs('lib/portal/smartness-verdict.ts');

  // 截图里那一组
  const dims = [
    { dim: '推荐有用率', score: 75 },
    { dim: 'AI 可用性', score: 100 },
    { dim: '响应速度', score: 82 },
    { dim: '功能走通率', score: 29 },
    { dim: '反馈参与度', score: 74 },
  ];
  const v = smartnessVerdict(72, dims);
  assert.notEqual(v.band, 'good',
    '总分 72 落在「良好」带里,但「功能走通率」只有 29 —— ' +
    '这块面板是拿来发现问题的,评语不能把最该被发现的那一项抹平');
  assert.equal(v.band, 'needs-work', '低于 35 直接「待打磨」');
  assert.equal(v.weakest.dim, '功能走通率', '要点名是哪一条腿塌了,不然用户只知道「不好」不知道哪不好');
  assert.equal(v.cappedByWeakest, true);

  // 40 分:压到「一般」而不是「待打磨」
  const mid = smartnessVerdict(72, [...dims.slice(0, 3), { dim: '功能走通率', score: 44 }, dims[4]]);
  assert.equal(mid.band, 'fair');

  // 样本不足的维度不许压评语 —— 它不是「差」,是「还不知道」
  const thin = smartnessVerdict(72, [...dims.slice(0, 3), { dim: '功能走通率', score: 29, thin: true }, dims[4]]);
  assert.equal(thin.band, 'good',
    'thin 是「按 50 中性填的」,拿它压评语等于拿没有的数据下结论');
  assert.equal(thin.cappedByWeakest, false);

  // 全部都好 → 评语照旧
  const good = smartnessVerdict(88, dims.map((d) => ({ ...d, score: 85 })));
  assert.equal(good.band, 'good');
  assert.equal(good.cappedByWeakest, false);

  // 一个维度都没测出来 → 只能看总分,不硬造结论
  assert.equal(smartnessVerdict(72, [{ dim: 'x', score: 10, thin: true }]).band, 'good');
  assert.equal(smartnessVerdict(72, []).band, 'good');

  assert.equal(BAND_LABEL['needs-work'][0], '待打磨');

  // 两张脸都要用它
  for (const f of ['components/portal/insights/AdminOpsPanel.tsx', 'app/admin/page.tsx']) {
    const s = read(f);
    assert.match(s, /smartnessVerdict\(/, `${f} 要用同一份判据`);
    assert.match(s, /cappedByWeakest/, `${f} 要在评语被压下来时点名那一维`);
  }
  assert.doesNotMatch(read('components/portal/insights/AdminOpsPanel.tsx'), /s >= 70\s*\n?\s*\?\s*\['良好'/,
    '旧的「只看总分」分档要拆掉 —— 留着就还是 #40');
}

/* ══ #15 门面上的数 = 点进去会看到的行数 ══════════════════════════ */
{
  const src = read('lib/portal/inventory-visibility.ts');
  const js = ts.transpileModule(src.slice(src.indexOf('export interface StorageHeadline')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Number, Array, Object, String });
  const { storageHeadline } = mod.exports;

  // 截图里那一组:18 行、其中一盒装了好几支 → Σ 数量 22
  const items = [
    ...Array.from({ length: 17 }, (_, i) => ({ id: `i${i}`, quantity: 1 })),
    { id: 'pens', quantity: 5 },
  ];
  const h = storageHeadline(items);
  assert.equal(h.rows, 18, '点进去会数出 18 行 —— 门面上就得报这个');
  assert.equal(h.pieces, 22, 'Σ 数量还是 22,它没错,只是不该抢主位');
  assert.equal(storageHeadline([{ id: 'a', quantity: null }]).pieces, 1, '不计数的算 1 个');
  assert.equal(storageHeadline([{ id: 'a', quantity: 0 }]).pieces, 1, '0 也算 1 个 —— 它还在架子上');

  const mem = read('components/portal/MemoryTab.tsx');
  assert.match(mem, /\$\{invStats\.rows\} 件/,
    '记忆页那个「收纳」球原来报的是 Σ 数量(inventStats.count)—— 点进去只有 18 行,' +
    '用户自然觉得「东西变少了」');
  assert.doesNotMatch(mem, /\$\{invStats\.count\} 件/, '旧写法要拆掉');

  const sheet = read('components/portal/InventorySheet.tsx');
  assert.match(sheet, /headline\.pieces !== headline\.rows/,
    '两者不同时才补一句「共 N 个」—— 一样的时候多说一遍就是噪音');
}

/* ══ #14 记忆数:两个口径分别说清,且「多出来的 3 条」有来路 ═══════ */
{
  const gc = read('lib/portal/graph-consistency.ts');
  assert.match(gc, /localMemoryCount/,
    '体检必须比对全部节点(天气快照也要上云),但报数给人看时不能跟记忆库那个数打架 —— ' +
    '两个数都带出来,由 UI 分别说清楚');
  assert.match(gc, /visibleMemoryNodes\(local, true\)\.length/,
    '「记忆」这个口径只有一份(memory-visibility),不许在这里另写一套');

  const st = read('components/portal/SettingsSheets.tsx');
  assert.match(st, /记忆 \$\{auditReport\.localMemoryCount\} 条/,
    '体检卡先报记忆数 —— 和记忆库首页对得上');
  assert.match(st, /\{auditReport\.localCount > auditReport\.localMemoryCount && \(/,
    '差额要真的渲染出来(条件挂在两个数不同上),不能让用户自己猜 2541 和 2534 差的那 7 条去哪了');
  assert.match(st, /条环境信号(.|\n)*也在同步/, '那句话本身也得在');
  assert.doesNotMatch(st, /本机 \$\{auditReport\.localCount\} 条,云端/,
    '旧写法(拿全量节点数当「本机 N 条」)要拆掉');

  // 「立即同步」那颗按钮必须真的渲染 —— 它算好的解释从来没露过面
  assert.match(st, /onClick=\{handleForceSync\}/,
    'handleForceSync 把「从云端取回 N 条这台设备还没有的记忆」都算好了,' +
    '可这颗按钮和这行字从来没被渲染过 —— 又一处「写了没接上」。' +
    '同一个数字,说清来路就是功能,不说就是 bug');
  assert.match(st, /\{diagSyncMsg && \(/, '那行解释也要渲染出来');
  // 2026-08-01:那句话搬到 lib/portal/sync-result-copy —— 而且它原来配错了数
  // (importedNodeCount 数的是云端总条数,句子说的却是「这台设备还没有的」,
  //  用户看到「总显示 1000」)。行为压在 scripts/sync-count-honest,那边真跑。
  // 这里钉住:调用点走了那个函数,且「取回」旁边的数是 importedNodeCount 而不是总数。
  assert.match(st, /describeSyncResult\(\{[\s\S]{0,120}fresh: mem\.importedNodeCount/,
    '「取回 N 条这台设备还没有的」旁边的数必须是 importedNodeCount —— 配上总数就是那条 bug');
  const copy = fs.readFileSync(new URL('../lib/portal/sync-result-copy.ts', import.meta.url), 'utf8');
  assert.match(copy, /取回 \$\{fresh\} 条这台设备还没有的记忆/, '解释文案本身还在');
}

console.log('numbers-agree: OK(总评看最弱一维 / 门面报行数 / 记忆数两个口径说清 / 同步有来路)');
