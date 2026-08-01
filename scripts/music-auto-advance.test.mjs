/**
 * 行为契约:自动往下找一首能放的(2026-08-01,用户「网易歌现在不能自动切换源,
 * 我要一个个点。可以后台自动切换源,哪都没有,自动播放下一个」)。
 *
 * 这一层最要紧的一条是**风控时立刻停**。理由不是省请求:
 * 「这一首受限」→ 换一首有用;「整台被风控」→ 换一首一点用都没有,每首都取不到。
 * 不区分的话,风控时这个函数会替用户把整个列表刷一遍 —— 几十秒转圈、
 * 结果还是放不出来,而这一串请求本身会让风控更严。
 *
 * 第二要紧的是**跳过了几首要说**。默默换一首,用户会以为自己点错了歌。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const js = ts.transpileModule(read('lib/platform/music/auto-advance.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, console,
  Math, Number, Array, Object, String, Boolean, Promise, JSON,
});
const { findPlayable, autoAdvanceMessage } = mod.exports;

const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 按下标给结果的 probe;顺便记下真正问过哪几首。 */
function probeFrom(map, log = []) {
  return async (i) => { log.push(i); return map[i] || { kind: 'restricted' }; };
}

/* ══ ① 一路跳过受限的,放上第一首能放的 ═══════════════════════════════════ */
{
  const log = [];
  const r = await findPlayable(ORDER, 0, probeFrom({
    0: { kind: 'restricted' },
    1: { kind: 'restricted' },
    2: { kind: 'ok', url: 'https://x/2.mp3' },
  }, log));
  assert.equal(r.index, 2, '应当放第 2 首');
  assert.equal(r.url, 'https://x/2.mp3');
  assert.equal(r.stop, 'played');
  assert.equal(r.skipped, 2, '跳过几首要如实记 —— 界面据此说一句,不能默默换歌');
  assert.equal(log.join(','), '0,1,2', '放上之后就不该再往下问了');
}

/* ══ ② 风控:见一次就停,绝不把列表刷一遍 ═════════════════════════════════ */
{
  const log = [];
  const r = await findPlayable(ORDER, 0, probeFrom({
    0: { kind: 'restricted' },
    1: { kind: 'blocked' },
    2: { kind: 'ok', url: 'https://x/2.mp3' },   // 风控时这个「能放」是假的,永远走不到
  }, log));
  assert.equal(r.stop, 'blocked', '风控要单独报 —— 它意味着换歌没用');
  assert.equal(r.index, -1, '风控时不许放任何一首');
  assert.equal(log.join(','), '0,1', '见到 blocked 之后一首都不许再问');

  // 第一首就风控也一样
  const log2 = [];
  await findPlayable(ORDER, 0, probeFrom({ 0: { kind: 'blocked' } }, log2));
  assert.equal(log2.length, 1, '第一首就风控时只该发出一个请求');
}

/* ══ ③ 网络故障:抖一下继续,连着断就停 ═══════════════════════════════════ */
{
  // 抖一下(单次 failed)不算「这一首受限」,继续往下
  const log = [];
  const r = await findPlayable(ORDER, 0, probeFrom({
    0: { kind: 'failed' },
    1: { kind: 'ok', url: 'https://x/1.mp3' },
  }, log));
  assert.equal(r.index, 1, '偶发抖动不该让整件事停下来');
  assert.equal(r.skipped, 0, '网络故障不是「受限」,不许算进跳过数');

  // 连着两次 = 网真断了,停下来说「该重试」
  const log2 = [];
  const r2 = await findPlayable(ORDER, 0, probeFrom({
    0: { kind: 'failed' }, 1: { kind: 'failed' }, 2: { kind: 'ok', url: 'https://x/2.mp3' },
  }, log2));
  assert.equal(r2.stop, 'offline', '连着断要报 offline —— 这才是该给重试的那一种');
  assert.equal(log2.join(','), '0,1', '断了就别再刷了');

  // 中间成功过一次的话,计数要清零(不然一整趟里零星两次故障就误判成断网)
  const r3 = await findPlayable(ORDER, 0, probeFrom({
    0: { kind: 'failed' }, 1: { kind: 'restricted' }, 2: { kind: 'failed' },
    3: { kind: 'ok', url: 'https://x/3.mp3' },
  }));
  assert.equal(r3.index, 3, '不连着的两次故障不该被当成断网');

  // probe 自己抛异常 = 故障,不许把整件事炸掉
  const r4 = await findPlayable(ORDER, 0, async (i) => {
    if (i === 0) throw new Error('boom');
    return { kind: 'ok', url: 'https://x/1.mp3' };
  });
  assert.equal(r4.index, 1, 'probe 抛异常要当成一次故障,不许让整个自动续播崩掉');
}

/* ══ ④ 都不能放 = 用户说的「哪都没有」 ═══════════════════════════════════ */
{
  const r = await findPlayable([0, 1, 2], 0, probeFrom({}));
  assert.equal(r.stop, 'exhausted');
  assert.equal(r.index, -1);
  assert.equal(r.skipped, 3);

  // 空队列不许抛
  const empty = await findPlayable([], 0, probeFrom({}));
  assert.equal(empty.stop, 'exhausted');
  assert.equal(empty.index, -1);
}

