/**
 * 行为契约:健身首页确定性核心(lib/platform/fitness-home-core.ts)。
 * 不变式 —— 时长/强度按处方推、本周进度按天去重、今天练哪个不随机、教练提示按规则分档。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/platform/fitness-home-core.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Array, Number, Object, Math, Date, String, RegExp, isNaN });
  return mod.exports;
}
const M = load();

const D = (s) => new Date(`${s}T12:00:00`);

// ── 时长:组数×次数×每次秒 + 组间歇 + 热身,向 5 分钟取整 ──
{
  const items = [{ sets: 3, reps: 5, restSec: 90 }, { sets: 3, reps: 8, restSec: 60 }];
  const min = M.estimateSessionMinutes(items);
  assert.ok(min >= 10 && min <= 30, `时长应在合理量级,得到 ${min}`);
  assert.equal(min % 5, 0, '时长要向 5 分钟取整');
  // 动作更多 → 时间更长(单调)
  assert.ok(M.estimateSessionMinutes([...items, { sets: 3, reps: 10, restSec: 60 }]) > min, '加动作应更久');
  // 有氧按分钟算,不按次
  assert.ok(M.estimateSessionMinutes([{ sets: 1, reps: 30, unit: 'min' }]) >= 30, '30 分钟有氧至少 30 分钟');
}

// ── 强度:优先读 RPE,没有则按总组数 ──
{
  assert.equal(M.sessionIntensity([{ sets: 3, reps: 5, intensity: 'RPE 9' }]), 'hard');
  assert.equal(M.sessionIntensity([{ sets: 3, reps: 5, intensity: 'RPE 7' }]), 'moderate');
  assert.equal(M.sessionIntensity([{ sets: 3, reps: 5, intensity: 'RPE 5' }]), 'light');
  assert.equal(M.sessionIntensity([{ sets: 2, reps: 10 }]), 'light', '2 组无 RPE = 轻');
  assert.equal(M.sessionIntensity([{ sets: 8, reps: 10 }, { sets: 8, reps: 10 }]), 'hard', '16 组无 RPE = 较重');
}

// ── 本周进度:周一起算,一天练两回只算一次 ──
{
  // 2026-07-29 是周三 → 本周一 = 07-27
  const today = D('2026-07-29');
  const log = [
    { date: '2026-07-27', sessionId: 'a' },
    { date: '2026-07-27', sessionId: 'b' },   // 同一天第二次,不重复计
    { date: '2026-07-20', sessionId: 'a' },   // 上周,不算
  ];
  assert.equal(M.doneThisWeek(log, today), 1, '同一天两次只算一次、上周不算');
  const dots = M.weekDots(log, today);
  assert.equal(dots.length, 7);
  assert.equal(dots[0].key, '2026-07-27', '第一格是本周一');
  assert.equal(dots[0].done, true);
  assert.equal(dots[2].isToday, true, '周三是今天');
  assert.equal(dots.filter((d) => d.isToday).length, 1, '只能有一个今天');
}

// 周日边界:周日属于「本周」的最后一格,不是下周第一格
{
  const sunday = D('2026-08-02');   // 周日
  const dots = M.weekDots([], sunday);
  assert.equal(dots[6].isToday, true, '周日应落在第 7 格');
  assert.equal(dots[0].key, '2026-07-27', '周日那周的周一仍是 07-27');
}

// ── 今天练哪个:本周做过的往后跳,确定性 ──
{
  const today = D('2026-07-29');
  const ids = ['lowerA', 'upperB', 'fullC'];
  assert.equal(M.pickTodaySessionIndex(ids, [], today), 0, '没练过 → 第一个');
  assert.equal(M.pickTodaySessionIndex(ids, [{ date: '2026-07-27', sessionId: 'lowerA' }], today), 1, '做过 A → 轮到 B');
  const all = ids.map((id) => ({ date: '2026-07-27', sessionId: id }));
  assert.equal(M.pickTodaySessionIndex(ids, all, today), 0, '本周都做过 → 回到第一个');
  // 上周做过不影响本周
  assert.equal(M.pickTodaySessionIndex(ids, [{ date: '2026-07-20', sessionId: 'lowerA' }], today), 0, '上周的不算');
  // 同样输入两次同样输出
  assert.equal(
    M.pickTodaySessionIndex(ids, [{ date: '2026-07-28', sessionId: 'upperB' }], today),
    M.pickTodaySessionIndex(ids, [{ date: '2026-07-28', sessionId: 'upperB' }], today),
    '必须确定性',
  );
}

// ── 距上次几天 ──
{
  const today = D('2026-07-29');
  assert.equal(M.daysSinceLast([], today), null, '没练过 = null');
  assert.equal(M.daysSinceLast([{ date: '2026-07-29', sessionId: 'a' }], today), 0);
  assert.equal(M.daysSinceLast([{ date: '2026-07-27', sessionId: 'a' }], today), 2);
  // 取最近的一条,不是第一条
  assert.equal(M.daysSinceLast([{ date: '2026-07-01', sessionId: 'a' }, { date: '2026-07-28', sessionId: 'b' }], today), 1);
}

// ── 教练提示分档 ──
{
  const today = D('2026-07-29');
  assert.equal(M.coachHint([], today, 3).kind, 'first_time');
  assert.equal(M.coachHint([{ date: '2026-07-29', sessionId: 'a' }], today, 3).kind, 'done_today');
  assert.equal(M.coachHint([{ date: '2026-07-10', sessionId: 'a' }], today, 3).kind, 'back_after_break', '≥7 天没来');
  assert.equal(M.coachHint([{ date: '2026-07-28', sessionId: 'a' }], today, 3).kind, 'on_track');
  const met = M.coachHint(
    [{ date: '2026-07-27', sessionId: 'a' }, { date: '2026-07-28', sessionId: 'b' }],
    today, 2,
  );
  assert.equal(met.kind, 'goal_met', '本周次数够了');
  assert.equal(met.left, 0);
}

// ── 第几周 ──
{
  assert.equal(M.weekIndex(null, D('2026-07-29')), 1, '没开始 = 第 1 周');
  assert.equal(M.weekIndex('2026-07-29T00:00:00', D('2026-07-29')), 1);
  assert.equal(M.weekIndex('2026-07-01T00:00:00', D('2026-07-29')), 5);
}

console.log('fitness-home-core: OK');
