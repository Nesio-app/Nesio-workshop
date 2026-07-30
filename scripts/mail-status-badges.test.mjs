/**
 * 行为契约:邮件行上的「状态」与「右下角标签」(2026-07-30 用户要求)。
 *
 *   「识别我的在途订单状态,付款,退款,显到货时间。如果是银行的显示 payment、收款、扣款状态」
 *   「可以在每一个右下角显示一下标签,订单,账单,预约,私人,有附件等等」
 *
 * 这类「从文本里认东西」的功能,在这个仓库里翻车过不止一次(「健身」被认成健康打卡、
 * 摇椅盖毯长出假「明天」)。病根都是同一个:**没有正向判据,凡是没被拦住的都算数**。
 * 所以这条契约钉的不是某个词表,而是几条不许越过的线:
 *
 *   ① 认不出来就**什么都不给** —— 没有「其它 / 未知」兜底标签,没有兜底状态;
 *   ② 状态词只在**主题 + 正文开头**里找 —— 页脚的退款政策不许决定这封信的状态;
 *   ③ 中文分支必须真的能匹配 —— JS 的 \b 是「\w 与非 \w 的交界」,汉字本身是非 \w,
 *      把中文写进 \b(...)\b 里会让整条中文分支**永远匹配不上**(踩过);
 *   ④ 同一封的状态要取**更终态**的那条(退款优先于发货);
 *   ⑤ 路由的两条出节点路径(AI 富化 / 元数据兜底)都要写这些字段 ——
 *      上一次「方向」字段只写在兜底里,付费用户的发件箱因此空了很久。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const src = read(rel);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    // i18n 只用到 L(纯函数),照着实现给个哑的,免得把整条 profile 链拖进来。
    require: (id) => (String(id).includes('i18n')
      ? { L: (locale, zh, en) => (locale === 'en' ? en : zh) }
      : {}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

const { extractEmailLocal } = loadTs('lib/portal/email-extract-local.ts');
const { mailStatusLine, mailBadges } = loadTs('lib/portal/mail-badges.ts');

/* ── ① 认不出来就什么都不给(最重要的一条)────────────────────────────── */
{
  const plain = extractEmailLocal(
    'Re: 周末那家店',
    '"Janice" <janice@example.com>',
    '我下午三点大概到,你先点吧。',
  );
  assert.equal(plain.orderStatus, undefined, '没有任何订单词,不许猜出一个状态');
  assert.equal(plain.moneyFlow, undefined, '没有任何资金词,不许猜出一个方向');
  assert.equal(plain.kindHint, undefined,
    '认不出类型时必须是 undefined —— 不许有「其它/未知/私人」兜底。' +
    '「凡是没被认出来的都算某某」正是这个仓库反复踩的坑');

  assert.equal(mailStatusLine({}, 'zh'), null, '没字段就不画状态行');
  assert.equal(mailBadges({}, 'zh').length, 0, '没字段就一个标签都不画');
  assert.equal(mailBadges({ kindHint: 'whatever-新类型' }, 'zh').length, 0,
    '不认识的 kindHint 要当没有 —— 不许把原始值当标签印出去');
}

/* ── ② 状态词只看主题 + 正文开头,页脚不算 ──────────────────────────── */
{
  // 正文开头是真状态,600 字之后是每封信都有的条款页脚 —— 里面同样带着状态词。
  const footer = `商品已经从仓库发出。${'感谢您的惠顾。'.repeat(200)}若订单已取消,款项将原路退回。`;
  assert.ok(footer.length > 900, '这条 case 得让页脚落在扫描窗口之外才有意义');
  const r = extractEmailLocal('您的订单已发货', 'ship@shop.example.com', footer);
  assert.equal(r.orderStatus, 'shipped',
    '页脚里的条款(「若订单已取消…」)不许改写这封信的状态 —— ' +
    '状态只在主题 + 正文开头那段里找。在全文里搜等于让页脚说了算');
}

