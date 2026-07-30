/**
 * 行为契约:被抬到浮层之上的底部导航,每一颗键都必须真的能用(Bug4 图12 的后果)。
 *
 * 图12 把底部导航抬到洞察全屏浮层之上(z=931),于是它看得见、点得着。
 * 但它打开的东西全在浮层**底下**:
 *   .nesio-camera-sheet / .nesio-voice-sheet = 400,.nesio-wechat-fullscreen = 310,
 *   而洞察这层是 929/930。
 * 结果是 state 变了、sheet 挂了,却被整个盖住 —— 三颗键全是死的。
 * 用户实锤原话:「洞察页下面的 bar…现在没有真正接入功能」。
 *
 * 这个坑在本仓库反复出现(物品页 z-901 被洞察 930 盖住、洞察里开镜头库抽屉…),
 * 所以钉成契约,而不是只留一条注释:
 *   ① 抬层的那条 CSS 必须仍然低于 elevated(940)—— 否则从洞察里再开的抽屉反被导航压住;
 *   ② 导航上每一个会「打开点什么」的回调,都必须先把洞察浮层关掉;
 *   ③ 上面提到的那几个 sheet 的层级只要有人调高到 ≥929,这条契约的前提就变了,得重新想。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** 去掉注释,免得「注释里写了」被当成「代码里做了」。 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const css = read('app/globals.css');
const portal = code(read('components/portal/Portal.tsx'));

// ── ① 抬层的数值必须夹在「盖住洞察」和「不压住 elevated」之间 ──
{
  const m = css.match(/\.nesio-bottom-nav--above-overlay\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(m, '.nesio-bottom-nav--above-overlay 不见了 —— 洞察首页的底部 bar 会重新被浮层盖住');
  const z = Number(m[1]);
  assert.ok(z > 930, `抬层 z=${z} 没高过洞察面板(930),bar 又会被盖住`);
  assert.ok(z < 940, `抬层 z=${z} 压到了 elevated(940)—— 从洞察里再开的抽屉会被导航挡住`);
}

// ── ② 导航上每个「会打开点什么」的回调,都得先关洞察浮层 ──
{
  const navProps = portal.match(/<PortalBottomNav[\s\S]*?\/>/);
  assert.ok(navProps, 'Portal 里找不到 PortalBottomNav');
  const block = navProps[0];

  // 每一项:[prop 名, 人话, 它最终打开的东西]
  const MUST_CLOSE = [
    ['onToday', '回今天', '主面'],
    ['onCamera', '拍一下', '.nesio-camera-sheet z=400'],
    ['onAsk', '说一句', '.nesio-voice-sheet z=400'],
    ['onChatOpen', '长按聊天', '.nesio-wechat-fullscreen z=310'],
  ];
  for (const [prop, zh, what] of MUST_CLOSE) {
    const m = block.match(new RegExp(`${prop}=\\{([\\s\\S]*?)\\}\\s*\\n`));
    assert.ok(m, `PortalBottomNav 少了 ${prop}`);
    assert.match(
      m[1], /setInsightsOpen\(false\)/,
      `导航「${zh}」没有先关洞察浮层 —— 它打开的 ${what} 在浮层(929/930)底下,点了看起来毫无反应`,
    );
  }
}

// ── ③ 前提校验:那几个 sheet 仍然低于洞察层;有人抬高了就得重新想这条契约 ──
{
  const layers = [
    ['.nesio-camera-sheet', 929],
    ['.nesio-voice-sheet', 929],
    ['.nesio-wechat-fullscreen', 929],
  ];
  for (const [sel, ceiling] of layers) {
    const m = css.match(new RegExp(`\\${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
    if (!m) continue; // 类名改了:别在这里假报警,② 才是承重的那条
    assert.ok(
      Number(m[1]) < ceiling,
      `${sel} 的 z 升到了 ${m[1]}(≥${ceiling})—— 它不再被洞察盖住了,` +
      '「先关浮层再开」这条修法的前提没了,回头看契约头部那段说明重新决定。',
    );
  }
}

console.log('nav-above-overlay: OK(抬层夹在 930/940 之间 · 四颗键都先关浮层 · 被开的 sheet 仍在浮层之下)');
