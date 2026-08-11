/**
 * 行为契约:同步之后报的那个数,回答的是它自己声称的那个问题
 * (2026-08-01,用户:「点了同步,总显示 1000,不知道数字,数据是否准确」)。
 *
 * 那个 1000 没错 —— 云端确实给了那么多条。错的是**它在回答另一个问题**:
 * importedNodeCount 数的是云端快照里的全部节点,而设置页那句话写的是
 * 「从云端取回 N 条**这台设备还没有的**记忆」。于是每次点同步都看到同一个大数,
 * 因为它根本不是增量。
 *
 * 这是仓里那条「一件事一个数」的同一类病:数字本身准确,却被摆在一句
 * 说别的事的话旁边 —— 用户唯一能得出的结论就是「数据不准」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ══ ① 真跑 mergeCloudMemorySnapshot:三个数各说各的事 ═════════════════════ */
{
  const js = ts.transpileModule(read('lib/portal/life-graph.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const store = new Map();
  const listeners = [];
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    // ⚠️ stub 不能一律返回 undefined。第一版就是 `get: () => () => undefined`,
    // 于是 mergeConflictingNodes 返回 undefined → `{...undefined}` 把节点的 id 都弄没了,
    // 存回去的是一堆没有 id 的壳,下一次比对全成了「新节点」。
    // 断言当场报「本地已有的不算取回新的」失败 —— 压的是我的 stub,不是生产代码。
    require: (spec) => {
      if (String(spec).includes('life-node-merge')) {
        // 真实语义的最小替身:按 updatedAt 取新的那一份(这里只需要「返回一个完整节点」)
        return { mergeConflictingNodes: (local, incoming) => ({ ...local, ...incoming }) };
      }
      return new Proxy({}, { get: () => () => undefined });
    },
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean, Promise,
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: (e) => { listeners.push(e); },
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    indexedDB: undefined,
  });
  const { mergeCloudMemorySnapshot } = mod.exports;
  assert.equal(typeof mergeCloudMemorySnapshot, 'function', '找不到 mergeCloudMemorySnapshot');

  const node = (id, name) => ({
    id, name, type: 'note', source: 'manual', createdAt: '2026-08-01T00:00:00.000Z',
    tags: [], attributes: {}, relations: [], confidence: 1,
  });

  // 本机先有两条
  const first = mergeCloudMemorySnapshot({ nodes: [node('a', 'A'), node('b', 'B')], assets: [] });
  assert.equal(first.importedNodeCount, 2, '第一次:两条都是新的');
  assert.equal(first.cloudNodeCount, 2);

  // 再同步一次,云端给的还是那两条 —— **一条新的都没有**
  const again = mergeCloudMemorySnapshot({ nodes: [node('a', 'A'), node('b', 'B')], assets: [] });
  assert.equal(again.importedNodeCount, 0,
    `再同步一次时「取回了几条这台设备还没有的」必须是 0(拿到 ${again.importedNodeCount}) —— ` +
    '这正是用户看到的那个 bug:每次点同步都报同一个大数,因为它数的是云端总条数');
  assert.equal(again.cloudNodeCount, 2, '云端一共几条另算,它回答的是别的问题');
  assert.equal(again.updatedNodeCount, 0, '内容一模一样,不算更新过');

  // 云端那份变了 → 算「更新」,不算「新到」
  const changed = mergeCloudMemorySnapshot({
    nodes: [{ ...node('a', 'A 改过了'), attributes: { updatedAt: '2026-08-02T00:00:00.000Z' } }],
    assets: [],
  });
  assert.equal(changed.importedNodeCount, 0, '本地已有的不算「取回新的」');
  assert.equal(changed.updatedNodeCount, 1, '内容不同要算进「更新了几条」');

  // 混合:一条老的 + 一条新的
  const mixed = mergeCloudMemorySnapshot({ nodes: [node('b', 'B'), node('c', 'C')], assets: [] });
  assert.equal(mixed.importedNodeCount, 1, `只有 c 是新的(拿到 ${mixed.importedNodeCount})`);
  assert.equal(mixed.cloudNodeCount, 2, '云端给了两条');
}

