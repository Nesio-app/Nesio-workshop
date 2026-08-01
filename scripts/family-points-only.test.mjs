/**
 * 行为契约:家务这一整套只说积分,不说钱(2026-08-01,用户:
 * 「家务挣积分,把钱相关的 UI 逻辑都换。不需要给现金。不存在负数」)。
 *
 * 用户实测那一屏:「已多给 TA ¥20.00 · 审核过的家务往上加 · 你给的现金往下扣」。
 * 那是一套**借贷账**:家务加钱、发现金扣钱、给多了余额翻负。
 * 而积分只加不减 —— 负数在这套里根本没有意义,「欠不欠」也没有。
 *
 * 撤掉的三样:
 *   · 发薪(「给了现金 → 记一笔」+ 撤销 + payout 历史行);
 *   · owed 这个口径(它是「还没发的工钱」,发一次就掉一截);
 *   · 那块按钱攒的攒钱目标卡(乐高)—— 搬成愿望清单里的一条积分愿望。
 *
 * 服务端的 payout / goal API **没删**:别人的家庭可能还有旧数据,
 * 删接口是另一件事。这里只钉住「界面上不再有入口、也不再算进任何一个数」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));

/* ══ ① 界面上不许再出现货币 ═══════════════════════════════════════════════ */
{
  for (const f of [
    'components/portal/family/FamilySharingSheet.tsx',
    'components/portal/today/FamilyTodayStrip.tsx',
    'components/portal/family/AssignChoreButton.tsx',
  ]) {
    const src = stripComments(read(f));
    assert.doesNotMatch(src, /[¥￥]/, `${f} 里还有 ¥ —— 家务这套已经只说积分`);
    assert.doesNotMatch(src, /toFixed\(2\)/,
      `${f} 里还有 toFixed(2) —— 那是金额的写法,积分是整数`);
    assert.doesNotMatch(src, /const money = /, `${f} 还留着 money() 格式化`);
  }
}

/* ══ ② 发薪整套撤干净 ═════════════════════════════════════════════════════ */
{
  const fam = stripComments(read('components/portal/family/FamilySharingSheet.tsx'));
  for (const gone of ['recordPayout', 'reversePayout', 'setShowPay', 'payoutId']) {
    assert.ok(!fam.includes(gone), `发薪那一套没撤干净:还有 ${gone}`);
  }
  assert.doesNotMatch(fam, /给了现金|Pay out cash|给了多少现金/,
    '「给了现金 → 记一笔」要撤 —— 用户点名「不需要给现金」');
  assert.doesNotMatch(fam, /ledger\.payouts/,
    '历史里不许再混发薪行 —— 一条 −¥20 正是负数的来源');

  // 服务端能力没被顺手删掉(那是另一件事)
  const client = read('lib/family/family-client.ts');
  assert.match(client, /export function recordPayout/,
    '服务端 payout 接口不该顺手删 —— 别人的家庭可能还有旧数据,删接口是另一件事');
}

/* ══ ③ 不存在负数:给用户看的数一律非负 ═══════════════════════════════════ */
{
  const fam = stripComments(read('components/portal/family/FamilySharingSheet.tsx'));
  assert.doesNotMatch(fam, /已多给|overpaid|还欠 TA|You still owe/,
    '「还欠 / 已多给」那套借贷话术要撤 —— 积分只加不减');
  assert.match(fam, /points\(Math\.max\(0, ledger\.balance\.earned\), dict\)/,
    '账本头要报 earned 且夹在 0 以上');
  assert.doesNotMatch(fam, /Math\.abs\(ledger\.balance\.owed\)/,
    '不许再拿 owed 的绝对值当数展示 —— 那正是「已多给 ¥20」的来源');
  // 历史里也不该再有减号那一支
  assert.doesNotMatch(fam, /h\.delta >= 0 \? '\+' : '−'/,
    '历史行不许再有正负两支 —— 只剩家务加分这一种');
}

