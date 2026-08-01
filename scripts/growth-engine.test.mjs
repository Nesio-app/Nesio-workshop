/**
 * 行为契约:智能引导引擎(用户定核心 = 真实记忆 → 镜头 → 三态)。
 * 锁死(纯规则层,不碰 AI):
 *  1) 情绪疏导镜头匹配到近 3 天带低落情绪的记忆(nudge);
 *  2) 认知重评镜头匹配到自责/灾难化的想法(quiz);
 *  3) 趋势洞察镜头匹配到近 7 天 ≥4 笔且 ≥$80 的购物/快递(trend);
 *  4) collectSeeds 去掉已回应(answered)的种子、限量;各镜头是插件(LENSES 数组);
 *  5) 行动卡点 / 伴读碰撞 / 心智经营方程镜头可匹配;假成功 AI 文案被拒收。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp, Math });
  return mod.exports;
}

const NOW = new Date('2026-07-17T12:00:00.000Z').getTime();
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();

const protocols = loadTs('../lib/portal/growth-protocols.ts', () => ({}));

function makeEngine({ nodes = [], txs = [] } = {}) {
  return loadTs('../lib/portal/growth-engine.ts', (p) => {
    if (p.includes('life-graph')) return { getLifeGraph: () => nodes };
    if (p.includes('bank-tx')) return { loadBankTx: () => txs };
    if (p.includes('growth-protocols')) return protocols;
    return {};
  });
}

// 1) 情绪疏导 nudge
{
  const eng = makeEngine({ nodes: [{ id: 'm1', name: '有点累', tags: ['情绪'], createdAt: day(1), attributes: { notes: '这周活太多，扛不住' } }] });
  const seeds = eng.collectSeeds(NOW, new Set(), 3);
  const soothe = seeds.find((s) => s.lensId === 'soothe');
  assert.ok(soothe && soothe.mode === 'nudge', '低落情绪 → 情绪疏导 nudge');
  assert.ok(soothe.sourceText.includes('有点累'));
}

// 2) 认知重评 quiz(自责)
{
  const eng = makeEngine({ nodes: [{ id: 'r1', name: '错过了 due，忘了开会', tags: [], createdAt: day(1), attributes: { notes: '我怎么这么没用，都怪我' } }] });
  const seeds = eng.collectSeeds(NOW, new Set(), 3);
  const rf = seeds.find((s) => s.lensId === 'reframe');
  assert.ok(rf && rf.mode === 'quiz', '自责想法 → 认知重评 quiz');
}

// 3) 趋势洞察 trend(购物)
{
  const txs = Array.from({ length: 5 }, (_, i) => ({ date: day(i).slice(0,10), name: 'AMAZON.COM', amount: 30, category: '购物' }));
  const eng = makeEngine({ txs });
  const seeds = eng.collectSeeds(NOW, new Set(), 3);
  const tr = seeds.find((s) => s.lensId === 'trend-spend');
  assert.ok(tr && tr.mode === 'trend', '购物多 → 趋势 trend');
  assert.ok(tr.sourceText.includes('5 笔'));
  // 不足阈值不出
  const eng2 = makeEngine({ txs: txs.slice(0, 2) });
  assert.ok(!eng2.collectSeeds(NOW, new Set(), 3).some((s) => s.lensId === 'trend-spend'), '不足 4 笔不出趋势');
}

// 3b) 斯多葛控制二分 nudge(对控制不了的事挂心)
{
  const eng = makeEngine({ nodes: [{ id: 'w1', name: '下周面试', tags: [], createdAt: day(1), attributes: { notes: '好担心，万一搞砸了怎么办' } }] });
  const st = eng.collectSeeds(NOW, new Set(), 3).find((s) => s.lensId === 'stoic');
  assert.ok(st && st.mode === 'nudge', '挂心控制不了的事 → 斯多葛 nudge');
}

// 3c) 苏格拉底追问 nudge(绝对判断)
{
  const eng = makeEngine({ nodes: [{ id: 'a1', name: '复盘', tags: [], createdAt: day(1), attributes: { notes: '他总是不回消息，根本不在乎这个项目' } }] });
  const so = eng.collectSeeds(NOW, new Set(), 3).find((s) => s.lensId === 'socratic');
  assert.ok(so && so.mode === 'nudge' && so.sourceText.includes('复盘'), '绝对判断 → 苏格拉底 nudge');
}

// 3d) 行动卡点(未完成承诺 5–30 天)
{
  const eng = makeEngine({ nodes: [{ id: 'c1', type: 'task', name: '把方案写完', createdAt: day(10), attributes: { notes: '想清楚再动手' }, tags: [] }] });
  const seed = eng.collectSeeds(NOW, new Set(), 3).find((s) => s.lensId === 'action-stall');
  assert.ok(seed && seed.mode === 'nudge', '未完成承诺 → 行动卡点');
  assert.equal(seed.meta?.stall, 'overthink');
}

// 3e) 伴读碰撞(久放高置信)
{
  const eng = makeEngine({ nodes: [{ id: 'd1', type: 'Mind', name: '某本书的观点还记得', confidence: 0.9, createdAt: day(25), attributes: { notes: '真正重要的是把判断写下来再碰一次，而不是急着收藏更多摘要。' } }] });
  const seed = eng.collectSeeds(NOW, new Set(), 3).find((s) => s.lensId === 'collision-read');
  assert.ok(seed && seed.mode === 'nudge', '久放高置信 → 伴读碰撞');
}

// 3f) 心智经营方程(事业语料)
{
  const eng = makeEngine({ nodes: [{ id: 'b1', name: '获客复盘', createdAt: day(1), attributes: { notes: '内容发了但客户没转化，定价也不敢动' } }] });
  const seed = eng.collectSeeds(NOW, new Set(), 3).find((s) => s.lensId === 'biz-equation');
  assert.ok(seed && seed.mode === 'quiz', '事业语料 → 心智经营 quiz');
}

// 3g) 协议:拒收假成功 + 回看分级
{
  assert.ok(protocols.isGrowthAiSlop('云端脑子有点挤，过几分钟再问一次。'), '假成功文案拒收');
  assert.equal(protocols.gradeReflection('嗯'), 0);
  assert.equal(protocols.gradeReflection('因为证据不够，所以定价其实还站不住 —— 怎么办?', '定价还站不住'), 3);
  assert.ok(protocols.ZHANG_LI_EQUATION.formulaZh.includes('触达力'));
}

// 4) answered 去重 + 限量 + 插件数组 + 同源只出一张 + 优先级
{
  const eng = makeEngine({ nodes: [{ id: 'm1', name: '累', tags: ['情绪'], createdAt: day(1), attributes: { notes: '压力好大' } }] });
  assert.ok(eng.collectSeeds(NOW, new Set(['soothe:m1']), 3).every((s) => s.id !== 'soothe:m1'), '已回应不再出');
  assert.ok(Array.isArray(eng.LENSES) && eng.LENSES.length >= 8, '镜头库是数组(插件式,≥8 镜头)');
  assert.equal(eng.collectSeeds(NOW, new Set(), 0).length, 0, 'limit=0 不出');
  // 去重键 = seed.id(`${lensId}:${sourceId}`):回看流存的 refId 就是 seed.id,故按 seed.id 去重能命中
  const seed = eng.collectSeeds(NOW, new Set(), 3).find((s) => s.lensId === 'soothe');
  assert.equal(seed.id, `soothe:${seed.sourceId}`, 'seed.id = lensId:sourceId(答完存这个当 refId)');
  // 一段记忆同时命中多镜头(自责+绝对+控制忧虑)→ 只出一张,按 LENSES 顺序取最靠前(reframe)
  const multi = makeEngine({ nodes: [{ id: 'x1', name: '崩了', tags: [], createdAt: day(1), attributes: { notes: '都怪我，我永远做不好，好担心万一被开怎么办' } }] });
  const forX1 = multi.collectSeeds(NOW, new Set(), 3).filter((s) => s.sourceId === 'x1');
  assert.equal(forX1.length, 1, '同一段记忆只出一张卡');
  assert.equal(forX1[0].lensId, 'reframe', '多镜头命中时取优先级最高的(reframe 在 stoic/socratic 之前)');
}

// 5) 心智成长图鉴聚合:六维全量 + 老卡 kind 兜底 + 等级门槛
{
  const eng = makeEngine();
  const stats = eng.summarizeDimensions([
    { dimension: 'emotion' }, { dimension: 'emotion' }, { dimension: 'emotion' }, // 3 → 成形(level2)
    { kind: 'spend_shift' },                                                        // 无 dimension → 兜底 blindspot
    { dimension: 'zzz-unknown' },                                                   // 非法维度忽略
  ]);
  assert.equal(stats.length, 6, '图鉴永远返回六维');
  const by = Object.fromEntries(stats.map((s) => [s.dimension, s]));
  assert.equal(by.emotion.count, 3, '情绪 3 次');
  assert.equal(by.emotion.level, 2, '3 次 = 成形(level2)');
  assert.equal(by.blindspot.count, 1, '老卡 spend_shift 兜底到 blindspot');
  assert.equal(by.logic.count, 0, '没答过的维度 count=0');
  assert.equal(eng.levelOf(0), 0, '0 次未点亮');
  assert.equal(eng.levelOf(2), 1, '<3 萌芽');
  assert.equal(eng.levelOf(6), 3, '≥6 纯熟');
  assert.deepEqual(stats.map((s) => s.dimension), eng.DIMENSION_ORDER, '顺序 = DIMENSION_ORDER');
}

console.log('growth-engine contract tests passed');
