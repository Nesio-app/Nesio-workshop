/**
 * 行为契约:从 fullscreen 面板内部再开的层,必须抬到 elevated 档。
 *
 * 为什么单独立一条测试 —— 同一个坑被报了**八次**,每次的症状都是「点了没反应」,
 * 每次的根因都一样:一个 bottom 抽屉(z-900/901)从洞察这类 fullscreen 面板
 * (z-929/930)内部打开,portal 到 body 后与面板同级,被面板不透明底整个盖住。
 * 已中招的:镜头库 / 日程详情 / 物品管理 / 记给某人 / 关系详情 /
 * 到访记忆列表 + 图片放大 / 记一笔近况。
 *
 * 到访记忆列表那次尤其说明问题:它在「批次 G」被从 420 抬到 901 对齐**当时**的
 * 洞察层,后来洞察改成真全屏(929/930),它就又被盖回去了 —— 靠人肉记住层号
 * 不管用,所以把规则钉进测试。
 *
 * 这条测试锁四件事:
 *   ① 三档层序(bottom < fullscreen < elevated < 看图器)的实际数值;
 *   ② NesioSheet 的 elevated 接口还在、还映射到那两个类;
 *   ③ MemoryNodeDetail 还把 elevated 透传给自己的 sheet(断了 = 所有修复全废);
 *   ④ **漂移检测**:凡是活在某个 fullscreen 面板里的子树(见 FULLSCREEN_SUBTREES),
 *      新写的 bottom 抽屉/自研浮层没抬层就直接红。这一条是防第九次的,
 *      豁免必须写进 EXEMPT_CLASSES 并说明理由 —— 而且每条豁免的**前提**
 *      (不 portal、有 zIndex 外壳、声明顺序)都在下面单独锁住,前提一变豁免就失效。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// 先剥掉 CSS 注释:注释会落进「选择器」那一段,而这份文件的注释里到处写着类名
// (「与 .nesio-sheet-overlay--elevated 同层」之类),不剥就会把邻近规则的 z 认成它的。
const css = stripComments(read('app/globals.css'));
const sheet = read('components/portal/ui/NesioSheet.tsx');

/**
 * 抓出所有 `<Name ...>` 开标签的完整文本。
 * 不能用 /<Name[^>]*>/ —— JSX 属性里全是 `onClose={() => ...}` 这种箭头函数,
 * 里面的 `>` 会把正则骗停(实测:漏报了一个真的少 elevated 的调用点)。
 * 这里按大括号深度扫,深度为 0 时遇到的 `>` 才是标签结束。
 */
function jsxOpenTags(src, name) {
  const out = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    for (let i = m.index + name.length + 1; i < src.length; i += 1) {
      const c = src[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) { out.push(src.slice(m.index, i + 1)); break; }
    }
  }
  return out;
}

/**
 * 取某个类选择器上声明的 z-index(取全文件里的最大值 —— 后面的覆盖前面的)。
 *
 * 尾部同时排掉 `.`:否则查基类 `.nesio-sheet` 时会把复合选择器
 * `.nesio-sheet.nesio-sheet--elevated{z-index:941}` 也算成基类,基类被读成 941,
 * 上面的层序断言就全乱了(实测踩过)。查修饰符类不受影响 —— 它们在选择器末尾。
 */
function zIndexOf(cls) {
  let z;
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`\\.${cls}(?![\\w.-])`).test(sel)) continue;
    const m = body.match(/z-index\s*:\s*(\d+)/);
    if (m) z = z === undefined ? +m[1] : Math.max(z, +m[1]);
  }
  return z;
}

