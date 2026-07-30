/**
 * 行为契约:邮件标签分错了,我自己改(2026-07-30 用户:
 * 「邮件里,某个 tag 分错了,我怎么改,系统会学习到么?」)。
 *
 * 这条契约钉的核心是**「学习」的边界**:
 *
 *   ① **人工修正硬压过自动判定**。用户亲手改过的那一封,不管发件人规则怎么写、
 *      自动判定多有把握,都以他改的为准。反过来写就是「我知道你说了什么,但我觉得我更对」。
 *   ② **不许隐式泛化**。改一封 Chase 的,不能自动把所有 Chase 都改掉 ——
 *      那样改一次会有几十封信悄悄变样,而用户不知道发生了什么、也不知道去哪儿撤销。
 *      要推广必须他自己勾(alsoSender),而且默认不勾。
 *      这和「把邮件标题里的『健身』猜成健康打卡」是同一类错:系统替他做了个他没同意的推广。
 *   ③ 「去掉标签」('none')和「没改过」(undefined)是**两件事**。
 *      分不清的话,用户说「这封别贴标签」会在下次渲染时被自动判定重新贴回去。
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
    module: mod, exports: mod.exports, console,
    require: (id) => (String(id).includes('idb-blob-store')
      ? { createBlobStore: () => ({ load: () => null, save: () => {}, ready: () => Promise.resolve() }) }
      : {}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

const { resolveMailKind, senderKeyOf } = loadTs('lib/portal/mail-tag-fix.ts');

const FROM = '"Chase" <alerts@chase.com>';
const none = { byEmail: {}, bySender: {} };

/* ── ① 人工修正硬压过自动判定 ─────────────────────────────────────── */
{
  assert.equal(resolveMailKind('bill', 'e1', FROM, none), 'bill', '没人改过 → 用自动判定');

  const fixed = { byEmail: { e1: 'personal' }, bySender: {} };
  assert.equal(resolveMailKind('bill', 'e1', FROM, fixed), 'personal',
    '用户亲手改过这一封 → 以他改的为准。自动判定再有把握也得让路 —— ' +
    '反过来就是「我知道你说了什么,但我觉得我更对」');

  // 这一封 > 发件人规则(哪怕规则和自动判定都说是别的)
  const both = { byEmail: { e1: 'booking' }, bySender: { 'alerts@chase.com': 'bill' } };
  assert.equal(resolveMailKind('order', 'e1', FROM, both), 'booking',
    '优先级必须是硬的:这一封 > 发件人规则 > 自动判定');
}

/* ── ② 发件人规则只在**他勾了**之后才存在 ─────────────────────────── */
{
  const src = strip(read('lib/portal/mail-tag-fix.ts'));
  assert.match(src, /alsoSender\?: boolean/, '推广到发件人是一个显式参数');
  assert.match(src, /if \(opts\.alsoSender\)/,
    '只有显式传了才写发件人规则 —— 不许「改了一封就把整个发件人都改了」');
  assert.match(src, /export function removeSenderRule/,
    '勾过的规则要能删 —— 一个撤不掉的「学习」比不学习更糟');

  const panel = strip(read('components/portal/insights/SchedulePanel.tsx'));
  // 切到 MailTagFixSheet **函数体内**再断言 —— 整份文件里 useState(false) 有一大把,
  // 在全文上 match 的话把这一处改成 true 也照样通过。(第一版就是这么写的,注入时没红。)
  const sheetStart = panel.indexOf('function MailTagFixSheet');
  assert.ok(sheetStart > 0, '要有这个修正面板');
  const sheet = panel.slice(sheetStart, panel.indexOf('\n}\n', sheetStart));
  assert.match(sheet, /const \[alsoSender, setAlsoSender\] = useState\(false\)/,
    '「以后这个发件人都这样」**默认不勾** —— 默认勾上就等于隐式泛化,' +
    '只是把责任推给了「他没取消」');
  assert.match(sheet, /fixMailTag\(emailId, k, \{ from, alsoSender \}\)/,
    '推广与否照用户当时勾的那个值,不许写死 true');

  // 规则生效时确实管用(别把不隐式泛化做成「压根没有发件人规则」)
  const rule = { byEmail: {}, bySender: { 'alerts@chase.com': 'bill' } };
  assert.equal(resolveMailKind('order', 'e9', FROM, rule), 'bill', '勾过之后,同发件人的其它邮件才跟着变');
  assert.equal(resolveMailKind('order', 'e9', '<x@other.com>', rule), 'order', '别的发件人不受影响');
}

