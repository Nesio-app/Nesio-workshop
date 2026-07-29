/**
 * 行为契约:2026-07-29「今天/记忆/设置逐按钮深挖」那批 QA 的防回退锁。
 *
 * 这批里真正值得锁的,是**在桌面浏览器上测不出来、或者只在特定账号状态下才现形**的几条 ——
 * 它们回退了也不会有人立刻发现:
 *
 *   ① 藏起来的 <input type="file"> 不能用 display:none。iOS 的 WKWebView 对不参与布局的
 *      input 会**静默忽略**程序化 click(),桌面 Chrome 照开 —— 于是「点『+』没反应」
 *      这类 bug 只在手机上出现,本地怎么点都是好的。全仓 11 处曾经都这么写。
 *   ② file input 的 click() 必须在用户手势的调用栈里。放进 setTimeout 就废了(同上,只坏在 iOS)。
 *   ③ 板块深链要带自增号。只传 tab 名的话,**同一个深链点第二次** state 值没变、effect 不跑,
 *      那一行就成了死链 —— 而旁边别的行是好的,看起来像「只有这一个按钮坏了」。
 *   ④ 同一件事全站只能有一个数:记忆总数、登录态文案、会员状态。用户会同屏对照。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── ① 藏起来的 file input 一律不许 display:none ───────────────────────────────
{
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(e.name)) continue;
      const src = code(read(rel));
      for (const m of src.matchAll(/<input\b[^>]*?\/?>/gs)) {
        const tag = m[0];
        if (!/type="file"/.test(tag)) continue;
        // `hidden` 属性 = display:none;`.nesio-hidden` 同理(globals.css 里就是 display:none)
        if (/\shidden(\s|\/|>)/.test(tag) || /className="[^"]*\bnesio-hidden\b/.test(tag)) {
          offenders.push(`${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
  };
  walk('components');
  assert.equal(
    offenders.length, 0,
    'file input 用了 display:none(hidden / .nesio-hidden)—— iOS 的 WKWebView 会忽略它的 click(),\n'
    + '表现是「点上传按钮完全没反应」,而桌面浏览器一切正常。改用 .nesio-visually-hidden:\n  '
    + offenders.join('\n  '),
  );
  // 那个替代类必须真的还占布局(不能哪天被人改成 display:none 了事)
  const css = read('app/globals.css');
  const vh = css.slice(css.indexOf('.nesio-visually-hidden'), css.indexOf('.nesio-visually-hidden') + 400);
  assert.ok(vh.includes('position: absolute'), '.nesio-visually-hidden 不再是「占位但看不见」了');
  assert.ok(!/display:\s*none/.test(vh), '.nesio-visually-hidden 变成 display:none 了 —— 那和 hidden 一样坏');
}

// ── ② 选头像必须在这次点击里就把选择器打开 ────────────────────────────────────
{
  const card = code(read('components/portal/NesioProfileCard.tsx'));
  const pick = /onPickAvatar=\{([\s\S]{0,200}?)\}\s*\/>/.exec(card)?.[1] || '';
  assert.ok(pick.includes('avatarInputRef.current?.click()'), `onPickAvatar 不再打开头像选择器了(读到:${pick.slice(0,80)})`);
  assert.ok(
    !/setTimeout/.test(pick),
    '「更换头像」又把 click() 放进 setTimeout 了 —— 脱离用户手势栈后 iOS 直接忽略,\n'
    + '用户看到的是「账户弹窗被关掉、什么也没发生」(原始报告第 4 条)',
  );
  assert.ok(
    !/setActiveSheet\(null\)/.test(pick),
    '点「更换头像」就把账户页关了 —— 取消选图之后页面凭空消失。关页要等真选到了文件再做',
  );
}

// ── ③ 板块深链带自增号,同一个入口点第二次也要生效 ────────────────────────────
{
  const portal = code(read('components/portal/Portal.tsx'));
  // 用 assert.ok:整份 Portal.tsx 一万多行,assert.match 失败会把全文打进报错里。
  assert.ok(/setInsightsNonce\(\(n\) => n \+ 1\)/.test(portal), '洞察深链没有自增号 —— 同一个板块点第二次会变成死链');
  assert.ok(/<InsightsSheet[\s\S]{0,300}?tabNonce=\{insightsNonce\}/.test(portal), 'InsightsSheet 没收到自增号');
  const sheet = code(read('components/portal/InsightsSheet.tsx'));
  assert.ok(
    /\}, \[initialTab, tabNonce\]\)/.test(sheet),
    '深链 effect 的依赖里少了 tabNonce —— 同一个 tab 连点第二次 state 没变,effect 不跑',
  );
}

// ── ④ 同一件事全站一个数 / 一种说法 ──────────────────────────────────────────
{
  // 记忆总数:记忆页和隐私页必须用同一个判据(用户会同屏对照,差一条就穿帮)
  const vis = code(read('lib/portal/memory-visibility.ts'));
  assert.ok(/export function visibleMemoryNodes/.test(vis), '记忆可见性判据没有收口');
  for (const f of ['components/portal/MemoryTab.tsx', 'components/portal/SettingsSheets.tsx']) {
    assert.ok(/visibleMemoryNodes\(/.test(code(read(f))), `${f} 没有用统一的记忆计数口径 —— 两处会报出两个总数`);
  }
  assert.ok(
    !/setNodeCount\(getLifeGraph\(\)\.length\)/.test(code(read('components/portal/SettingsSheets.tsx'))),
    '隐私页又直接数 getLifeGraph().length 了 —— 那会把记忆页滤掉的环境信号算进去',
  );

  const settings = code(read('components/portal/SettingsSheets.tsx'));
  // 登录态:那句「数据在哪」的说明必须跟着真实登录态走,不能写死
  const tipAt = settings.indexOf('你的数据在哪里');
  assert.ok(tipAt > 0, '隐私页的「你的数据在哪里」不见了');
  const tip = settings.slice(tipAt, tipAt + 900);
  assert.ok(
    /InfoTip text=\{signedIn/.test(tip),
    '「你的数据在哪里」又写死成「未登录…登录后才开启云同步」了 —— 而它旁边那格写着「已登录 · 云同步已开」,同屏打架',
  );

  // 会员页:pro 必须管住整张状态卡,不能只管那枚徽章
  const subAt = settings.indexOf('const pro = isPaidPro');
  assert.ok(subAt > 0, '会员页的 pro 判定不见了');
  const card = settings.slice(subAt, subAt + 1400);
  assert.ok(/nesio-sub-status-title">[\s\S]{0,80}\{pro/.test(card),
    '会员页标题没有跟着 pro 走 —— 已付费的账号会同屏看到「你已是 Pro」和「试用结束自动回到免费版」');
  assert.ok(
    /\{!isPaidPro && \(/.test(settings),
    '已是 Pro 还在摆一排「规划中」的价格档 —— 和「订阅生效中」对撞(原始报告第 9 条的第三重矛盾)',
  );
}

// ── ⑤ 攒钱目标的进度不能用「还没发的工钱」算 ─────────────────────────────────
// owed = earned − 已发放。家长一发工钱进度就倒退,发多了直接变负 ——
// 用户看到的是「¥-20.00 / ¥100.00 · 还差 ¥120.00」。
{
  const fam = code(read('components/portal/family/FamilySharingSheet.tsx'));
  assert.ok(/saved:\s*number/.test(fam), '攒钱目标又改回按 owed 算了');
  assert.ok(/saved=\{[\s\S]{0,120}?\.earned/.test(fam), '攒钱进度没有取 earned(累计挣到的)');
  assert.ok(
    !/const reached = owed >= goal/.test(fam),
    '「攒够了」还在拿 owed 判 —— 发过工钱之后永远达不到',
  );
  const server = code(read('lib/family/family-server.ts'));
  assert.ok(/earned:\s*bal\.earned/.test(server), '服务端没把 earned 发给客户端,前端算不出真实攒钱进度');
}

// ── ⑥ 到点的例行提醒要有「不再提醒」出口 ─────────────────────────────────────
// CLAUDE.md 红线:每个提示都要有「跳过 / 稍后 / 不再提醒」。原来只有「完成 / 今天跳过」,
// 两个都只管今天,不想要的提醒每天还会再来;而整张卡又不可点,没有别的出口。
{
  const cards = code(read('components/portal/today/RoutineDueCards.tsx'));
  assert.ok(/deleteRoutine\(r\.id\)/.test(cards), '例行提醒卡没有「不再提醒」出口');
  assert.equal(
    (cards.match(/deleteRoutine\(r\.id\)/g) || []).length, 2,
    'AI 简报卡和普通提醒卡两种都要有「不再提醒」—— 少一种就有一类提醒关不掉',
  );
}

console.log('qa-ui-truth: OK(file input 可点 · 头像手势 · 深链自增号 · 一件事一个数 · 攒钱进度 · 提醒可关)');
