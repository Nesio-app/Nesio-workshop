/**
 * backlink-mention —— 反链保底 + @提及边写边连。
 *
 * 这两件事修的是同一个症状:**边建了,但你看不到 / 建不起来**。
 *   · 反链:显式关联被「相关」的打分挤掉,或者关系名不在白名单里直接消失;
 *   · @提及:要连两条记忆得进详情页点四步,所以自己建的边几乎没有。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function runSource(rel) {
  const src = read(rel).replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports, JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp,
    console, require: () => ({}),
  });
  return m.exports;
}

const M = runSource('lib/portal/mention.ts');
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── ① 反链保底 ────────────────────────────────────────────────────────────
/**
 * 真跑排序器。原来这条是 grep MemoryTab 源码 —— 挡不住「在末尾再补一个 slice」
 * 那种回归(自查反证时正好踩到:注入了 `.slice()` 而断言照样绿)。
 * 逻辑现在抽在 lib/portal/related-nodes.ts,可以直接跑。
 */
const R = runSource('lib/portal/related-nodes.ts');
const DEPS = {
  extractKeywords: (t) => String(t).toLowerCase().split(/[\s,，。]+/).filter(Boolean),
  isExcluded: () => false,
  isBulkImported: () => false,
  systemTags: new Set(),
};

check('①a 显式关联**一条不少**,不被「相关」的额度挤掉', () => {
  // 8 条显式关联 + 20 条标签高度重合的噪声。旧写法:显式 10 分,4 个共同标签 12 分 →
  // 噪声排前面,slice(0,5) 之后你亲手连的 8 条一条都看不到。
  const target = {
    id: 't', name: '目标', createdAt: '2026-07-01', tags: ['a', 'b', 'c', 'd'],
    relations: Array.from({ length: 8 }, (_, i) => ({ targetId: `e${i}`, relation: 'user_linked' })),
  };
  const explicitNodes = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, name: `连过的${i}`, createdAt: '2026-07-01', tags: [] }));
  const noise = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, name: `噪声${i}`, createdAt: '2026-07-01', tags: ['a', 'b', 'c', 'd'] }));
  const { explicit, guessed } = R.rankRelatedNodes(target, [...noise, ...explicitNodes], DEPS);
  assert.strictEqual(explicit.length, 8, `显式关联被截掉了(只剩 ${explicit.length} 条)`);
  assert.ok(guessed.length <= R.RELATED_GUESS_CAP, '猜出来的没有截断');
  // 合起来的列表里 8 条显式的必须都在,而且都在噪声前面
  const merged = [...explicit, ...guessed].map((n) => n.id);
  for (let i = 0; i < 8; i++) assert.ok(merged.indexOf(`e${i}`) < 8, `e${i} 没排在最前`);
});

check('①a2 反向边也算显式(从 B 看 A)—— 反链就是这个意思', () => {
  const target = { id: 't', name: '目标', createdAt: '2026-07-01', tags: [], relations: [] };
  const back = { id: 'b', name: '指回来的', createdAt: '2026-07-01', tags: [], relations: [{ targetId: 't', relation: 'user_linked' }] };
  const { explicit } = R.rankRelatedNodes(target, [back], DEPS);
  assert.strictEqual(explicit.length, 1, '只认自己出去的边 —— 那不叫反链');
});

check('①a3 显式关联即使是批量导入的也照样显示', () => {
  const target = { id: 't', name: '目标', createdAt: '2026-07-01', tags: [], relations: [{ targetId: 'b', relation: 'user_linked' }] };
  const bulk = { id: 'b', name: '导进来的', createdAt: '2026-07-01', tags: [] };
  const { explicit } = R.rankRelatedNodes(target, [bulk], { ...DEPS, isBulkImported: () => true });
  assert.strictEqual(explicit.length, 1, '你亲手连过的东西不该因为「批量导入」被藏起来');
});

check('①a4 MemoryTab 合起来之后**不再截断**', () => {
  const c = strip(read('components/portal/MemoryTab.tsx'));
  const fn = c.slice(c.indexOf('function findRelatedNodes'), c.indexOf('function findOnThisDayNodes'));
  assert.ok(/return \[\.\.\.explicit, \.\.\.guessed\] as LifeNode\[\];/.test(fn),
    '合起来之后又截断了 —— 等于把显式关联重新挤掉');
});

