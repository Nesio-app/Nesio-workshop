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
  for (const [label, hint] of [['playLabel', '播放/暂停'], ["'下一首'", '下一首'], ["'关闭播放'", '关闭']]) {
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
  const rule = css.match(/\.nesio-fp,\s*\n\.nesio-fp-ball \{[^}]*\}/);
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
