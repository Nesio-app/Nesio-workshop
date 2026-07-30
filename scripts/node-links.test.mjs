/**
 * node-links — 双向关联的契约(R1)。真跑 life-graph 的关联函数,注入假存储。
 *
 * 两条病根,各有断言:
 *
 *   ① **半条关联**。原来关联是两次 updateLifeNode:第二次失败(节点刚被删、
 *      存储写不进去)就留下「从 A 看得到 B,从 B 看不到 A」。没有任何界面会报错,
 *      表现只是「有时候能看到、有时候看不到」—— 最难查的一类。
 *      现在一次 loadAll → 两处改 → 一次 saveAll。
 *
 *   ② **targetId 存的是人名**。语音解析那条 owned_by 把「Linda」当成 targetId,
 *      而渲染层要 `g.find(x => x.id === targetId)` —— 这条关系永远渲染不出来,
 *      却一直在图里占位、进备份、上云、参与去重键计算。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');

const SRC = read('lib/portal/life-graph.ts');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * life-graph 太大且到处 import,整份跑不动。做法同 lab-pdf.test.mjs:
 * 只切**关联那一段**,把它依赖的 loadAll/saveAll 等换成可注入的假件。
 * 切片起点用代码标识符,不用注释 —— 注释是会被清掉的。
 */
function loadLinkLayer(store) {
  const from = SRC.indexOf('export const RELATION_INVERSE');
  const to = SRC.indexOf('export function replaceLifeGraphProjection');
  assert.ok(from > 0 && to > from, 'life-graph 的关联段结构变了 —— 这条测试要跟着改');
  const js = ts.transpileModule(SRC.slice(from, to), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports,
    JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp,
    // 假后端:loadAll 返回可控数组,saveAll 记录写了几次、可被要求抛错
    loadAll: () => store.nodes,
    saveAll: (n) => { store.saves += 1; if (store.throwOnSave) throw new Error('quota'); store.nodes = n; },
    nodeFactSink: null,
    syncLifeGraphUpsertToCloud: () => {},
    syncLifeNodeSignalToCloud: () => {},
    require: () => ({}),
  });
  return m.exports;
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

const node = (id, name, relations = []) => ({ id, name, relations, attributes: {}, tags: [], type: 'object' });
const fresh = () => ({ nodes: [node('a', 'A'), node('b', 'B')], saves: 0, throwOnSave: false });

// ── ① 双向 + 原子 ──────────────────────────────────────────────────────────
check('①a 关联一次写两边', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  const r = G.linkNodes('a', 'b', 'user_linked');
  looseDeepEqual(r, { ok: true, created: true });
  looseDeepEqual(s.nodes[0].relations, [{ targetId: 'b', relation: 'user_linked' }]);
  looseDeepEqual(s.nodes[1].relations, [{ targetId: 'a', relation: 'user_linked' }],
    '只写了一边 —— 从对面点进去看不到,而人不知道自己站在哪一头');
});

check('①b **一次 saveAll** —— 两次写的话中间失败会留下半条关联', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  G.linkNodes('a', 'b', 'user_linked');
  assert.strictEqual(s.saves, 1,
    `写了 ${s.saves} 次 —— 两次写之间失败会留下「这边看得到、那边看不到」,没有界面会报错`);
});

check('①c 有反向关系的按表推(confirmed_by_email ↔ confirms_plan)', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  G.linkNodes('a', 'b', 'confirmed_by_email');
  assert.strictEqual(s.nodes[0].relations[0].relation, 'confirmed_by_email');
  assert.strictEqual(s.nodes[1].relations[0].relation, 'confirms_plan',
    '反向关系写成了同名 —— 邮件那头会显示「这封邮件确认了这封邮件」');
  assert.strictEqual(G.inverseRelation('user_linked'), 'user_linked', '没有反面的关系走对称');
});

check('①d 幂等:同一对同一关系重复调用不写第二条', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  G.linkNodes('a', 'b', 'user_linked');
  const r2 = G.linkNodes('a', 'b', 'user_linked');
  looseDeepEqual(r2, { ok: true, created: false });
  assert.strictEqual(s.nodes[0].relations.length, 1, '重复关联堆出了两条一样的边');
  assert.strictEqual(s.saves, 1, '没变化还写了一次盘');
});

check('①e 前置校验:自己关自己 / 节点不存在 / 空关系名,都返回原因而不是静默失败', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  assert.strictEqual(G.linkNodes('a', 'a', 'user_linked').reason, 'self');
  assert.strictEqual(G.linkNodes('a', 'nope', 'user_linked').reason, 'missing_to');
  assert.strictEqual(G.linkNodes('nope', 'b', 'user_linked').reason, 'missing_from');
  assert.strictEqual(G.linkNodes('a', 'b', '  ').reason, 'bad_relation');
  assert.strictEqual(s.saves, 0, '校验没过却动了盘');
});

check('①f targetId 必须是真实节点 id —— 人名一律拒', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  assert.strictEqual(G.linkNodes('a', 'Linda', 'owned_by').ok, false,
    '把人名当 targetId 收了 —— 这条关系永远渲染不出来,却一直在图里占位、进备份、上云');
});

check('①g 解除关联也是两边一起、一次写', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  G.linkNodes('a', 'b', 'confirmed_by_email');
  s.saves = 0;
  assert.strictEqual(G.unlinkNodes('a', 'b', 'confirmed_by_email'), true);
  looseDeepEqual(s.nodes[0].relations, []);
  looseDeepEqual(s.nodes[1].relations, [], '只解了一边 —— 对面还挂着一条指回来的死链');
  assert.strictEqual(s.saves, 1);
});