/* ══ ② 那句话:三个数分开说,不许再拿总数冒充增量(真跑)═══════════════════ */
{
  const js = ts.transpileModule(read('lib/portal/sync-result-copy.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, String, Number, Array, console });
  const { describeSyncResult } = mod.exports;

  // 用户看到的那一幕:云端 1000 条,但一条新的都没有
  const same = describeSyncResult({ fresh: 0, updated: 0, total: 1000 }, true);
  assert.doesNotMatch(same, /取回 1000/,
    `一条新的都没有时不许说「取回 1000 条」(拿到 ${JSON.stringify(same)}) —— ` +
    '这就是用户看到的那个 bug:句子说的是增量,数却是云端总条数');
  assert.match(same, /本机和云端本来就一致/, '没有新增也要给个结局,不许什么都不说');
  assert.match(same, /云端一共 1000 条/,
    '总数**永远**要说 —— 用户问的「数据是否准确」,要的就是一个能和记忆库对得上的数');

  // 真有新的:三件事分得开
  const fresh = describeSyncResult({ fresh: 3, updated: 5, total: 1000 }, true);
  assert.match(fresh, /取回 3 条这台设备还没有的记忆/, '新到的用 fresh');
  assert.match(fresh, /5 条按云端那份更新了/, '更新的单独说 —— 不然「0 条新的」看着像同步没生效');
  assert.match(fresh, /云端一共 1000 条/);
  assert.match(fresh, /下拉刷新/, '真取回了东西才提示刷新');
  assert.doesNotMatch(same, /下拉刷新/, '什么都没变时不该叫人去刷新');

  // 只有更新、没有新增
  const onlyUpd = describeSyncResult({ fresh: 0, updated: 2, total: 40 }, true);
  assert.doesNotMatch(onlyUpd, /取回/, '没有新增就别说取回');
  assert.match(onlyUpd, /2 条按云端那份更新了/);
  assert.doesNotMatch(onlyUpd, /本机和云端本来就一致/, '有更新就不是「本来就一致」');

  // 英文
  const en = describeSyncResult({ fresh: 1, updated: 0, total: 7 }, false);
  assert.match(en, /pulled 1 memory this device didn't have/, '单数用 memory');
  assert.match(en, /7 in cloud/);
  assert.doesNotMatch(en, /[\u4e00-\u9fa5]/, '英文界面下不许漏中文');
  assert.match(describeSyncResult({ fresh: 2, updated: 0, total: 7 }, false), /pulled 2 memories/, '复数用 memories');

  // 脏输入不许把句子搞坏
  assert.match(describeSyncResult({ fresh: -5, updated: NaN, total: 3.7 }, true), /云端一共 3 条/);

  // 调用点真的用了统一同步(抽出来没人调 = 白抽)
  const s = stripComments(read('components/portal/SettingsSheets.tsx'));
  assert.match(s, /runUnifiedSync\(\{\s*force:\s*true\s*\}\)/,
    '设置「同步」必须走 runUnifiedSync —— 与记忆下拉同一条,不再只推记忆图');
  assert.match(s, /describeUnifiedSync\(r/,
    '同步结果文案必须走 describeUnifiedSync,把记忆新/更新/云端总数说清');
  const uni = read('lib/portal/unified-sync.ts');
  assert.match(uni, /importedNodeCount/, '统一同步文案要用 importedNodeCount');
  assert.match(uni, /cloudNodeCount/, '统一同步文案要带云端总数');
}

/* ══ ③ 注释别再说谎:奖励/愿望其实一直在走通用云同步 ═══════════════════════ */
{
  const eng = read('lib/platform/rewards-engine.ts');
  assert.doesNotMatch(eng, /纯本地\(localStorage `nesio-rewards-v1`\),不调 AI、不上传/,
    'rewards-engine 头上那句「不上传」是过时的:nesio-rewards-v1 是 durable、非 dedicated,' +
    '早就走通用 cloud-module-sync 上云了。一句过时的注释会让下一个人(和用户)以为数据没同步');

  // 反过来钉住那个前提:它确实不是专属引擎负责的 key(改了的话上面那句话就要跟着改)
  const ownership = read('scripts/sync-ownership.test.mjs');
  assert.match(ownership, /'nesio-rewards-v1'\]\)\s*\{[\s\S]{0,200}isDedicatedSyncKey\(k\), false/,
    'sync-ownership 里应当仍钉着 nesio-rewards-v1 走通用同步');
}

console.log('sync-count-honest: OK(取回新的/更新的/云端总数三个数各说各的事 · 奖励数据一直在同步)');
