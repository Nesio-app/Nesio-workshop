/**
 * 行为契约:家务 + 零花钱账本确定性核心(lib/family/chores-core.ts)。
 * 钉死 M1 的不变式 —— 账本幂等/冲账/顺序无关、状态机合法迁移、能力 fail-closed、周期生成幂等。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/family/chores-core.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Number, String, Math, Array, Object, Set });
  return mod.exports;
}

const M = load();

const parent = { id: 'p1', name: 'Mom', canApprove: true, needsApproval: false, canRecordPayout: true };
const kid = { id: 'k1', name: 'Maya', canApprove: false, needsApproval: true, canRecordPayout: false };

const mkInstance = (over = {}) => ({
  id: 'c1', templateId: 't1', assigneeId: 'k1', dueDate: '2026-02-05', value: 1,
  state: 'todo', needsApproval: true, ...over,
});

// ── 状态机 ──
assert.equal(M.canTransition('todo', 'done'), true);
assert.equal(M.canTransition('done', 'approved'), true);
assert.equal(M.canTransition('done', 'todo'), true, '"再来一次" 合法');
assert.equal(M.canTransition('approved', 'paid'), true);
assert.equal(M.canTransition('todo', 'approved'), false, 'todo 不能直接跳 approved');
assert.equal(M.canTransition('paid', 'approved'), false, 'paid 是终态');

// ── 能力 fail-closed ──
assert.equal(M.memberCan(null, 'approve'), false, '身份缺失一律拒');
assert.equal(M.memberCan(kid, 'approve'), false, '孩子不能审核');
assert.equal(M.memberCan(parent, 'approve'), true);
assert.equal(M.memberCan(kid, 'record_payout'), false);
assert.equal(M.memberCan(parent, 'record_payout'), true);

// ── markChoreDone:需审核 → done;不需审核 → 直接 approved(即时记账) ──
{
  const r = M.markChoreDone(mkInstance(), kid, '2026-02-05T09:00:00Z');
  assert.equal(r.ok, true);
  assert.equal(r.value.state, 'done', '需审核的活干完进待审');
  assert.equal(r.value.doneAt, '2026-02-05T09:00:00Z');
}
{
  const r = M.markChoreDone(mkInstance({ needsApproval: false }), kid, 't');
  assert.equal(r.ok, true);
  assert.equal(r.value.state, 'approved', '不需审核 → 即时 approved(counts right away)');
  assert.equal(r.value.approvedAt, 't');
}
{
  // 别人不能替非自己的活打勾(除非 canApprove)
  const other = { id: 'k2', name: 'Sam', canApprove: false, needsApproval: true, canRecordPayout: false };
  const r = M.markChoreDone(mkInstance(), other, 't');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_assignee');
}

// ── approve:孩子被拒(fail-closed),家长通过 ──
{
  const done = M.markChoreDone(mkInstance(), kid, 't').value;
  const denied = M.approveChore(done, kid, 't2');
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'forbidden', '无 canApprove 的人审核被核心拒绝(哪怕 UI 没藏)');
  const ok = M.approveChore(done, parent, 't2');
  assert.equal(ok.ok, true);
  assert.equal(ok.value.state, 'approved');
  assert.equal(ok.value.approvedAt, 't2');
  // approve 一个非 done 态 → bad_state
  assert.equal(M.approveChore(mkInstance({ state: 'todo' }), parent, 't').error, 'bad_state');
}

// ── sendBack "再来一次" ──
{
  const done = M.markChoreDone(mkInstance({ proofPhotoRef: 'vault://x' }), kid, 't').value;
  const back = M.sendBackChore(done, parent);
  assert.equal(back.ok, true);
  assert.equal(back.value.state, 'todo');
  assert.equal(back.value.doneAt, undefined, '退回清掉 doneAt');
  assert.equal(back.value.proofPhotoRef, undefined, '退回清掉存证照');
  assert.equal(M.sendBackChore(done, kid).error, 'forbidden');
}

// ── recordPayout:能力 + 正数校验 ──
{
  assert.equal(M.recordPayout(kid, { id: 'p', personId: 'k1', amount: 10, date: 'd' }).error, 'forbidden');
  assert.equal(M.recordPayout(parent, { id: 'p', personId: 'k1', amount: -5, date: 'd' }).error, 'invalid');
  const ok = M.recordPayout(parent, { id: 'p', personId: 'k1', amount: 10, date: 'd' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.amount, 10);
}

// ── 派生账本:幂等 / 冲账 / 顺序无关 ──
{
  const chores = [
    { id: 'a', assigneeId: 'k1', value: 3, state: 'approved' },
    { id: 'b', assigneeId: 'k1', value: 2, state: 'approved' },
    { id: 'c', assigneeId: 'k1', value: 5, state: 'todo' },     // 未审核,不计
    { id: 'd', assigneeId: 'k2', value: 9, state: 'approved' },  // 别人的,不计
  ];
  const payouts = [{ id: 'x', personId: 'k1', amount: 4, date: 'd' }];
  const bal = M.computeBalance('k1', chores, payouts);
  assert.equal(bal.earned, 5, 'Σ approved(3+2),todo 与他人不计');
  assert.equal(bal.paidOut, 4);
  assert.equal(bal.owed, 1, 'earned − paidOut = 5 − 4');

  // 幂等:同一 approved 实例重复出现不翻倍
  const dup = M.computeBalance('k1', [...chores, { id: 'a', assigneeId: 'k1', value: 3, state: 'approved' }], payouts);
  assert.equal(dup.earned, 5, '同 id 重复只计一次');

  // 顺序无关
  const rev = M.computeBalance('k1', [...chores].reverse(), [...payouts].reverse());
  assert.equal(rev.owed, bal.owed, '顺序无关');

  // 付款归零
  const zero = M.computeBalance('k1', chores, [{ id: 'x', personId: 'k1', amount: 5, date: 'd' }]);
  assert.equal(zero.owed, 0, '付满 earned → 归零');

  // paid 态仍计入 earned(减账靠 payout,不靠改状态,避免双减)
  const paidChores = [{ id: 'a', assigneeId: 'k1', value: 3, state: 'paid' }];
  assert.equal(M.computeBalance('k1', paidChores, []).earned, 3, 'paid 仍算已挣');
}

// ── 全家总额 ──
{
  const chores = [
    { id: 'a', assigneeId: 'k1', value: 14.5, state: 'approved' },
    { id: 'b', assigneeId: 'k2', value: 8, state: 'approved' },
  ];
  assert.equal(M.computeFamilyTotal(['k1', 'k2'], chores, []), 22.5);
}

// ── 周期生成:幂等 + cadence 正确 ──
{
  const tmpl = { id: 't1', title: 'Water plants', cadence: { kind: 'daily' }, value: 1, assigneeId: 'k1', needsApproval: false };
  const gen = M.generateDueInstances(tmpl, { fromKey: '2026-02-01', toKey: '2026-02-03' }, [], (t, d) => `${t}-${d}`);
  assert.equal(gen.length, 3, 'daily 三天三件');
  assert.equal(gen[0].state, 'todo');
  assert.equal(gen[0].id, 't1-2026-02-01');

  // 幂等:已存在的不重复生成
  const again = M.generateDueInstances(tmpl, { fromKey: '2026-02-01', toKey: '2026-02-03' }, gen, (t, d) => `${t}-${d}`);
  assert.equal(again.length, 0, '已生成的窗口再跑一次:零新增');

  // weekly:2026-02-02 是周一(weekday 1)。注:vm 域内数组跨 realm,用 JSON 串比而非 deepEqual。
  const weekly = { ...tmpl, cadence: { kind: 'weekly', weekdays: [1] } };
  const wk = M.generateDueInstances(weekly, { fromKey: '2026-02-01', toKey: '2026-02-08' }, [], (t, d) => `${t}-${d}`);
  assert.equal(JSON.stringify(wk.map((c) => c.dueDate)), JSON.stringify(['2026-02-02']), '一周里只有周一那天');

  // everyDays n=2 from firstKey
  const every2 = { ...tmpl, cadence: { kind: 'everyDays', n: 2 } };
  const e2 = M.generateDueInstances(every2, { fromKey: '2026-02-01', toKey: '2026-02-05', firstKey: '2026-02-01' }, [], (t, d) => `${t}-${d}`);
  assert.equal(JSON.stringify(e2.map((c) => c.dueDate)), JSON.stringify(['2026-02-01', '2026-02-03', '2026-02-05']));
}

console.log('family-chores-core: OK');
