/**
 * 行为契约:悬浮播放球(2026-07-31,用户:「开始播放后可以变成一个圆形的悬浮按钮么。
 * 可以播放暂停下一首和关闭」)。
 *
 * 这颗球的存在依赖一个容易被后来的人改回去的结构决定:
 * **音频元素必须活在 React 树之外**。它一旦被塞回某个组件里,那个组件卸载的瞬间
 * 音乐就断了 —— 而球的全部意义正是「人离开了音乐页,歌还在放」。
 * 所以下面第一条压的不是球长什么样,是那个前提。
 *
 * 另外三条都关于「别把用户困住」:
 *   · 没在放的时候球不该存在(不留一个点了什么也不会发生的按钮);
 *   · 关闭必须**真停**,不能只是把球藏起来 —— 藏起来而声音还在,
 *     用户会满屋子找是谁在唱歌,并且再也没有入口关掉它;
 *   · 播放出的岔子要在球上也说一句 —— 那会儿他多半不在音乐页,看不到那边的提示。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** 去掉注释:免得「注释里写了」被当成「代码里做了」。 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const engine = code(read('lib/platform/music/player-engine.ts'));
const ball = code(read('components/portal/music/FloatingPlayer.tsx'));
const panel = code(read('components/portal/music/MusicPanel.tsx'));
const portal = code(read('components/portal/Portal.tsx'));
const css = read('app/globals.css');

/* ── ① 音频必须活在 React 树之外 ────────────────────────────────────────── */