check('①b 详情页**不按白名单过滤**关系名 —— 新关系类型不该凭空消失', () => {
  const c = strip(read('components/portal/MemoryNodeDetail.tsx'));
  assert.ok(!/Boolean\(REL_LABEL\[x\.r\.relation\]\)/.test(c),
    '还在用白名单过滤 —— 每加一种关系都要有人记得回来改这张表,忘了就是「关联建了但什么都没有」且不报错');
  assert.ok(/const relMeta = \(rel: string\)/.test(c), '没有兜底标签');
  assert.ok(/REL_LABEL\[rel\] \?\?/.test(c), 'relMeta 没做 ?? 兜底');
});

check('①c 上周新建的三种关系都有自己的标签(不是只靠兜底)', () => {
  const c = read('components/portal/MemoryNodeDetail.tsx');
  for (const [rel, why] of [
    ['involves_person', '「这笔钱关联了谁」在详情页是隐形的'],
    ['paid_by_tx', '认领关系看不到'],
    ['checklist_of', '从清单那一侧看不到它属于谁(这条一直漏着)'],
  ]) {
    assert.ok(new RegExp(`${rel}:\\s*\\[`).test(c), `REL_LABEL 缺 ${rel} —— ${why}`);
  }
});

// ── ② @提及:查询解析 ─────────────────────────────────────────────────────
check('②a 词首的 @ 才触发 —— 邮箱不该一直弹候选框', () => {
  assert.strictEqual(M.activeMentionQuery('a@b.com', 7), null, 'a@b.com 触发了候选框');
  assert.deepStrictEqual({ ...M.activeMentionQuery('@lin', 4) }, { at: 0, query: 'lin' });
  assert.deepStrictEqual({ ...M.activeMentionQuery('今天见了 @lin', 9) }, { at: 5, query: 'lin' });
});

check('②b 全角＠也认(中文输入法下常打成这个)', () => {
  const q = M.activeMentionQuery('＠lin', 4);
  assert.ok(q, '全角＠没触发 —— 中文输入法下这是默认输出,不认等于这个功能对中文用户不存在');
  assert.strictEqual(q.query, 'lin');
});

check('②c 换行之后不再算同一个 @', () => {
  assert.strictEqual(M.activeMentionQuery('@lin\n然后', 7), null, '跨行还在找 @ —— 那是另一段话了');
});

check('②d 打太长就不算在提名字了', () => {
  const long = `@${'字'.repeat(40)}`;
  assert.strictEqual(M.activeMentionQuery(long, long.length), null, '写了一长段还弹候选框');
});

// ── ③ 候选:不猜 ──────────────────────────────────────────────────────────
const NODES = [
  { id: 'n1', name: 'Linda' },
  { id: 'n2', name: 'Linda 的生日' },
  { id: 'n3', name: '客厅灯' },
  { id: 'n4', name: '和 Linda 吃饭' },
];

check('③a 前缀命中排在包含命中前面', () => {
  const out = M.mentionCandidates('lin', NODES);
  assert.strictEqual(out[0].name, 'Linda', `打 @lin 时 Linda 该排第一(得到 ${out[0]?.name})`);
  // 「和 Linda 吃饭」是包含命中,该排在两个前缀命中之后
  assert.ok(out.findIndex((c) => c.id === 'n4') > out.findIndex((c) => c.id === 'n2'));
});

check('③b 不做模糊匹配 —— 猜错会连上不相干的记忆,而且看起来像你自己连的', () => {
  assert.strictEqual(M.mentionCandidates('lnd', NODES).length, 0, '漏字也能命中 = 模糊匹配,会连错');
  assert.strictEqual(M.mentionCandidates('', NODES).length, 0, '空查询返回了候选');
});

check('③c 不把自己列进候选', () => {
  const out = M.mentionCandidates('lin', NODES, { excludeId: 'n1' });
  assert.ok(!out.some((c) => c.id === 'n1'));
});

// ── ④ 插入 ────────────────────────────────────────────────────────────────
check('④a 插入替换掉 @查询那一段,并把光标放到插入位之后', () => {
  const text = '今天见了 @lin';
  const q = M.activeMentionQuery(text, text.length);
  const r = M.applyMention(text, q, { id: 'n1', name: 'Linda' });
  assert.strictEqual(r.text, '今天见了 Linda ');
  assert.strictEqual(r.caret, r.text.length, '光标没跟上 —— 会跳到末尾,接着打字就接错地方');
});

check('④b 中间插入不吃掉后面的字', () => {
  const text = '@lin 说了个事';
  const q = M.activeMentionQuery(text, 4);
  const r = M.applyMention(text, q, { id: 'n1', name: 'Linda' });
  assert.strictEqual(r.text, 'Linda  说了个事');
});

