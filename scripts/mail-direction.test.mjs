/**
 * 行为契约:「我写给别人的」和「我要读的」分得清(2026-08-01,用户第三次指同两封)。
 *
 * 这个判据错过两次,而且每次都是**同一封信**把它打回来的 ——
 * 「Your Day Ahead」每日简报,发给 hanbing6228@gmail.com,也就是他自己:
 *
 *   ① 只看 SENT 标签 → 自寄信全被归进发件箱;
 *   ② SENT ∧ ¬INBOX → 挡得住还躺在收件箱里的自寄信,但**归档之后 INBOX 就没了**,
 *      而简报这种东西几乎必然会被归档,于是这条漏得很稳定;
 *   ③ (现在)看收件人里除了我自己还有没有别人。
 *
 * 还有一半错在别处:判据只改了同步侧。Gmail 同步是**增量**的(after:),
 * 老邮件不会被重新拉一遍 —— 于是「判据改对了、用户那两封纹丝不动」。
 * 所以读取侧也得能自己纠正,而两边必须是同一份判据。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, String, RegExp, Array, Object });
  return mod.exports;
}

const { mailDirectionOf, emailAddrOf } = loadTs('lib/portal/mail-direction.ts');
const ME = 'Han Bing <hanbing6228@gmail.com>';

/* ══ ① 地址抠取 ═══════════════════════════════════════════════════════════ */
{
  assert.equal(emailAddrOf('Han Bing <hanbing6228@gmail.com>'), 'hanbing6228@gmail.com');
  assert.equal(emailAddrOf('hanbing6228@gmail.com'), 'hanbing6228@gmail.com');
  assert.equal(emailAddrOf('HanBing6228@GMAIL.com'), 'hanbing6228@gmail.com', '大小写要归一,否则自己认不出自己');
  assert.equal(emailAddrOf(''), '');
  assert.equal(emailAddrOf('没有地址'), '');
}

/* ══ ② 用户那两封:自己发给自己、而且**已归档**(没有 INBOX)═══════════════ */
{
  // 这一条就是被打回两次的那个 case。上一版判据(SENT ∧ ¬INBOX)在这里判 sent。
  const d = mailDirectionOf({
    labels: ['SENT'],                 // 归档了 → 没有 INBOX
    from: ME,
    to: 'hanbing6228@gmail.com',
  });
  assert.equal(d, 'received',
    '自己发给自己、读完归档的信被归进了发件箱 —— 用户对它的认知是「我要读的东西」,' +
    '不是「我写的东西」。SENT ∧ ¬INBOX 挡不住这一类,因为归档就是去掉 INBOX');

  // 还躺在收件箱里的自寄信(上一版判据能挡住的那种)照旧
  assert.equal(mailDirectionOf({ labels: ['SENT', 'INBOX'], from: ME, to: 'hanbing6228@gmail.com' }), 'received');
}

/* ══ ③ 真发给别人的,仍然是发件 ═══════════════════════════════════════════ */
{
  assert.equal(mailDirectionOf({ labels: ['SENT'], from: ME, to: 'someone@else.com' }), 'sent');
  // 抄送自己一份不改变性质 —— 收件人里有别人就是发出去的
  assert.equal(mailDirectionOf({ labels: ['SENT'], from: ME, to: 'someone@else.com', cc: 'hanbing6228@gmail.com' }), 'sent');
  // 反过来:主收件人写自己、真正要看的人在抄送里(转发自己一份的常见写法)。
  // **cc 必须参与判断** —— 只看 to 的话这封会被判成自寄信,埋进收件箱里再也找不着。
  assert.equal(mailDirectionOf({ labels: ['SENT'], from: ME, to: 'hanbing6228@gmail.com', cc: 'someone@else.com' }), 'sent',
    'cc 里有别人 = 这封是发出去的;只看 to 会把它误判成写给自己看的');
  // 多个收件人,只要有一个不是自己
  assert.equal(mailDirectionOf({ labels: ['SENT'], from: ME, to: 'hanbing6228@gmail.com, a@b.com' }), 'sent');
  // 全是自己(to + cc)→ 还是写给自己看的
  assert.equal(mailDirectionOf({ labels: ['SENT'], from: ME, to: 'hanbing6228@gmail.com', cc: 'HanBing6228@gmail.com' }), 'received');
}