/* ── ③ 「去掉标签」和「没改过」是两件事 ───────────────────────────── */
{
  assert.equal(resolveMailKind('bill', 'e2', FROM, { byEmail: { e2: 'none' }, bySender: {} }), null,
    "用户说「这封别贴标签」→ 就是不贴。把 'none' 当成「没改过」的话," +
    '他的这个决定会在下次渲染时被自动判定重新贴回去');
  assert.equal(resolveMailKind('bill', 'e3', FROM, none), 'bill', '(而没改过的那封照旧自动判定)');
  assert.equal(resolveMailKind(undefined, 'e4', FROM, none), null, '自动判定没给也就没有标签');
  assert.equal(resolveMailKind('乱七八糟', 'e5', FROM, none), null, '不认识的值当没有,不原样印出去');
}

/* ── ④ 发件人键:从 From 头抠地址,大小写归一 ─────────────────────── */
{
  assert.equal(senderKeyOf('"Chase" <Alerts@Chase.com>'), 'alerts@chase.com');
  assert.equal(senderKeyOf('plain@example.com'), 'plain@example.com');
  assert.equal(senderKeyOf(''), '', '抠不出来就返回空 —— 空键不许当规则用(见 fixMailTag)');
}

/* ── ⑤ 「有附件」不是判断,改不了 ─────────────────────────────────── */
{
  const panel = strip(read('components/portal/insights/SchedulePanel.tsx'));
  assert.match(panel, /b\.id !== 'attachment'/,
    '「有附件」是**事实**不是判断 —— 给它做成可改的,等于承诺一个改不了的东西');
}

/* ── ⑤' 改错了要能改回去 ──────────────────────────────────────────
   自查发现的缺口:clearMailTagFix / removeSenderRule 两个函数**写好了零调用方** ——
   也就是说用户改错一个标签之后**回不到自动判定**,他只能再改成别的,
   没法说「算了,还是听系统的」。这正是我在这一轮里批评过的那种病
   (daily-brief 那条 180 行的死路由)。 */
{
  const panel = strip(read('components/portal/insights/SchedulePanel.tsx'));
  assert.match(panel, /clearMailTagFix\(emailId\)/, '要能撤销这一封的修正');
  assert.match(panel, /removeSenderRule\(sender\)/, '勾过的发件人规则要能删');

  // **两条路分开给** —— 合成一个按钮会说谎:清掉这一封的修正之后,如果发件人规则还在,
  // 标签照样被规则改着,而按钮上写着「恢复自动判定」。
  assert.match(panel, /const hasMine = Boolean\(emailId && fixes\.byEmail\[emailId\]\)/,
    '「这一封改过没」和「发件人规则有没有」是两个独立判断');
  assert.match(panel, /const hasRule = Boolean\(sender && fixes\.bySender\[sender\]\)/);
  assert.match(panel, /\{\(hasMine \|\| hasRule\) && \(/,
    '**改过之后才给这两个按钮** —— 没改过时点它什么都不会变,那就是个假按钮');
}

/* ── ⑥ 存储类别 ──────────────────────────────────────────────────── */
{
  assert.match(read('scripts/storage-key-registry.test.mjs'), /\["nesio-mail-tag-fix-v1", "durable"\]/,
    '这是用户的判断,不是算出来的缓存 —— 换台设备从头开始 = 他纠正过的又全错回去');
}

console.log('mail-tag-fix: OK(人工压过自动 / 不隐式泛化 / 去掉≠没改过 / 附件不可改)');
