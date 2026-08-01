/**
 * graph-sync-safety — 记忆图同步的**数据正确性**契约(真跑,不是断言源码长相)。
 *
 * 起因(2026-07-30 财务账本地基体检):`syncMemoryWithCloud` 的顺序是
 *   ① mergeCloudMemorySnapshot(拉云合并) → ② retryLifeGraphCloudSync(重发挂起的 delete)
 * 离线删掉一条 → 这条还在云上 → ① 把它合回本地(复活)→ ② 才去删云端。
 * 净结果:云端对了,本地那条永远留着,而且 outbox 记录已被标 synced,再也不会删第二次。
 * 用户看到的是「删了又回来,再删一次才真没了」——账本容不下这种事。
 *
 * 修法:merge 前先读 outbox,凡是还挂着 delete:<id> 的一律不合。
 * 这条契约把三件事钉死:
 *   ① 挂起 delete 的节点不许被云快照带回来;
 *   ② 没挂 delete 的节点照常合(别把同步整个挡死);
 *   ③ 报数诚实(被挡下的不算「已导入」)。
 *
 * 用 vm + 假 window/localStorage 真跑 life-graph 的这段逻辑。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

/** 真编译一个纯函数模块(无 window 依赖),供 vm 里的 require 返回。 */
function loadDep(rel) {
  const js = ts.transpileModule(fs.readFileSync(ROOT + rel, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { module: m, exports: m.exports, Date, Object, Array, Map, Set, String, Number, Math, JSON, require: () => ({}) });
  return m.exports;
}

function loadGraph() {
  const src = fs.readFileSync(`${ROOT}lib/portal/life-graph.ts`, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const store = new Map();
  const events = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const win = {
    localStorage,
    fetch: async () => ({ ok: false, status: 0 }), // 云请求一律失败 → 停在 outbox(正是要测的态)
    dispatchEvent: (e) => { events.push(e); return true; },
    addEventListener: () => {}, removeEventListener: () => {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, Math, Date,
    String, RegExp, Boolean, Promise, Error, isNaN, parseInt, parseFloat, Symbol, URL,
    window: win, localStorage, CustomEvent: win.CustomEvent, fetch: win.fetch,
    globalThis: win, setTimeout, clearTimeout,
    // life-node-merge 必须用**真的**(④ 钉的就是它的 LWW 行为);其余是检索/落盘辅助,
    // 与合并判定无关,给足够的空实现即可。vm 里 require 返回 {} 会让
    // `mergeConflictingNodes is not a function`,那是harness 假失败,不是产品 bug。
    // context-extractor 同理要用真的:inferLifeNodeSignalSensitivity(2026-08-01 Domains
    // 三合一新增)在 addLifeNode 路径上调用 classifyDomainFromText,空桩会让本测试假失败。
    require: (id) => {
      if (id.endsWith('life-node-merge')) return loadDep('lib/portal/life-node-merge.ts');
      if (id.endsWith('context-extractor')) return loadDep('lib/life-domain/context-extractor.ts');
      return {
        emailFulltextScore: () => 0,
        tokenizeCJK: (s2) => String(s2).split(/\s+/).filter(Boolean),
        expandQueryTerms: (t) => [t],
        reportStorageDropped: () => {},
        logDropped: () => {},
        checkStorageWarning: () => {},
      };
    },
  });
  return { graph: mod.exports, store, events };
}

const node = (id, name, updatedAt = '2026-07-30T00:00:00.000Z') => ({
  id, name, type: 'note', source: 'manual', confidence: 1,
  attributes: { updatedAt }, relations: [], tags: [], createdAt: '2026-07-01T00:00:00.000Z',
});

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name, '']); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── ① 挂起 delete 的节点,云快照不许把它带回来 ────────────────────────────
check('① 离线删除后拉云:被删的那条不复活', () => {
  const { graph } = loadGraph();
  const keep = graph.addLifeNode(node('n-keep', '留着的'));
  const gone = graph.addLifeNode(node('n-gone', '删掉的'));
  assert.strictEqual(graph.getLifeGraph().length, 2);

  // 删掉一条。fetch 恒失败 → delete 停在 outbox(= 离线删除)
  assert.strictEqual(graph.deleteLifeNode(gone.id), true);
  assert.strictEqual(graph.getLifeGraph().length, 1, '本地应只剩 1 条');

  // 云端快照还是删除**之前**的视图(两条都在)
  const merged = graph.mergeCloudMemorySnapshot({
    nodes: [node(keep.id, '留着的'), node(gone.id, '删掉的')],
    assets: [],
  });

  const ids = graph.getLifeGraph().map((n) => n.id);
  assert.ok(!ids.includes(gone.id), '已删的节点被云快照复活了 —— 这正是要修的丢数据路径');
  assert.ok(ids.includes(keep.id), '没删的节点不该被误伤');
  /*
   * 报数要诚实。2026-08-01 计数语义分成了三个(用户:「点了同步,总显示 1000,
   * 不知道数字,数据是否准确」——原来那一个数报的是云端总条数,
   * 而界面上写的是「这台设备还没有的」)。这里两个数一起钉,比原来只钉一个更严:
   *   · cloudNodeCount:云端给了 2 条,被删除意图挡下 1 条 → 1。**挡下的不算**,
   *     这条保护和改之前是同一件事;
   *   · importedNodeCount:keep 本地本来就有 → 0 条是「新取回的」。
   */
  assert.strictEqual(merged.cloudNodeCount, 1, '报数要诚实:被删除意图挡下的那条不计入');
  assert.strictEqual(merged.importedNodeCount, 0, 'keep 本地已有,不算「取回了这台设备还没有的」');
});

