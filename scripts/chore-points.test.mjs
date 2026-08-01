/**
 * 行为契约:家务挣积分,而且只挣一次(2026-08-01,用户:「这两个合并,家务也挣积分」)。
 *
 * 在这之前奖励页是两套经济并排:上面「乐高」按**钱**攒(进度来自家务挣的钱,
 * 存家庭服务端),下面愿望清单按**积分**攒(存本机)。同一页两种单位、两条进度条。
 * 合并成积分一种之后,「做够这些家务就能换那个东西」在心里是直接对得上的。
 *
 * 两件事必须钉死:
 *   ① **幂等**。同一件家务在今天页和家庭板上各有一个「完成」按钮,而刷新之后
 *      board 还会把它带回来 —— 不去重就是「点两下多 20 分」。
 *   ② **什么时候算挣到**。要审核的家务,批准之前不给分 ——
 *      做完就给等于绕开了审核这件事本身。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadEngine() {
  const js = ts.transpileModule(read('lib/platform/rewards-engine.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const store = new Map();
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: () => ({ reportStorageDropped: () => {} }),
    Date, Math, Number, Array, Object, String, JSON, isNaN, RegExp, Boolean,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    window: { dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} },
    CustomEvent: class { constructor(t) { this.type = t; } },
  });
  return mod.exports;
}

/* ══ ① 换算:1 元 = 1 积分,0 元的家务也给底分 ═══════════════════════════════ */
{
  const R = loadEngine();
  assert.equal(R.chorePointValue(20), 20, '1 元 = 1 积分 —— 和愿望定价同一口径');
  assert.equal(R.chorePointValue(2.4), 2, '取整');
  assert.equal(R.chorePointValue(0.2), 1, '不足 1 元也至少给 1 分 —— 给 0 分等于白做');
  assert.equal(R.chorePointValue(0), R.POINTS_PER_UNPAID_CHORE,
    '不带钱的家务(纯分工那种)要给底分 —— 做完一件事什么都没发生,下次就不会有人点「完成」了');
  assert.equal(R.chorePointValue(-5), R.POINTS_PER_UNPAID_CHORE, '负数当没金额');
  assert.equal(R.chorePointValue(NaN), R.POINTS_PER_UNPAID_CHORE, '脏数据不许算出 NaN 分');
  assert.ok(R.POINTS_PER_UNPAID_CHORE > 0, '底分必须为正');
}

/* ══ ② 幂等:同一件家务只给一次 ═══════════════════════════════════════════ */
{
  const R = loadEngine();
  const chore = { id: 'ci_1', title: '洗碗', value: 20, state: 'done', needsApproval: false };

  R.earnChorePoints(chore, 'zh');
  assert.equal(R.getPoints(), 20, '第一次给分');

  R.earnChorePoints(chore, 'zh');
  R.earnChorePoints(chore, 'zh');
  assert.equal(R.getPoints(), 20,
    `同一件家务给了不止一次(现在 ${R.getPoints()} 分) —— ` +
    '今天页和家庭板各有一个「完成」按钮,刷新之后 board 还会把它带回来,不去重就是「点两下多 20 分」');

  // 账本里也只有一笔
  const entries = R.loadRewards().ledger.filter((e) => e.source === 'chore');
  assert.equal(entries.length, 1, `账本里应当只有一笔(实际 ${entries.length})`);
  assert.equal(entries[0].sourceId, 'ci_1', '这一笔要记着是哪件家务挣的,否则没法去重');
  assert.match(entries[0].label, /洗碗/, '账本要写清是哪件家务');

  // 另一件家务照常给
  R.earnChorePoints({ id: 'ci_2', title: '倒垃圾', value: 5, state: 'done', needsApproval: false }, 'zh');
  assert.equal(R.getPoints(), 25, '别的家务不该被去重挡住');

  // 没有 sourceId 的来源仍然每次都累加(训练打卡那类每次都是新的一次)
  R.earnPoints(20, 'fitness', '训练完成');
  R.earnPoints(20, 'fitness', '训练完成');
  assert.equal(R.getPoints(), 65, '不带 sourceId 的来源不该被误去重');
}

/* ══ ③ 要审核的,批准之前不给分 ═══════════════════════════════════════════ */
{
  const R = loadEngine();
  const base = { id: 'ci_x', title: '擦窗', value: 30, needsApproval: true };

  assert.equal(R.earnChorePoints({ ...base, state: 'todo' }, 'zh'), null, '没做的不给');
  assert.equal(R.getPoints(), 0);

  assert.equal(R.earnChorePoints({ ...base, state: 'done' }, 'zh'), null,
    '要审核的家务在批准之前不许给分 —— 做完就给等于绕开了审核这件事本身');
  assert.equal(R.getPoints(), 0);

  R.earnChorePoints({ ...base, state: 'approved' }, 'zh');
  assert.equal(R.getPoints(), 30, '批准之后才给');

  // 后续状态(已发薪)不再重复给
  R.earnChorePoints({ ...base, state: 'paid' }, 'zh');
  assert.equal(R.getPoints(), 30, '同一件家务走到 paid 不该再给一次');
}

/* ══ ④ 不要审核的,点完成就给 ═════════════════════════════════════════════ */
{
  const R = loadEngine();
  const base = { id: 'ci_y', title: '收衣服', value: 10, needsApproval: false };
  assert.equal(R.earnChorePoints({ ...base, state: 'todo' }, 'zh'), null, '没做的还是不给');
  R.earnChorePoints({ ...base, state: 'done' }, 'zh');
  assert.equal(R.getPoints(), 10, '不要审核的点完成就该给 —— 不然那颗按钮点了什么都没发生');
}

/* ══ ⑤ 接线:两个调用点走同一个函数,而且只给自己做的记分 ═══════════════════ */
{
  const award = stripComments(read('components/portal/family/award-chore-points.ts'));
  assert.match(award, /earnChorePoints\(chore, locale\)/, '记分要走共享判据');
  // 必须重新读 board:点击时手上那条是**动作之前**的状态
  assert.match(award, /await getBoard\(familyId\)/,
    '要重新读一遍 board —— 客户端手上那条是动作之前的状态,拿它去判,' +
    '要审核的那些会在还没批的时候就把分发了');
  assert.match(award, /chore\.assigneeId !== board\.me\.id/,
    '只给自己做的记分 —— 家长批准别人的家务不该往自己的积分池里加');
  assert.match(award, /catch \{/, '记分失败不许把「家务完成」一起打翻');

  for (const f of ['components/portal/family/FamilySharingSheet.tsx', 'components/portal/today/FamilyTodayStrip.tsx']) {
    const src = stripComments(read(f));
    assert.match(src, /awardChorePoints\(familyId, instanceId/, `${f} 没接上家务积分`);
    // 不许在调用点自己算分(那就是第二份判据)
    assert.doesNotMatch(src, /earnPoints\(/, `${f} 不许自己调 earnPoints —— 判据只有一份`);
  }
}

console.log('chore-points: OK(1元=1分·0元给底分 / 同一件只给一次 / 要审核的批准后才给 / 只记自己做的)');