// ── ① 三档层序 ────────────────────────────────────────────────────────────
{
  const bottomOverlay = zIndexOf('nesio-sheet-overlay');
  const bottomPanel = zIndexOf('nesio-sheet');
  const fsOverlay = zIndexOf('nesio-sheet-overlay--opaque');
  const fsPanel = zIndexOf('nesio-sheet--fullscreen');
  const elOverlay = zIndexOf('nesio-sheet-overlay--elevated');
  const elPanel = zIndexOf('nesio-sheet--elevated');
  const viewer = zIndexOf('nesio-image-viewer');

  for (const [name, v] of Object.entries({ bottomOverlay, bottomPanel, fsOverlay, fsPanel, elOverlay, elPanel, viewer })) {
    assert.equal(typeof v, 'number', `${name} 必须在 globals.css 里显式声明 z-index`);
  }
  // 2026-07-29:层叠模型换了一次(QA 分支「死按钮总根因」),这里的断言跟着换。
  //
  // 旧模型:bottom(900/901) < fullscreen(929/930),靠**数值**分层。
  //   只考虑了「从 bottom 卡里开全屏」这一个方向;反过来(洞察全屏里开 bottom/center:
  //   物品页 / 关系详情 / 剧场播放器 / 地点卡…)一律被压在全屏底下 —— 看不见,
  //   还拦住下一次点击,表现成「点两次才生效」。
  // 新模型:bottom 与 fullscreen **同层**(都 930),层叠交给 DOM 顺序 ——
  //   Radix/Vaul 都是 portal 到 body,后开的后 append,天然盖住先开的,两个方向都对。
  //   同一层里 Overlay 先渲染、Content 后渲染,所以面板天然在自己的遮罩之上。
  // 所以:同层是**设计**,不是 bug → 用 <= 而不是 <。
  // elevated 档保留并仍然严格更高:它解决的是另一件事 ——
  //   有些子层不是「后开的」(同一次渲染里就挂着),DOM 顺序救不了,必须显式抬。
  assert.ok(bottomOverlay <= bottomPanel, '面板不能低于自己的遮罩(同层可以,DOM 顺序会让面板在上)');
  assert.ok(fsOverlay <= fsPanel, 'fullscreen 面板不能低于自己的不透明底');
  assert.ok(
    Math.max(bottomPanel, fsPanel) < elOverlay,
    'elevated 必须严格高过 bottom / fullscreen —— 这就是八次「点了没反应」的解药',
  );
  assert.ok(elOverlay < elPanel, 'elevated 面板必须高过自己的遮罩');
  assert.ok(elPanel < viewer, '看图器永远在最上层');
  // over-opaque:opaqueOverlay + 非全屏时,面板要盖过自己的不透明遮罩(否则整屏纯色点不动)。
  const overOpaque = zIndexOf('nesio-sheet--over-opaque');
  assert.equal(typeof overOpaque, 'number', 'over-opaque 档必须显式声明 z-index');
  assert.ok(overOpaque > fsOverlay, 'over-opaque 面板必须高过不透明遮罩,否则被自己盖死');
  assert.ok(overOpaque < elOverlay, 'over-opaque 不该高到 elevated 档里去');
}

// ── ①b 声明了不等于生效:elevated 那条得在级联里真的赢过基类 ────────────────
//
// 2026-07-29 实测:上面这一整段一直是绿的,而**面板从来没抬起来过**。
// `.nesio-sheet--elevated{z-index:941}` 写在基类 `.nesio-sheet{z-index:901}` 前面,
// 同特异度后者胜 —— 浏览器里量出来的面板是 901,而它自己的遮罩正确抬到了 940。
// 结果:抽屉被自己的遮罩整个盖住,里面每个按钮都点不动(RelationshipDetailSheet 的
// 「挂一条 / 移除」一直是死的)。上面只比了**声明值**,没比谁赢 —— 数字对,级联输了。
// 直接算「一个 elevated 底部抽屉最终拿到的 z-index」—— 按级联规则(特异度,再比声明序)
// 挑赢家,而不是看某一条声明了什么。这才是浏览器里量到的那个数。
{
  const PANEL_CLASSES = ['nesio-sheet', 'nesio-sheet--bottom', 'nesio-sheet--bare', 'nesio-sheet--elevated', 'nesio-settings-sheet-card'];
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  let win = null; // { spec, order, z }
  rules.forEach(([, selGroup, body], order) => {
    const m = body.match(/z-index\s*:\s*(\d+)/);
    if (!m) return;
    for (const sel of selGroup.split(',')) {
      const s = sel.trim();
      // 只认「纯类选择器串」(.a.b.c),别的形态(后代/伪类/属性)一律跳过 —— 这里只需要覆盖
      // 面板自身那几条规则,判不准就不判,不要瞎猜。
      if (!/^(\.[\w-]+)+$/.test(s)) continue;
      const classes = s.match(/\.[\w-]+/g).map((c) => c.slice(1));
      if (!classes.every((c) => PANEL_CLASSES.includes(c))) continue;
      const spec = classes.length;
      if (!win || spec > win.spec || (spec === win.spec && order > win.order)) win = { spec, order, z: +m[1] };
    }
  });
  assert.ok(win, '算不出 elevated 面板的最终 z-index —— 选择器形态变了,这条断言要跟着改');
  assert.equal(
    win.z, 941,
    `elevated 底部抽屉最终拿到的 z-index 是 ${win.z},不是 941。`
    + `遮罩在 940 —— 面板低于自己的遮罩 = 抽屉被自己盖住,里面每个按钮都点不动。`
    + `(2026-07-29 实测过:那时 .nesio-sheet--elevated 写在基类 .nesio-sheet 前面,同特异度输给了后者。)`,
  );
}

