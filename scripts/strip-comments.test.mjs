/**
 * 行为契约:剥注释不许连代码一起剥(2026-07-29)。
 *
 * 这条测试守的是**测试自己**。16 条契约测试都先把源码剥掉注释再断言,
 * 而那个剥法有洞:字符串里的斜杠星号(accept 值 image 斜杠星号 这种)被当成注释起点,
 * 一路吃到下一个星号斜杠 —— NesioChatSheet.tsx 被一口气吞掉 10086 个字符。
 *
 * 这类 bug 的可怕之处是**方向**:剥多了 → 断言看不到那段代码 → 「没匹配到违规」→ 恒绿。
 * 一条永远绿的测试比没有测试更糟,因为它让人以为那里有人看着。
 *
 * 注:下面的用例一律用 charCode 拼装注释记号和引号。直接写字面量的话,
 * 这份测试自己就会被引号嵌套绊住(写第一版时连续绊了两次)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripComments } from './lib/strip-comments.mjs';

const Q = String.fromCharCode(39);
const BT = String.fromCharCode(96);
const OPEN = String.fromCharCode(47, 42);
const CLOSE = String.fromCharCode(42, 47);

// ── ① 真注释还是要剥掉 ──────────────────────────────────────────────────────
assert.equal(stripComments(OPEN + ' hi ' + CLOSE + 'const a = 1;').trim(), 'const a = 1;');
assert.equal(stripComments('  // line\nconst a = 1;').trim(), 'const a = 1;');
assert.equal(stripComments('{' + OPEN + ' jsx ' + CLOSE + '}\n<div/>').replace(/\s/g, ''), '{}<div/>');
assert.equal(stripComments(OPEN + '*\n * doc\n ' + CLOSE + '\nfoo()').trim(), 'foo()');

// ── ② 字符串里长得像注释的东西不许动 ────────────────────────────────────────
// 每一条都是真实出现过、或马上会出现的写法。
const CASES = [
  // ← 实际把 NesioChatSheet 吞掉 10086 字符的那一个
  ['inp.accept = ' + Q + 'image' + OPEN + Q + ';\nfetch(url);', 'fetch(url)'],
  ['const a = "' + CLOSE + '";\nconst b = 2;', 'const b = 2'],
  ['const t = ' + BT + 'image' + OPEN + BT + ';\nrun();', 'run()'],
  ['el.accept=' + Q + 'image' + OPEN + Q + '; post({imageBase64});', 'imageBase64'],
];
for (const [src, mustKeep] of CASES) {
  const out = stripComments(src);
  assert.ok(
    out.includes(mustKeep),
    '剥注释把代码也剥掉了 —— 断言会在一份看不见它的文本上跑(恒绿)。\n  输入:' + src + '\n  剩下:' + out,
  );
}

// ── ③ 拿真文件量一遍:剥掉的量不该离谱 ───────────────────────────────────────
// 单条用例可以被专门绕过,这条量的是**总体**:剥掉四分之一以上就说明又在吃代码了。
{
  const src = fs.readFileSync(new URL('../components/portal/NesioChatSheet.tsx', import.meta.url), 'utf8');
  const out = stripComments(src);
  const removedPct = (1 - out.length / src.length) * 100;
  assert.ok(
    removedPct < 25,
    '从 NesioChatSheet.tsx 剥掉了 ' + removedPct.toFixed(1) + '% —— 注释没那么多,是又把代码吃进去了',
  );
  assert.equal(
    (out.match(/imageBase64:/g) || []).length,
    (src.match(/imageBase64:/g) || []).length,
    '剥注释后发图的调用点少了 —— 正是这个漏洞让「四处传图都要先缩」那条断言差点数错',
  );
}

// ── ④ 所有契约测试都得用这一份,不许再各自复制那行有洞的正则 ─────────────────
{
  const dir = new URL('.', import.meta.url);
  const BAD = 'replace(/\\' + OPEN + '[\\s\\S]*?\\' + CLOSE + '/g';
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.mjs') || f === 'strip-comments.test.mjs') continue;
    if (fs.readFileSync(new URL(f, dir), 'utf8').includes(BAD)) offenders.push(f);
  }
  assert.equal(
    offenders.length, 0,
    '这些脚本还在用那行会吃掉代码的剥注释正则,改成 import { stripComments } from ./lib/strip-comments.mjs :\n  '
    + offenders.join('\n  '),
  );
}

console.log('strip-comments: OK(剥注释 · 不吃字符串 · 真文件量得住 · 全仓统一)');