/* ══ ⑤ 有上限:不许把一个长列表整个刷一遍 ═════════════════════════════════ */
{
  const long = Array.from({ length: 200 }, (_, i) => i);
  const log = [];
  const r = await findPlayable(long, 0, probeFrom({}, log));
  assert.equal(r.stop, 'exhausted');
  assert.ok(log.length <= 12, `默认最多试 12 首,实际发了 ${log.length} 个请求`);
  assert.ok(log.length >= 5, '上限也不该小到「基本没帮上忙」');

  const log2 = [];
  await findPlayable(long, 0, probeFrom({}, log2), { maxTries: 3 });
  assert.equal(log2.length, 3, 'maxTries 要真的生效');
}

/* ══ ⑥ 用户中途点了别的:立刻收手,绝不抢播 ═══════════════════════════════ */
{
  // 探到一半用户点了别的 —— 那一首**已经拿到的 url 也不许拿去播**
  let cancelled = false;
  const r = await findPlayable(ORDER, 0, async () => {
    cancelled = true;                       // 模拟:请求发出去期间用户点了别的歌
    return { kind: 'ok', url: 'https://x/0.mp3' };
  }, { isCancelled: () => cancelled });
  assert.equal(r.stop, 'cancelled', 'probe 回来时已经被取消了,这一首不能抢过去放');
  assert.equal(r.index, -1);
  assert.equal(r.url, '');

  // 一开始就取消:一个请求都不该发
  const log = [];
  const r2 = await findPlayable(ORDER, 0, probeFrom({}, log), { isCancelled: () => true });
  assert.equal(r2.stop, 'cancelled');
  assert.equal(log.length, 0, '已经取消了就别发请求');
}

/* ══ ⑦ 从中间开始 / 跟着随机队列走 ═══════════════════════════════════════ */
{
  const log = [];
  const r = await findPlayable(ORDER, 5, probeFrom({ 6: { kind: 'ok', url: 'u' } }, log));
  assert.equal(r.index, 6, '从第 5 位开始就该从那儿往下');
  assert.equal(log.join(','), '5,6', '不许从头开始重刷');

  // 随机播放时,「往下试」要走**洗过的那条队列**,不能突然按原顺序走
  const shuffled = [7, 3, 9, 1];
  const log2 = [];
  await findPlayable(shuffled, 0, probeFrom({ 9: { kind: 'ok', url: 'u' } }, log2));
  assert.equal(log2.join(','), '7,3,9',
    '自动往下试必须跟着当前队列的顺序 —— 否则随机播放下会突然按原顺序放');
}

/* ══ ⑧ 四种停法四句话,不许合并 ═══════════════════════════════════════════ */
{
  const say = (stop, skipped = 0) => autoAdvanceMessage({ index: -1, url: '', skipped, stop });

  // 风控那句里**不许**出现「这一首/这些歌受限」的说法 —— 那会让人一首一首试到放弃
  const blocked = say('blocked');
  assert.match(blocked, /跟具体哪一首没关系|换歌也一样/, '风控要说清「换歌没用」');
  assert.doesNotMatch(blocked, /换一首|再试一次|重试/, '风控时不许把用户指去换歌或重试');

  // 「哪都没有」那句要指出下一步(换个词/导本地),不许只说失败
  const exhausted = say('exhausted');
  assert.match(exhausted, /换个词|导进本地/, '都放不了时要给出口');
  assert.notEqual(exhausted, blocked, '「都受限」和「被风控」是两回事,不许说同一句话');

  // 网络断了那句才该提重试
  assert.match(say('offline'), /再点一次|网好了/, '断网这一种才是该重试的');

  // 放上了但跳过了几首 —— **必须说一句**,默默换歌会让用户以为自己点错了
  assert.match(autoAdvanceMessage({ index: 2, url: 'u', skipped: 3, stop: 'played' }), /跳过了 3 首/);
  assert.equal(autoAdvanceMessage({ index: 0, url: 'u', skipped: 0, stop: 'played' }), '',
    '一首都没跳过时不该没事找事说一句');
  assert.equal(autoAdvanceMessage({ index: -1, url: '', skipped: 0, stop: 'cancelled' }), '',
    '用户自己点了别的,什么都不用说');

  // 英文也得有(这个仓里动态文案漏翻是老坑)
  for (const stop of ['blocked', 'offline', 'exhausted']) {
    const en = autoAdvanceMessage({ index: -1, url: '', skipped: 0, stop }, 'en');
    assert.ok(en.length > 0 && !/[一-龥]/.test(en), `${stop} 的英文文案漏了或混着中文`);
  }
  const enPlayed = autoAdvanceMessage({ index: 1, url: 'u', skipped: 2, stop: 'played' }, 'en');
  assert.ok(!/[一-龥]/.test(enPlayed) && /Skipped 2/.test(enPlayed));
}

console.log('music-auto-advance: OK(跳受限往下试 / 风控立刻停 / 抖一下继续断了停 / 有上限 / 取消不抢播 / 跟着当前队列 / 四种停法四句话)');
