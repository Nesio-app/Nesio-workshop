/**
 * 行为契约:「没接上的线头」的判据(2026-07-30 抽成单一事实源)。
 *
 * 为什么值得单独一条:这段判据现在有**两个消费者**——洞察页那段「几个没接上的线头」,
 * 和每日日报里的「还没接上:X」(我对用户问的「未来机会」的答复:Nesio 唯一有依据说
 * 「机会」的,是你自己说过想做、却一直没动的事)。
 * 两处各写一遍必然漂移:一边改了阈值另一边没改,洞察说 3 条、日报说 5 条,
 * 而两边都言之凿凿 —— 用户没法知道该信哪个。
 *
 * 判据本身钉四条,每一条都是「**为什么它不算线头**」:
 *   ① 人 / 地方 / 健康状态是**实体**,不是待办 —— 一个人不会「没接上」;
 *   ② 标了 done 的做完了;
 *   ③ **后来又回来碰过的**不算落下(lastConfirmedAt ≠ createdAt);
 *   ④ 放得还不够久的不算(THREAD_STALE_DAYS)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

const { isLooseThread, looseThreads, THREAD_STALE_DAYS } = loadTs('lib/portal/loose-threads.ts');

const NOW = new Date(2026, 6, 30, 12).getTime();
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

/* ── ① 够久没碰的待办 = 线头 ─────────────────────────────────────── */
{
  assert.equal(isLooseThread({ type: 'task', createdAt: ago(40) }, NOW), true);
  assert.equal(isLooseThread({ type: 'event', createdAt: ago(THREAD_STALE_DAYS + 1) }, NOW), true,
    `刚过 ${THREAD_STALE_DAYS} 天就算`);
  assert.equal(isLooseThread({ type: 'task', createdAt: ago(THREAD_STALE_DAYS - 1) }, NOW), false,
    '还没到阈值的不算 —— 上周刚记的事被说成「没接上」会让人莫名其妙');
}

/* ── ② 实体不是待办 ─────────────────────────────────────────────── */
{
  for (const t of ['person', 'place', 'Mind']) {
    assert.equal(isLooseThread({ type: t, createdAt: ago(400) }, NOW), false,
      `${t} 是**实体**不是待办 —— 一个人、一个地方不存在「没接上」。` +
      '把认识很久的人列成「你落下的事」是很冒犯的');
  }
}

/* ── ③ 做完的 / 后来又碰过的,都不算落下 ──────────────────────────── */
{
  assert.equal(isLooseThread({ type: 'task', createdAt: ago(40), attributes: { done: true } }, NOW), false,
    '做完了');
  assert.equal(
    isLooseThread({ type: 'task', createdAt: ago(40), lastConfirmedAt: ago(2) }, NOW), false,
    '后来又回来看过/改过 → 不是落下的。只看 createdAt 的话,一件你天天在推进的长期事项' +
    '会因为「建得早」被说成没接上',
  );
  assert.equal(
    isLooseThread({ type: 'task', createdAt: ago(40), lastConfirmedAt: ago(40) }, NOW), true,
    'lastConfirmedAt 等于 createdAt = 建完就没再动过,那还是线头',
  );
}

/* ── ④ 脏数据不许崩,也不许凭空算成线头 ─────────────────────────── */
{
  assert.equal(isLooseThread({ type: 'task' }, NOW), false, '没有 createdAt → 不下判断');
  assert.equal(isLooseThread({ type: 'task', createdAt: '不是日期' }, NOW), false, '解析不出来 → 不下判断');
  assert.equal(isLooseThread(null, NOW), false, 'null 不崩');
}

/* ── ⑤ 最老的排最前 ─────────────────────────────────────────────── */
{
  const out = looseThreads([
    { type: 'task', createdAt: ago(35), name: '较近' },
    { type: 'task', createdAt: ago(200), name: '最老' },
    { type: 'person', createdAt: ago(300), name: '人(不算)' },
  ], NOW);
  assert.equal(out.map((n) => n.name).join(','), '最老,较近',
    '放得最久的那条最该先被看见');
}

/* ── ⑥ 单一事实源:两个消费者用的是同一份 ───────────────────────── */
{
  const insights = strip(read('components/portal/InsightsSheet.tsx'));
  const sources = strip(read('lib/portal/daily-report-sources.ts'));
  assert.match(insights, /looseThreads\(/, '洞察页用这一份');
  assert.match(sources, /looseThreads\(/, '日报也用这一份');
  assert.doesNotMatch(insights, /lastConfirmedAt !== n\.createdAt/,
    '洞察页不许再内联一份判据 —— 两处各写一遍必然漂移,' +
    '一边改了阈值另一边没改,洞察说 3 条、日报说 5 条,而两边都言之凿凿');
}

console.log('loose-threads: OK(够久才算 / 实体不算 / 碰过不算 / 脏数据不崩 / 最老在前 / 单一事实源)');