// ── ② NesioSheet 的 elevated 接口还在 ────────────────────────────────────
{
  assert.match(sheet, /elevated\?\s*:\s*boolean/, 'NesioSheet 必须保留 elevated 入参');
  assert.match(sheet, /nesio-sheet--elevated/, 'elevated 必须映射到面板类');
  assert.match(sheet, /nesio-sheet-overlay--elevated/, 'elevated 必须同时抬遮罩 —— 只抬面板会让遮罩留在下面,点穿');
}

// ── ③ MemoryNodeDetail 透传 ──────────────────────────────────────────────
{
  const mnd = read('components/portal/MemoryNodeDetail.tsx');
  assert.match(mnd, /elevated\?\s*:\s*boolean/, 'MemoryNodeDetail 必须收 elevated');
  assert.match(mnd, /elevated=\{elevated\}/, 'MemoryNodeDetail 必须把 elevated 透传给自己的 NesioSheet(断了 = 所有调用点白改)');
}

// ── ④ 已修点回归锁 ───────────────────────────────────────────────────────
// 这些都是从 fullscreen 面板内部打开的层。改动这些文件时若丢了 elevated,这里红。
const FIXED_SITES = [
  ['components/portal/MemoryLensSheet.tsx', '洞察 → 镜头 → 镜头库抽屉'],
  ['components/portal/InventorySheet.tsx', '洞察 → 物品管理'],
  ['components/portal/relationships/RelationshipDetailSheet.tsx', '洞察 → 关系 → 关系详情'],
  ['components/portal/insights/SchedulePanel.tsx', '洞察 → 日程 → 日程详情'],
  ['components/portal/insights/TimelineTab.tsx', '洞察 → 时间线 → 到访记忆详情'],
  ['components/portal/relationships/HangNoteSheet.tsx', '洞察 → 关系 → 关系详情 → 记一笔近况'],
];
/** 这个文件里所有「会落在 bottom 档」的层:自己的 bottom NesioSheet + 内嵌的记忆详情。 */
function bottomLayerTags(src) {
  return [
    ...jsxOpenTags(src, 'NesioSheet').filter((t) => /variant="bottom"/.test(t)),
    ...jsxOpenTags(src, 'MemoryNodeDetail'),
  ];
}

for (const [file, why] of FIXED_SITES) {
  const tags = bottomLayerTags(read(file));
  assert.ok(tags.length > 0, `${file}(${why})里找不到 bottom 层了 —— 结构变了,这条锁失效,要跟着改`);
  for (const tag of tags) {
    assert.match(tag.replace(/\s+/g, ' '), /\belevated\b/, `${file}(${why})必须抬层`);
  }
}

// ── ⑤ 漂移检测:活在 fullscreen 面板里的子树,新写的层不许留在下面 ────────
//
// 这些目录/文件的内容都渲染在某个 fullscreen 面板(929/930)内部。它们里面
// portal 到 body 的浮层,只要 z 低于 elevated 档就会被那个面板整个盖住。
// 新开一个全屏面板时,把它的正文子树加进这张表。
const FULLSCREEN_SUBTREES = [
  ['components/portal/insights', '洞察(Portal.tsx 的 fullscreen)'],
  ['components/portal/relationships', '洞察 → 关系'],
  ['components/portal/cooking', '做饭 · 库存(CookingSheet fullscreen)'],
  ['components/portal/family', '家庭分享(FamilySharingSheet fullscreen)'],
  ['components/portal/reader', '阅读器(ReaderView fullscreen)'],
  ['components/portal/travel', '足迹 → 计划/行程'],
];

/** 明确审阅过的豁免 —— 加进来必须写清为什么它不是 bug。 */
const EXEMPT_CLASSES = new Map([
  // 它不是 portal 出去的浮层,是当作 NesioSheet fullscreen 面板自己的 className 用的;
  // 实际生效的是后声明的 .nesio-sheet--fullscreen(930),这里的 400 是历史残留的死值。
  ['nesio-memmap-overlay', 'MemoryMapSheet:用作 NesioSheet 面板 className,实际层由 .nesio-sheet--fullscreen 决定'],
  // position:relative,活在 .nesio-visitmem-overlay 的层叠上下文内部,与 body 不同级。
  ['nesio-visitmem-sheet', '在 visitmem-overlay 内部,不与洞察面板同级'],
  // 不 portal,就地渲染在筛选按钮旁边 —— 活在洞察面板自己的层叠上下文里,40 是相对值。
  ['nesio-mirror-filter-backdrop', 'MirrorLetterTab:内联渲染的下拉遮罩,不与洞察面板同级'],
  // 这两个 portal 出去了,但外面套了一层 style={{position:'fixed',zIndex:948}} 的壳,
  // 壳本身高过洞察(930),壳内的 60/61 是相对值。下面单独锁住那层壳的层号。
  ['nesio-mirror-drawer-scrim', 'MirrorLetterTab:在 zIndex:948 的 portal 壳内部'],
  ['nesio-mirror-drawer', 'MirrorLetterTab:在 zIndex:948 的 portal 壳内部'],
  // 同 memmap:当作 ArticleReaderSheet 的 fullscreen 面板 className 用,630 是死值。
  ['nesio-rd-overlay', 'ArticleReaderSheet:用作 NesioSheet 面板 className,实际层由 .nesio-sheet--fullscreen 决定'],
  // ReaderView 全文件零 createPortal —— 这两个就地渲染在阅读器面板里,40/42 是相对值。
  ['nesio-rd-selmenu', 'ReaderView:内联渲染的选字菜单,不与阅读器面板同级'],
  ['nesio-rd-toast', 'ReaderView:内联渲染的提示条,不与阅读器面板同级'],
]);