// ── ② 没有挂起 delete 时,同步照常工作(别把同步整个挡死)────────────────
check('② 正常同步:云端新节点照样合进来', () => {
  const { graph } = loadGraph();
  // ⚠️ addLifeNode 自己生成 id(node-<ts>-<rand>),入参里的 id 被忽略 ——
  // 断言一律用**返回值的 id**,别拿传进去的那个(第一版就是这么假失败的)。
  const local = graph.addLifeNode(node('n-local', '本地的'));
  const merged = graph.mergeCloudMemorySnapshot({
    nodes: [node('n-cloud', '云端来的')],
    assets: [],
  });
  const ids = graph.getLifeGraph().map((n) => n.id);
  assert.ok(ids.includes('n-cloud'), '云端新节点没合进来 —— 挡过头了');
  assert.ok(ids.includes(local.id), '本地节点丢了');
  assert.strictEqual(merged.importedNodeCount, 1);
});

// ── ③ 删除意图只挡自己那条,同批其他节点正常合 ────────────────────────────
check('③ 一批里既有已删的也有新的:各走各的', () => {
  const { graph } = loadGraph();
  const gone = graph.addLifeNode(node('n-gone', '删掉的'));
  graph.deleteLifeNode(gone.id);
  const merged = graph.mergeCloudMemorySnapshot({
    nodes: [node(gone.id, '删掉的'), node('n-new1', '新1'), node('n-new2', '新2')],
    assets: [],
  });
  const ids = graph.getLifeGraph().map((n) => n.id);
  assert.ok(!ids.includes(gone.id), '已删的又回来了');
  assert.ok(ids.includes('n-new1') && ids.includes('n-new2'), '同批新节点被连坐挡掉了');
  assert.strictEqual(merged.importedNodeCount, 2, '3 条里挡 1 条,应报 2');
});

// ── ④ LWW 仍然生效(别为了修删除把冲突合并改坏)──────────────────────────
check('④ 冲突合并仍按 updatedAt 取新者', () => {
  const { graph } = loadGraph();
  const local = graph.addLifeNode(node('ignored', '本地新版', '2026-07-30T10:00:00.000Z'));
  graph.mergeCloudMemorySnapshot({
    nodes: [node(local.id, '云端旧版', '2026-07-29T00:00:00.000Z')], // 同 id、更旧
    assets: [],
  });
  const x = graph.getLifeGraph().find((n) => n.id === local.id);
  assert.strictEqual(x.name, '本地新版', '陈旧云快照又盖掉了本地更新的编辑(批次198 的老病)');
});

// ── ④b 反向:云端更新时应当赢(别把 LWW 改成「本地永远赢」)────────────────
check('④b 云端更新时云端赢', () => {
  const { graph } = loadGraph();
  const local = graph.addLifeNode(node('ignored', '本地旧版', '2026-07-29T00:00:00.000Z'));
  graph.mergeCloudMemorySnapshot({
    nodes: [node(local.id, '云端新版', '2026-07-30T10:00:00.000Z')],
    assets: [],
  });
  const x = graph.getLifeGraph().find((n) => n.id === local.id);
  assert.strictEqual(x.name, '云端新版', 'LWW 被改成「本地永远赢」了 —— 那样跨端编辑会丢');
});

// ── ⑤ 源码层:合并顺序的前提别被改回去 ────────────────────────────────────
check('⑤ 拉云仍在重试之前(顺序变了本契约的前提就没了)', () => {
  const sync = fs.readFileSync(`${ROOT}lib/portal/cloud-memory-sync.ts`, 'utf8');
  const iMerge = sync.indexOf('mergeCloudMemorySnapshot(');
  const iRetry = sync.indexOf('retryLifeGraphCloudSync()');
  assert.ok(iMerge > 0 && iRetry > iMerge,
    '顺序变成「先重试再合并」了 —— 那样也能解决问题,但要把本契约的说明一起改,别留下过期的解释');
});

// ── ⑥ 「删除意图优先」只该管**自动同步**,不该挡用户主动发起的恢复 ──────────
// mergeCloudMemorySnapshot 现在会挡下挂起 delete 的节点。这对自动拉云是对的
//(用户刚删的不该被旧快照带回来),但如果哪天把**手动「从云恢复」**也接到这个函数上,
// 就会变成「点了恢复却恢复不回来」——而且没有任何提示。
// 手动恢复现在走 cloud-backup.restoreCombinedBackup,与本函数无关;钉住这条边界。
check('⑥ 手动「从云恢复」不走 mergeCloudMemorySnapshot(否则删除意图会挡住用户的恢复)', () => {
  const backup = fs.readFileSync(`${ROOT}lib/portal/cloud-backup.ts`, 'utf8');
  assert.ok(!/mergeCloudMemorySnapshot/.test(backup),
    '手动恢复接到了自动同步的合并函数上 —— 那会让「刚删过、还没同步」的节点恢复不回来。'
    + '真要合并请单独走一条明确表达「用户要求恢复」意图的路径(可传 opts 跳过删除意图门)');
  // 现存的两个调用方都必须是自动同步语境
  for (const f of ['lib/portal/cloud-memory-sync.ts', 'components/portal/MemoryTab.tsx']) {
    const src = fs.readFileSync(ROOT + f, 'utf8');
    if (!/mergeCloudMemorySnapshot/.test(src)) continue;
    assert.ok(/fetchCloudMemorySnapshot/.test(src),
      `${f} 里的 mergeCloudMemorySnapshot 不是接在自动快照拉取上 —— 语境变了要重新审这条门`);
  }
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`graph-sync-safety 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`graph-sync-safety: OK(${results.length} 条,删除意图优先于云快照)`);