/* ── ③ 中文分支必须真的能匹配(\b 陷阱)──────────────────────────────── */
{
  // 每一条都是「中文写在主题最前面」——正是 \b 会把它废掉的位置。
  const cases = [
    ['预约成功:8 月 3 日 10:00 复诊', 'booking'],
    ['您的订单已发货', 'order'],
    ['信用卡账单已出账', 'bill'],
  ];
  for (const [subject, kind] of cases) {
    const r = extractEmailLocal(subject, 'x@example.com', '');
    assert.equal(r.kindHint, kind,
      `「${subject}」应当认成 ${kind}。中文分支若被写进 \\b(...)\\b 里会永远匹配不上 ——` +
      'JS 的 \\b 要求一侧是 \\w,而汉字是非 \\w');
  }
}

/* ── ④ 同时命中时取更终态的那条 ────────────────────────────────────── */
{
  const r = extractEmailLocal('您的退款已处理(原订单已发货)', 'shop@example.com', '');
  assert.equal(r.orderStatus, 'refunded', '退款比发货更终态 —— 用户先想知道的是这笔最后怎么了');
  assert.equal(r.moneyFlow, 'refund');
}

/* ── ⑤ 银行邮件认得出资金方向,并且方向不乱窜 ────────────────────────── */
{
  const charged = extractEmailLocal('Payment posted: $42.10', 'alerts@bank.example.com', '');
  assert.ok(charged.moneyFlow, '银行的「Payment posted」必须认得出资金方向(用户点名要的)');
  const due = extractEmailLocal('Your statement is ready — minimum payment due', 'alerts@bank.example.com', '');
  assert.equal(due.moneyFlow, 'due');
  assert.equal(due.kindHint, 'bill', '账单邮件的标签是账单,不是订单');
}

/* ── ⑥ 展示层:状态行只在有状态时出现,标签最多类型 + 附件 ──────────── */
{
  const line = mailStatusLine({ orderStatus: 'shipped', eta: 'Aug 3', amount: '$42.10' }, 'zh');
  assert.ok(line && line.text.includes('已发货'), '状态词要显示');
  assert.ok(line.text.includes('Aug 3'), '到货时间要显示(用户点名要的「显到货时间」)');

  // 到货时间只属于订单 —— 银行邮件里的日期是账单日,不是「预计送达」。
  const bank = mailStatusLine({ moneyFlow: 'charged', eta: 'Aug 3' }, 'zh');
  assert.ok(bank && !bank.text.includes('Aug 3'), '银行邮件不许把账单日说成「预计到货」');

  const b = mailBadges({ kindHint: 'order', hasAttachment: true }, 'zh');
  assert.equal(b.map((x) => x.label).join(','), '订单,有附件');
  assert.equal(mailBadges({ hasAttachment: true }, 'zh').map((x) => x.label).join(','), '有附件',
    '认不出类型时只剩附件那个,不补一个类型标签');
}

/* ── ⑦ 路由:两条出节点路径都要写这些字段 ──────────────────────────── */
{
  const route = read('app/api/portal/gmail/route.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = route.match(/localAttrs\(/g) || [];
  assert.ok(
    calls.length >= 3,   // 1 次定义 + AI 路径 1 次 + 兜底路径 1 次
    'AI 富化路径和元数据兜底路径**都**要写订单状态/类型/附件这些字段。' +
    '此前「方向」字段只写在兜底里,AI 正常出结果时就丢了 —— 付费用户的发件箱因此空了很久。' +
    '同一件事不许再写两遍、也不许只写一处',
  );
  const attStart = route.indexOf('function hasAttachment');
  assert.ok(attStart > 0, '附件判定要在路由里做(只有 format=full 才拿得到 parts)');
  // 只看这个函数**自己的**函数体 —— 别让类型声明里的 attachmentId 冒充成判据(踩过)。
  const attBody = route.slice(attStart, route.indexOf('\n}\n', attStart));
  assert.match(
    attBody, /attachmentId/,
    '附件必须要求 body.attachmentId —— 光看 filename 会把签名档里的内嵌 logo 也算成附件,' +
    '几乎每封营销邮件都会挂上「有附件」,这个标签就废了',
  );
  assert.match(attBody, /inline/i, '带 Content-Disposition: inline 的内嵌图不算附件');
}

console.log('mail-status-badges: OK(认不出就不给 / 窗口限定 / 中文能匹配 / 取终态 / 两条路径都写)');