/* ══ ④ 攒钱目标卡撤掉,并搬成积分愿望 ═════════════════════════════════════ */
{
  assert.ok(!exists('components/portal/family/FamilyGoalCard.tsx'),
    '那块按钱攒的攒钱目标卡要删掉 —— 家务改成挣积分之后它连数据源都没有了');

  const mig = stripComments(read('components/portal/family/migrate-goal-to-wish.ts'));
  assert.match(mig, /addManualReward\(\{ title: label, cost: moneyToPoints\(amount\) \}\)/,
    '已设过的目标要搬成一条积分愿望');
  assert.match(mig, /await setMyGoal\(familyId, 0, ''\)/,
    '搬完要清掉服务端那个 goal —— 两处存着同一个目标就要对账,而对账是「两处不一致」的常见来源');
  assert.match(mig, /catch \{/, '搬不动不该让奖励页出错');

  // ── 幂等真跑一遍。**源码判据在这里压不住**:把 `if (!existing)` 改成 `if (true)`
  //    之后,那行查重代码还在,正则照样匹配、照样绿(注入回归抓出来的)。
  {
    const migJs = ts.transpileModule(read('components/portal/family/migrate-goal-to-wish.ts'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const added = [];
    let cleared = 0;
    let rewards = [];
    const mm = { exports: {} };
    vm.runInNewContext(migJs, {
      module: mm, exports: mm.exports, console, Number, Math, Promise,
      require: (spec) => {
        if (String(spec).includes('family-client')) {
          return {
            listFamilies: async () => ({ ok: true, data: { families: [{ familyId: 'f1' }] } }),
            getBoard: async () => ({ ok: true, data: { board: { me: { goalAmount: 100, goalLabel: '乐高' } } } }),
            setMyGoal: async () => { cleared += 1; return { ok: true }; },
          };
        }
        return {
          loadRewards: () => ({ rewards }),
          addManualReward: (r) => { added.push(r); rewards = [...rewards, { ...r, title: r.title }]; return r; },
        };
      },
    });
    const migrate = mm.exports.migrateFamilyGoalToWish;

    const first = await migrate();
    assert.equal(first, '乐高', '第一次要把目标搬过来');
    assert.equal(added.length, 1, '搬一条');
    assert.equal(added[0].cost, 100, '¥100 → 100 分');
    assert.equal(cleared, 1, '搬完要清掉服务端那个 goal');

    // 再来一次(模拟清 goal 失败、下次又进来):同名已在 → 不许搬第二条
    const again = await migrate();
    assert.equal(added.length, 1,
      `同名愿望已在清单里,不许再搬一条(实际搬了 ${added.length} 条) —— ` +
      '清 goal 万一失败(离线),下次进来会把同一个目标又加一遍');
    assert.equal(again, '', '第二次没搬,就别再报一次「已搬过来」');
  }

  const store = stripComments(read('components/portal/RewardsStore.tsx'));
  assert.match(store, /migrateFamilyGoalToWish\(\)/, '奖励页要真的调那次搬运,不然写了等于没写');
  assert.doesNotMatch(store, /FamilyGoalCard/, '奖励页不许再挂那块卡');
}

/* ══ ⑤ 换算口径只有一份 ═══════════════════════════════════════════════════ */
{
  // 搬运那边的 1元=1分,必须和 chorePointValue 是同一件事 —— 两处不一样的话,
  // 搬过来的目标会和「做几件家务能换到它」对不上数。
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
  const { chorePointValue } = mod.exports;

  const mig = read('components/portal/family/migrate-goal-to-wish.ts');
  const mjs = ts.transpileModule(mig.replace(/^import .*$/gm, ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m2 = { exports: {} };
  vm.runInNewContext(`${mjs}; module.exports.moneyToPoints = moneyToPoints;`, {
    module: m2, exports: m2.exports, Number, Math, console,
  });
  const { moneyToPoints } = m2.exports;

  for (const v of [1, 20, 100, 37]) {
    assert.equal(moneyToPoints(v), chorePointValue(v),
      `搬运的换算(${v} → ${moneyToPoints(v)})和家务的换算(→ ${chorePointValue(v)})对不上 —— ` +
      '两处不一样的话,搬过来的目标会和「做几件家务能换到它」对不上数');
  }
  assert.equal(moneyToPoints(0), 0, '没设过金额就没什么可搬的');
  assert.equal(moneyToPoints(NaN), 0, '脏数据不许搬出 NaN 分');
}

console.log('family-points-only: OK(界面无货币 / 发薪撤干净 / 不存在负数 / 目标搬成积分愿望 / 换算只有一份)');