/* ══ ④ 收到的信不受影响 ═══════════════════════════════════════════════════ */
{
  assert.equal(mailDirectionOf({ labels: ['INBOX'], from: 'bank@chase.com', to: 'hanbing6228@gmail.com' }), 'received');
  assert.equal(mailDirectionOf({ labels: [], from: 'bank@chase.com', to: 'hanbing6228@gmail.com', storedDirection: 'received' }), 'received');
}

/* ══ ⑤ 收件人不明时**不猜** ═══════════════════════════════════════════════ */
{
  // metadata 模式没请求 To 头 / 头本身缺失 → 退回上一版判据,不凭空断言自寄信
  assert.equal(mailDirectionOf({ labels: ['SENT'], from: ME }), 'sent',
    '不知道收件人是谁时,不该断言它是自寄信 —— 那会把真发出去的信也吞进收件箱');
  assert.equal(mailDirectionOf({ labels: ['SENT', 'INBOX'], from: ME }), 'received');
  // From 也没有 → 同样退回
  assert.equal(mailDirectionOf({ labels: ['SENT'], to: 'a@b.com' }), 'sent');
}

/* ══ ⑥ 读取侧:没有标签可看,靠 from/to 纠正同步时写死的方向 ═════════════════ */
{
  // 用户那两封在节点上的样子:mailDirection='sent'(老判据写的)+ from/to 都是自己
  assert.equal(mailDirectionOf({
    from: ME, to: 'hanbing6228@gmail.com', storedDirection: 'sent',
  }), 'received',
    '读取侧必须能推翻同步时写死的方向 —— Gmail 同步是增量的,老邮件永远不会被重新拉一遍,' +
    '只改同步侧的话用户那两封会一直挂在发件箱里');

  // 真发给别人的老节点不许被误伤
  assert.equal(mailDirectionOf({ from: ME, to: 'someone@else.com', storedDirection: 'sent' }), 'sent');
  // 同步时判 received 的,读取侧不去翻案(错的方向只有「本该收件却写成 sent」这一个方向)
  assert.equal(mailDirectionOf({ from: ME, to: 'someone@else.com', storedDirection: 'received' }), 'received');
  // 老节点没有 to(旧版只在 sent 时存 to)→ 没有新证据,不推翻
  assert.equal(mailDirectionOf({ from: ME, storedDirection: 'sent' }), 'sent');
}

/* ══ ⑦ 两处调用点都真的用了这一份 ═════════════════════════════════════════ */
{
  const route = stripComments(read('app/api/portal/gmail/route.ts'));
  assert.match(route, /mailDirectionOf\(\{/, '同步侧要调共享判据');
  // To/Cc 得真的请求下来,否则判据在 metadata 模式下永远走「不明」分支
  assert.match(route, /metadataHeaders=To/, 'metadata 模式必须请求 To —— 不然判据拿不到收件人');
  assert.match(route, /metadataHeaders=Cc/, 'Cc 同理(抄送自己一份的情况)');
  // 不许在这儿再写一份判据
  assert.doesNotMatch(route, /labels\.includes\('SENT'\) && !labels\.includes\('INBOX'\)/,
    '同步侧不许保留自己那份旧判据 —— 两份判据必然漂移,这条已经演过一遍');

  const panel = stripComments(read('components/portal/insights/SchedulePanel.tsx'));
  assert.match(panel, /mailDirectionOf\(\{/, '读取侧也要调共享判据');
  assert.doesNotMatch(panel, /mailDirection === 'sent'/,
    '读取侧不许只读 mailDirection 字段 —— 那是同步当时按当时判据写死的,不会重算');
  assert.match(panel, /storedDirection:/, '读取侧要把同步时记的方向传进去当兜底');
}

console.log('mail-direction: OK(归档的自寄信归收件 / 抄送自己不改性质 / 收件人不明不猜 / 读取侧能纠正历史数据 / 判据只有一份)');