assert.ok(
  /document\.createElement\('audio'\)[\s\S]{0,1200}document\.body\.appendChild\(el\)/.test(engine),
  '音频元素必须由引擎创建并挂到 document.body —— 放进组件里,切走那一页音乐就断了',
);
assert.ok(
  !/<audio/.test(panel),
  '音乐面板里不能再有 <audio> 节点:它会随面板卸载被销毁,悬浮球就失去了意义',
);
assert.ok(
  /export function subscribe\(/.test(engine) && /export function currentState\(/.test(engine),
  '引擎要能被订阅 —— 面板和悬浮球看的必须是同一份状态,不是各存各的',
);

/* ── ② 球挂在 Portal 层,不在音乐页里 ───────────────────────────────────── */

assert.ok(
  /<FloatingPlayer \/>/.test(portal),
  '悬浮球必须挂在 Portal 层,才能在每一页都看得见',
);
assert.ok(
  !/FloatingPlayer/.test(panel),
  '球不该由音乐面板渲染 —— 那样它只在音乐页里存在,等于没做',
);

/* ── ③ 没在放就不存在 ───────────────────────────────────────────────────── */

assert.ok(
  /if \(!st\.currentId\) return null;/.test(ball),
  '没有当前曲目时球必须返回 null —— 不留一个点了什么也不会发生的按钮',
);

/* ── ④ 关闭是真停,不是把球藏起来 ───────────────────────────────────────── */

assert.ok(
  /onClick=\{stop\}/.test(ball),
  '关闭键必须直接调引擎的 stop,不能只改一个本地的「隐藏」state',
);
{
  // stop 要做齐三件事:暂停、放掉 objectURL、清掉 currentId(球的消失条件)。
  const m = engine.match(/export function stop\(\): void \{[\s\S]*?\n\}/);
  assert.ok(m, 'stop 不见了');
  const body = m[0];
  assert.ok(/\.pause\(\)/.test(body), 'stop 要真的暂停');
  assert.ok(/revoke\(\)/.test(body), 'stop 要放掉 objectURL —— 一首无损几十 MB');
  assert.ok(/currentId: ''/.test(body), "stop 要清掉 currentId —— 它同时是球的消失条件");
}

/* ── ⑤ 三个动作齐全,而且叫得出名字 ─────────────────────────────────────── */

{
  assert.ok(/void toggle\(\); \}/.test(ball), '要有播放/暂停');
  assert.ok(/step\('next', false\)/.test(ball), "要有下一首,且是手动语义(auto=false)——单曲循环下也得真换歌");
  // 三个键各自的 aria-label:球上只有符号,没有文字,读屏用户全靠它。
  // 2026-08-01:「收起」和「停止播放」拆成两颗键 —— 用户实测「点一下,悬浮球缩回去
  // 那个按钮不管用」,查下来**那个按钮根本不存在**:展开态只有三个键,而 × 是 stop。
  // 他点了以为收起坏了,其实是音乐被他关掉了。× 的文案也跟着改成「停止播放」,
  // 免得再被当成「收起」。
  // ⚠️ 曲名条也带同一个 aria-label(整块可点 = 收起),所以判据要钉在 **.nesio-fp-btn**
  //    这一颗上 —— 第一版没钉,注入把 ⌄ 键整个删掉之后曲名条那份照样匹配、照样绿。
  assert.ok(/className="nesio-fp-btn"\s*\n\s*aria-label=\{L\(dict, '收起', 'Collapse'\)\}/.test(ball),
    '展开态要有一颗**收起**键(不是只有曲名条可点)—— ' +
    '「我想让它别挡着」和「我不想听了」不该是同一颗键');
  // 曲名条那份也留着(手指落在哪都行),两条路并存
  assert.ok(/className="nesio-fp-meta"[\s\S]{0,220}setExpanded\(false\)/.test(ball),
    '曲名条也该整块可点收起 —— 不用瞄准那颗小键');
  for (const [label, hint] of [['playLabel', '播放/暂停'], ["'下一首'", '下一首'], ["'停止播放'", '停止播放']]) {
    assert.ok(new RegExp(`aria-label=\\{${label.startsWith("'") ? `L\\(dict, ${label}` : label}`).test(ball),
      `${hint} 这一键要有 aria-label`);
  }
}

/* ── ⑥ 关闭不许藏进长按里 ───────────────────────────────────────────────── */

assert.ok(
  /const \[expanded, setExpanded\] = useState\(true\)/.test(ball),
  '刚开始放的时候要默认展开 —— 一个用户要是找不到怎么关掉,他会去清后台',
);
assert.ok(
  /setExpanded\(true\);[\s\S]{0,200}setTimeout\(\(\) => setExpanded\(false\), COLLAPSE_MS\)/.test(ball),
  '展开一会儿要自己收成球,别一直挡着',
);
assert.ok(
  !/onLongPress|onTouchStart[\s\S]{0,80}stop/.test(ball),
  '关闭不能只有长按这一条路 —— 藏起来的出口等于没有出口',
);
/* ── ⑥a 长按 = 挪位置,不是别的(2026-08-01 用户点名)───────────────────── */
// 判据钉在「阈值那个 setTimeout 里面才 setDragging(true)」这一整块上 ——
// 只查两个字符串各自存在的话,把 dragging 换成常量 true 照样绿(注入抓出来的)。
assert.ok(/setTimeout\(\(\) => \{[\s\S]{0,300}setDragging\(true\)[\s\S]{0,200}\}, LONG_PRESS_MS\)/.test(ball),
  '进拖动态必须**等到长按阈值**才发生 —— 直接拖会把页面滚动吃掉,而滚动比挪球高频得多');
assert.ok(/const \[dragging, setDragging\] = useState\(false\)/.test(ball),
  'dragging 必须是真的 state —— 写死成常量的话「拖完那一下不许触发点击」这层保护就空了');
assert.ok(/!pressRef\.current\.moved/.test(ball),
  '按下之后手指移开过就不算长按 —— 那是在滚页面,不是在挪球');
// 拖完那一下不许顺手触发点击 —— 手指抬起来的地方通常不是他想点的东西
for (const guard of [/if \(!dragging\) setExpanded\(true\)/, /if \(!dragging\) setExpanded\(false\)/]) {
  assert.ok(guard.test(ball), '拖动结束时不许顺带把展开/收起也触发了');
}
// 位置要记住,而且要夹在视口里 —— 换了屏幕方向之后落到屏幕外就再也点不到了
assert.ok(/localStorage\.setItem\(FP_POS_KEY/.test(ball), '拖到哪要记住');
assert.ok(/function clampPos/.test(ball) && /Math\.min\(Math\.max\(0, p\.x\)/.test(ball),
  '存着的坐标要夹回视口 —— 换个屏幕尺寸就可能落到屏幕外,那球再也点不到');

/* ── ⑥b 三秒不碰变半透明,但**不消失** ─────────────────────────────────── */
assert.ok(/DIM_MS/.test(ball) && /setDim\(true\)/.test(ball), '要有「多久不碰就淡下去」');
assert.ok(/setDim\(false\)/.test(ball), '碰一下要能恢复 —— 淡着还点不亮就成了半个死按钮');
{
  const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const dim = css.slice(css.indexOf('.nesio-fp.is-dim'), css.indexOf('.nesio-fp.is-dim') + 200);
  assert.ok(/opacity:\s*0?\.\d+/.test(dim), '淡化要用 opacity');
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(dim),
    '淡下去**不许变成消失** —— 消失了「怎么关掉这首歌」就又没有答案了');
}

/* ── ⑥b 音乐页开着时球要让位 ────────────────────────────────────────────── */

assert.ok(
  /if \(panelOpen\) return null;/.test(ball),
  '音乐页底部已经有一条完整的播放条,球再飘一个出来就是同一屏两套控制',
);
assert.ok(
  /useEffect\(\(\) => \{ setPanelOpen\(true\); return \(\) => setPanelOpen\(false\); \}, \[\]\);/.test(panel),
  '面板要在挂载/卸载时如实报告自己在不在 —— 只报进不报出,离开音乐页球就再也不出现了',
);

/* ── ⑦ 球上也要说错误 ───────────────────────────────────────────────────── */

assert.ok(
  /\{!!st\.error && <p className="nesio-fp-err">\{st\.error\}<\/p>\}/.test(ball),
  '播放出的岔子要在球上说 —— 这会儿用户多半不在音乐页,看不到那边的提示',
);

/* ── ⑦b 车机/锁屏由引擎自管 ─────────────────────────────────────────────── */

assert.ok(
  /before\.currentId !== state\.currentId \|\| before\.playing !== state\.playing\) syncMediaSession\(\)/.test(engine),
  '车机显示要跟着正在放的东西走,不能交给组件 —— 人离开音乐页之后那边会一直停在上一首',
);
assert.ok(
  !/syncMediaSession/.test(read('components/portal/music/use-local-player.ts')),
  '组件里不该再同步一遍 MediaSession —— 两处真源迟早漂移',
);
{
  const body = engine.match(/export function stop\(\): void \{[\s\S]*?\n\}/)[0];
  assert.ok(
    /clearMediaSession\(\)/.test(body),
    '关掉之后车机/锁屏上的残留要清 —— 还显示着曲名和暂停键,用户会以为没关干净',
  );
}

/* ── ⑧ 层级:压得住浮层,压不住抽屉 ─────────────────────────────────────── */

{
  // 只看**这一条规则**里的值 —— 在整份 css 里搜关键字,别处一个长得像的写法就能
  // 让断言蒙混过关(断言太宽 = 断言不存在)。
  // 2026-08-01:定位从按钮本身挪到了**外层** wrap —— 长按拖动要改 left/top,
  // 而球自己还要 position:relative 给进度环做定位上下文。
  const rule = css.match(/\.nesio-fp,\s*\n\.nesio-fp-ball-wrap \{[^}]*\}/);
  assert.ok(rule, '悬浮球的定位规则不见了');
  const block = rule[0];
  const m = block.match(/z-index:\s*(\d+)/);
  assert.ok(m, '悬浮球的 z-index 不见了');
  const z = Number(m[1]);
  // 洞察全屏浮层是 929/930:低于它,球在洞察页里就看不见了。
  assert.ok(z > 930, `球要高于洞察浮层(930),现在是 ${z}`);
  // elevated 是 940:高过它,从洞察里再开的抽屉会被这颗球压住。
  assert.ok(z < 940, `球不能压住 elevated 抽屉(940),现在是 ${z}`);
  // 位置要在底部导航之上 —— 盖住导航就是拿一个新功能挡掉四个旧入口。
  const bottom = block.match(/bottom:\s*calc\(env\(safe-area-inset-bottom[^)]*\)\s*\+\s*([\d.]+)rem\)/);
  assert.ok(bottom, '球的 bottom 必须让开安全区,并写成「安全区 + 抬高量」');
  // 底部导航自己在安全区 + 0.35rem 处,高约 3.2rem —— 抬高量小于 4rem 就会压在它上面,
  // 那等于拿一个新功能挡掉四个旧入口。
  assert.ok(Number(bottom[1]) >= 4, `球要抬到底部导航之上(≥4rem),现在是 ${bottom[1]}rem`);
}

/* ── ⑨ 清数据之前先停播 ─────────────────────────────────────────────────── */

{
  const owner = code(read('lib/portal/local-owner.ts'));
  assert.ok(
    (owner.match(/player-engine'\)\)\.stop\(\)/g) || []).length >= 2,
    '登出和删除全部数据两处都要先停播 —— 歌还在响、文件已经删掉,是最刺眼的一种「没删干净」',
  );
  const settings = code(read('components/portal/SettingsSheets.tsx'));
  assert.ok(
    (settings.match(/stopMusic\(\)/g) || []).length >= 2,
    '设置里的清空本机数据和删除账号两处也要先停播',
  );
}

console.log('music-floating-player: OK(音频活在 React 树外 / 挂 Portal 层 / 不放就不存在 / 音乐页开着时让位 / 关闭是真停 / 三键齐全 / 出口不藏 / 球上说错 / 车机不残留 / 层级不打架 / 清数据先停)');