check('①h 本来就没有的关系,解除返回 false 且不写盘', () => {
  const s = fresh(); const G = loadLinkLayer(s);
  assert.strictEqual(G.unlinkNodes('a', 'b', 'user_linked'), false);
  assert.strictEqual(s.saves, 0);
});

// ── ② 悬空关联:存量数据的修复 ──────────────────────────────────────────────
check('②a 查得出 targetId 指不到节点的关系', () => {
  const s = { nodes: [node('a', 'A', [{ targetId: 'Linda', relation: 'owned_by' }]), node('b', 'B')], saves: 0 };
  const G = loadLinkLayer(s);
  looseDeepEqual(G.danglingRelations(s.nodes), [{ nodeId: 'a', targetId: 'Linda', relation: 'owned_by' }]);
});

check('②b 能按名字找到节点就改成真 id', () => {
  const s = { nodes: [node('a', 'A', [{ targetId: 'Linda', relation: 'owned_by' }]), node('p1', 'Linda')], saves: 0 };
  const G = loadLinkLayer(s);
  const r = G.repairDanglingRelations();
  assert.strictEqual(r.fixed, 1);
  looseDeepEqual(s.nodes[0].relations, [{ targetId: 'p1', relation: 'owned_by' }]);
});

check('②c 找不到就把名字**移进属性**再删关系 —— 那是用户说过的信息,不能丢', () => {
  const s = { nodes: [node('a', 'A', [{ targetId: 'Linda', relation: 'owned_by' }])], saves: 0 };
  const G = loadLinkLayer(s);
  const r = G.repairDanglingRelations();
  assert.strictEqual(r.movedToAttributes, 1);
  looseDeepEqual(s.nodes[0].relations, []);
  assert.strictEqual(s.nodes[0].attributes.owned_by, 'Linda',
    '名字被一起删了 —— 那是用户说过的「Linda 的娃娃」,删了就没了');
});

check('②d 好的关系不许被误伤', () => {
  const s = { nodes: [node('a', 'A', [{ targetId: 'b', relation: 'user_linked' }]), node('b', 'B')], saves: 0 };
  const G = loadLinkLayer(s);
  G.repairDanglingRelations();
  looseDeepEqual(s.nodes[0].relations, [{ targetId: 'b', relation: 'user_linked' }]);
  assert.strictEqual(s.saves, 0, '没有悬空关联却写了一次盘');
});

// ── ③ 源头 + 调用点(源码层)────────────────────────────────────────────────
check('③a 语音解析不再把人名塞进 relations', () => {
  assert.ok(!/relations\.push\(\{ targetId: personName/.test(CODE),
    '人名又被当成 targetId 了 —— 这条关系指向不存在的东西,界面永远渲染不出来');
  assert.ok(/attributes\['owner'\] = personName/.test(CODE), '名字要留在属性里,不能一起删掉');
});

check('③b 三处关联调用点都走 linkNodes,不再各写一套', () => {
  for (const [file, why] of [
    ['lib/portal/plan-links.ts', '行程 ↔ 确认邮件'],
    ['components/portal/MemoryNodeDetail.tsx', '记忆详情手动关联'],
    ['components/portal/NesioChatSheet.tsx', '清单 ↔ 计划'],
  ]) {
    const c = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(/linkNodes\(/.test(c), `${file}(${why})没走 linkNodes`);
    assert.ok(!/updateLifeNode\([^)]*\{\s*relations:/.test(c),
      `${file} 还在用 updateLifeNode 直接写 relations —— 那绕过了原子性和去重`);
  }
});

check('③b2 修复函数**真的被调用** —— 不许写了没接上', () => {
  // 那些悬空关联界面上根本渲染不出来,用户不知道它存在,也就永远不会去点某个按钮。
  // 所以只能自动跑。第二遍自查抓到的:函数写好了但没人调。
  assert.ok(/repairDanglingRelations\(\);/.test(CODE.replace('export function repairDanglingRelations', '')),
    'repairDanglingRelations 只定义没调用 —— 存量的悬空关联一条都不会被修');
  const hy = CODE.slice(CODE.indexOf('function hydrateGraphOnce'), CODE.indexOf('function loadAll'));
  assert.ok(/repairDanglingRelations\(\)/.test(hy), '修复没接在水合之后 —— 那是唯一保证「每台设备都跑过一次」的位置');
  assert.ok(/try \{ repairDanglingRelations\(\); \} catch/.test(hy),
    '修复没包 try —— 修不动就把整个图的水合一起带崩,代价远大于收益');
});

check('③c 全仓不许再有别的地方直接往 relations 里塞(sample-data 除外)', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(ROOT + dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (/sample-data\.ts$/.test(p)) continue;          // 演示数据自成一体,不走图写入
      if (/life-graph\.ts$/.test(p)) continue;           // linkNodes 自己就住在这
      const c = read(p.slice(1)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      if (/relations:\s*\[\s*\.\.\./.test(c) || /\.relations\.push\(/.test(c)) hits.push(p.slice(1));
    }
  };
  walk('/lib'); walk('/components');
  looseDeepEqual(hits, [],
    `这些地方还在手写 relations:${hits.join(', ')} —— 绕过 linkNodes 就绕过了原子性、去重和 targetId 校验`);
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`node-links 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`node-links: OK(${results.length} 条,双向一次写 / 幂等 / targetId 必须是真 id / 悬空关联可修 / 调用点归一)`);
