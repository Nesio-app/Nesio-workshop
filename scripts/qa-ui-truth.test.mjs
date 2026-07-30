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
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = stripComments;

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

  // 同步:数字变了必须说清为什么变(2026-07-29 QA #11)。
  // 用户点一次同步,总数 2541 → 2544,提示只写「✓ 已同步」—— 那 3 条就像凭空多出来的。
  // 其实它们是别的设备存下、这台还没有的记忆,取回来完全正确;错的是没说。
  // importedNodeCount 本来就一直算着,只是从来没露过面。
  {
    const at = settings.indexOf('async function handleForceSync');
    assert.ok(at > 0, '隐私页的「立即同步」不见了');
    const fn = settings.slice(at, settings.indexOf('\n  }', at));
    assert.ok(
      /importedNodeCount/.test(fn),
      '「立即同步」又只报一句「已同步」了 —— 记忆总数当场变大却不说来路,用户看到的就是「凭空多了 3 条」',
    );
    assert.ok(
      /n > 0[\s\S]{0,400}\?[\s\S]{0,400}:/.test(fn),
      '同步没有「什么都没变」那一支 —— 一条没取回也说「取回 0 条」同样让人犯嘀咕',
    );
  }

  // 登录态:「你的数据在哪里」整块已按用户标注(bug2 批·设置数据与隐私)删掉 ——
  // 它当年的病(写死成「未登录」与旁边「已登录」同屏打架)随块一起消失。这里只钉死
  // 「别再长回来一个写死登录态的说明块」。
  assert.ok(
    !settings.includes('你的数据在哪里'),
    '「你的数据在哪里」块又回来了 —— 它已按标注删除;要重加必须让文案跟真实登录态走',
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

// ── ⑦ 「读不出来」不许伪装成「没有数据」 ─────────────────────────────────────
// 财务页原来是 hydrated: boolean,而 bankDataReady() 的 catch 里直接 setHydrated(true)——
// IDB 打不开的那一次,界面就说「还没有银行流水,去连接 Plaid」,而流水好端端躺在本机。
// 用户实测:同一个页面在「有完整数据」和「完全空白」之间跳变。
{
  const fin = code(read('components/portal/finance/FinanceTab.tsx'));
  assert.ok(
    /hydrateState/.test(fin) && !/setHydrated\(true\)/.test(fin),
    '财务页又把水合失败当成「没有数据」了 —— 读不出来和真没有必须分开(CLAUDE.md 红线:失败要看得见)',
  );
  assert.ok(/'loading' \| 'ready' \| 'error'/.test(fin), '水合状态不是三态,失败态会被吞掉');
  // 必须框在**首次水合**那一处。只搜 catch(() => setHydrateState('error')) 不够 ——
  // 重试按钮里有一模一样的一句,把初次水合改成 'ready' 测试照样绿(变异测试抓到的)。
  assert.ok(
    /bankDataReady\(\)\.then\(\(\) => \{ setHydrateState\('ready'\); reload\(\); \}\)\.catch\(\(\) => setHydrateState\('error'\)\)/.test(fin),
    '首次水合失败没有落到 error 态 —— 又会把「读不出来」显示成「还没有银行流水」',
  );
}

// ── ⑧ 换肤要真全站:数据可视化的类别色也得跟着皮肤走 ─────────────────────────
// 2026-07-29 实测(真浏览器读 computed style):所有**结构色**(背景/强调/文字/边框)
// 早就是全站跟随的 —— 首页和设置页拿到的 token 完全一致。
// 真正换不动的是饼图 / 关系图 / 地点点位那三组**写死在组件里的类别调色板**:
// 换了皮肤整个界面都柔和了,只有这些图还是原来的高饱和色,像贴纸糊在上面。
// 收进 --viz-1..8(globals.css),每套皮肤一组:色相位保持分散(相邻扇区仍分得开),
// 饱和度跟皮肤对齐。
{
  const css = read('app/globals.css');
  assert.ok(/:root, \.portal-root \{[\s\S]{0,400}--viz-1:/.test(css), '--viz-* 类别色板没有在根上声明');
  // 必须**在那套皮肤自己的规则块里**找,不能只搜「选择器后面 N 个字符内出现 --viz-1」——
  // 窗口一大就会读到下一套皮肤的声明,把某套漏了照样绿(变异测试抓到的)。
  const blockFor = (sel) => {
    const re = new RegExp(`html\\[data-palette="${sel}"\\][^{]*\\{([^}]*)\\}`, 'g');
    return [...css.matchAll(re)].map((m) => m[1]);
  };
  for (const skin of ['bluegray-rose', 'milktea', 'haze-blue', 'sage']) {
    const blocks = blockFor(skin);
    assert.ok(
      blocks.some((b) => Array.from({ length: 8 }, (_, i) => `--viz-${i + 1}:`).every((k) => b.includes(k))),
      `皮肤 ${skin} 没有给全 --viz-1..8 —— 换到这套皮肤时图表会退回默认高饱和色,和界面打架`,
    );
  }
  assert.ok(/data-portal-theme="night"[\s\S]{0,600}--viz-1:/.test(css), '夜间没有给 --viz-* 提亮值');

  // 三个可视化组件必须用 token,不许再写死类别色
  for (const [f, what] of [
    ['components/portal/finance/FinanceTab.tsx', '财务饼图'],
    ['components/portal/RelationGraph.tsx', '关系星图'],
    ['components/portal/insights/TimelineTab.tsx', '足迹地点点位'],
  ]) {
    const c = code(read(f));
    assert.ok(/var\(--viz-/.test(c), `${what}没有用 --viz-* 类别色 —— 换肤时它不会跟着变`);
  }
  // 那三组原来的写死色板不许回来(挑各自最有代表性的一个值)
  for (const [f, hex, what] of [
    ['components/portal/finance/FinanceTab.tsx', '#e0954a', '饼图'],
    ['components/portal/RelationGraph.tsx', '#7c6ee6', '关系图节点'],
    ['components/portal/insights/TimelineTab.tsx', '#d6559e', '地点点位'],
  ]) {
    assert.ok(!code(read(f)).includes(hex), `${what}又写死了 ${hex}`);
  }
  // 地球的「到访国」高亮曾是写死的荧光黄绿,换任何皮肤都不变
  const globe = code(read('components/portal/insights/Globe.tsx'));
  assert.ok(!globe.includes("'#c9ef7d'"), '地球到访国高亮又写死成荧光黄绿了');
  assert.ok(/tok\('--status-go'/.test(globe), '地球到访国高亮没有走 token');
}

// ── ⑨ 相机页:看结果 / 存好之后不是取景,得回到站内配色 ──────────────────────
// 取景屏用深色是对的(全屏画面要压暗),但结果页和「已保存」页是普通表单页。
// 原来只有 phase==='result' 挂 --result(浅色壳),'saved' 漏了 ——
// 存完那一屏顶栏和底栏当场退回深蓝黑,和整个浅色 app 割裂。
{
  const cam = code(read('components/portal/CameraSheet.tsx'));
  // 断言必须钉在 lightShell 那一行上:取景器的显示条件里也有
  // `phase === 'result' || phase === 'saved'` 这串,只搜子串会被它喂饱(变异测试抓到的)。
  assert.ok(
    /const lightShell = phase === 'result' \|\| phase === 'saved';/.test(cam),
    '相机的浅色壳又只认 result 了 —— 存好那一屏会退回深蓝黑底',
  );
  // 结果页的说明文字必须独占一行(和 chip 行同处一个 flex 会被压成竖条)
  assert.ok(
    /<p className="nesio-camera-result-summary">\{result\.summary\}<\/p>/.test(cam),
    '识别说明又被塞回按钮行里了 —— 中文会被压成五六字宽的竖列',
  );
  assert.ok(/nesio-camera-result-actions/.test(cam), '识别动作 chip 没有自己一行');
  // 标签框不放示例文案(灰字看着像已经填好了)
  const tagAt = cam.indexOf('nesio-camera-tag-input');
  if (tagAt > 0) {
    assert.ok(!/#钥匙/.test(cam), '标签框又放回 #钥匙 #门口 那串示例了');
  }
  // 主按钮 / 次按钮成对:两者的字号和内边距要一致,颜色都跟皮肤
  const css = read('app/globals.css');
  // 取**基础声明块**,不是 --result 那条单行覆盖(它排在前面,indexOf 会先撞上它)。
  const blockOf = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at > 0, `${sel} 的基础声明块不见了`);
    return css.slice(at, css.indexOf('}', at));
  };
  const save = blockOf('.nesio-camera-save-btn');
  const retake = blockOf('.nesio-camera-retake-btn');
  assert.ok(!/#fff;|#8fa3c0/.test(retake), '「重拍」又用回写死的灰蓝字 —— 浅底上它会只剩一行裸字');
  assert.ok(/var\(--portal-accent\)/.test(save), '「存入记忆」没跟随皮肤强调色');
  assert.ok(!/rgba\(88,140,227/.test(save), '主按钮投影又写死品牌蓝了 —— 换皮肤会是蓝影子配陶红按钮');
  for (const [name, blk] of [['save', save], ['retake', retake]]) {
    assert.ok(/font-size: var\(--text-sm\)/.test(blk), `${name} 按钮字号没走 token —— 两个挨着的按钮会差一截`);
  }
}

console.log('qa-ui-truth: OK(file input 可点 · 头像手势 · 深链自增号 · 一件事一个数 · 攒钱进度 · 提醒可关)');