// 上面两条 ReaderView 豁免的前提 = 它确实不 portal。哪天改成 portal 就得重新算层。
assert.equal(
  /createPortal/.test(read('components/portal/reader/ReaderView.tsx')), false,
  'ReaderView 开始用 createPortal 了 —— 选字菜单/提示条的豁免不再成立,得按 elevated 档重算层号',
);

// 面板 className 型豁免的前提 = .nesio-sheet--fullscreen 声明在它们后面(同优先级,后者胜)。
{
  const posFullscreen = css.indexOf('.nesio-sheet--fullscreen');
  for (const cls of ['nesio-memmap-overlay', 'nesio-rd-overlay']) {
    assert.ok(css.indexOf(`.${cls}`) < posFullscreen,
      `.${cls} 声明在 .nesio-sheet--fullscreen 之后了 —— 它的死 z 会反过来覆盖 930`);
  }
}

// 上面两条豁免的前提 = 那层壳的层号。壳被改小/删掉,豁免就不成立了 —— 在这儿锁死。
{
  const mirror = read('components/portal/insights/MirrorLetterTab.tsx');
  const shell = mirror.match(/zIndex:\s*(\d+)/);
  assert.ok(shell, 'MirrorLetterTab 的往期抽屉必须有显式 zIndex 外壳(豁免就建立在它身上)');
  assert.ok(+shell[1] >= zIndexOf('nesio-sheet-overlay--elevated'),
    `往期抽屉外壳 zIndex=${shell?.[1]},低于 elevated 档 —— 会被洞察面板盖住`);
}

const ELEVATED_FLOOR = zIndexOf('nesio-sheet-overlay--elevated');

/** 全库扫一遍:position:fixed 且带 z-index 的类 → 最大 z。 */
const fixedZ = new Map();
for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/position\s*:\s*fixed/.test(body)) continue;
  const m = body.match(/z-index\s*:\s*(\d+)/);
  if (!m) continue;
  for (const c of sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    fixedZ.set(c[1], Math.max(fixedZ.get(c[1]) ?? 0, +m[1]));
  }
}

const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const hostedFiles = [];
for (const [dir, label] of FULLSCREEN_SUBTREES) {
  const files = walk(dir).filter((f) => f.endsWith('.tsx'));
  assert.ok(files.length > 0, `${dir}(${label})没扫到文件 —— 目录挪了,这条守卫就形同虚设,要跟着改`);
  hostedFiles.push(...files);
}

const offenders = [];
for (const file of hostedFiles) {
  const src = read(file);

  // 5a:bottom 抽屉(直接用 NesioSheet 或 MemoryNodeDetail)必须带 elevated
  for (const tag of bottomLayerTags(src)) {
    if (/\belevated\b/.test(tag)) continue;
    offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}… 少了 elevated`);
  }

  // 5b:自研 fixed 浮层的层号不能低于 elevated 档
  for (const m of src.matchAll(/className="([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      const z = fixedZ.get(cls);
      if (z === undefined || z >= ELEVATED_FLOOR) continue;
      if (EXEMPT_CLASSES.has(cls)) continue;
      offenders.push(`${file}: .${cls} 的 z-index=${z} < ${ELEVATED_FLOOR},会被它所在的全屏面板整个盖住`);
    }
  }
}

assert.deepEqual(offenders, [], [
  '',
  '全屏面板(z-929/930)里有层没抬到 elevated 档 —— 这就是那几次「点了没反应」的形状:',
  ...offenders.map((o) => `  · ${o}`),
  '',
  '修法二选一:NesioSheet/MemoryNodeDetail 传 elevated;自研浮层把 z-index 提到 940 以上。',
  '确认不是 bug 的,加进本文件的 EXEMPT_CLASSES 并写明理由。',
].join('\n'));

console.log(`sheet-elevation: OK(全屏宿主子树 ${hostedFiles.length} 个文件,零漏层)`);