// ── ⑤ 结算:只连名字还在文本里的 ──────────────────────────────────────────
check('⑤a 插了又删掉 → 不连', () => {
  const out = M.settleMentions('今天没提她', [{ id: 'n1', name: 'Linda' }]);
  assert.strictEqual(out.length, 0, '名字已经被删了还连 —— 你会得到一条自己没建过的关联');
});

check('⑤b 名字还在 → 连', () => {
  const out = M.settleMentions('今天见了 Linda', [{ id: 'n1', name: 'Linda' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'n1');
});

check('⑤c 同一条提两次只连一次', () => {
  const out = M.settleMentions('Linda 和 Linda', [{ id: 'n1', name: 'Linda' }, { id: 'n1', name: 'Linda' }]);
  assert.strictEqual(out.length, 1);
});

// ── ⑥ 接线 ────────────────────────────────────────────────────────────────
check('⑥a 提交时**结算**再连,不是选中就连', () => {
  const c = strip(read('components/portal/TodayFeed.tsx'));
  assert.ok(/settleMentions\(quickAdd, pendingMentions\)/.test(c),
    '没有结算 —— 插了又删的 mention 也会被连上');
  // 2026-07-31:连边的动作从 TodayFeed 挪进了 lib/portal/mention.ts ——
  // `check:leak` 那条架构规则不许「今天」页静态 import life-graph
  // (今天页只能消费 TodayViewModel)。所以这里钉的是**意图**不是位置:
  // 今天页要真的发起连接,而关系名仍然是 user_linked。
  assert.ok(/linkSettledMentions\(created\.id, settled\)/.test(c),
    '结算完没有真的去连 —— 那 @提及就只是往文本里插了个名字');
  const M = strip(read('lib/portal/mention.ts'));
  assert.ok(/linkNodes\(sourceId, m\.id, 'user_linked'\)/.test(M),
    'mention 的连边不再走 user_linked —— 关系名换了,MemoryNodeDetail 那边的标签就对不上了');
  assert.ok(!/from '@\/lib\/portal\/life-graph'/.test(c),
    '今天页又静态 import 了 life-graph —— `npm run build` 里的 check:leak 会红,'
    + '而 tsc 和 test:security 都发现不了(这次就是这么红了 4 小时)');
});

check('⑥b 连不上要说出来,但不拦提交', () => {
  const c = strip(read('components/portal/TodayFeed.tsx'));
  assert.ok(/没能关联上|link\(s\) failed/.test(c),
    '连失败静默了 —— 你会以为连上了');
  // 提交本身不能因为关联失败而中断:记录是你要的东西
  const at = c.indexOf('const settled = settleMentions');
  const after = c.slice(at, at + 900);
  assert.ok(/setQuickAdd\(''\)/.test(after), '关联失败把提交也挡了 —— 为一条关联丢掉记录更糟');
});

check('⑥c 候选框开着时 Enter 归它,不能变成「记下」', () => {
  const c = strip(read('components/portal/today/CaptureBar.tsx'));
  assert.ok(/if \(mention && \(e\.key === 'Enter'/.test(c),
    '候选开着时按 Enter 会直接提交 —— 选不中候选,这个功能就废了');
  const p = strip(read('components/portal/MentionPicker.tsx'));
  assert.ok(/addEventListener\('keydown', onKey, true\)/.test(p),
    '没用 capture 阶段 —— 输入框会先拿到 Enter');
});

check('⑥d 候选用 onMouseDown 选,不是 onClick(onClick 前输入框已失焦→框已关)', () => {
  const p = strip(read('components/portal/MentionPicker.tsx'));
  assert.ok(/onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); onPick\(c\); \}\}/.test(p),
    '用 onClick 的话鼠标永远点不中候选');
});

check('⑥e 候选框有定位上下文,不会弹到屏幕顶上', () => {
  const css = read('app/globals.css');
  const at = css.indexOf('.nesio-tl-capture-pill {');
  assert.ok(at > 0);
  assert.ok(/position: relative;/.test(css.slice(at, at + 400)),
    'capture-pill 没有 position:relative —— absolute 的候选框会挂到更外层,弹错位置');
});

const bad = results.filter((r) => r[0] === 'FAIL');
if (bad.length) {
  console.error(`backlink-mention 有 ${bad.length} 条不过:`);
  for (const [, name, msg] of bad) console.error(`  - ${name} → ${msg}`);
  process.exit(1);
}
console.log(`backlink-mention: OK(${results.length} 条:显式关联保底 / 关系名不白名单 / @提及不猜 / 结算再连)`);
