/**
 * 行为契约:从 fullscreen 面板内部再开的层,必须抬到 elevated 档。
 *
 * 为什么单独立一条测试 —— 同一个坑在标注里被报了**六次**,每次的症状都是
 *「点了没反应」,每次的根因都一样:一个 bottom 抽屉(z-900/901)从洞察这类
 * fullscreen 面板(z-929/930)内部打开,portal 到 body 后与面板同级,被面板
 * 不透明底整个盖住。已中招的:镜头库 / 日程详情 / 物品管理 / 记给某人 /
 * 关系详情 / 时间线的到访记忆列表+图片放大。
 *
 * 最后一次尤其说明问题:到访记忆列表在「批次 G」被从 420 抬到 901 对齐当时的
 * 洞察层,后来洞察改成真全屏(929/930),它就又被盖回去了 —— 靠人肉记住层号
 * 不管用,所以把规则钉进测试。
 *
 * 这条测试锁四件事:
 *   ① 三档层序(bottom < fullscreen < elevated < 看图器)的实际数值;
 *   ② NesioSheet 的 elevated 接口还在、还映射到那两个类;
 *   ③ MemoryNodeDetail 还把 elevated 透传给自己的 sheet(断了 = 六处修复全废);
 *   ④ **漂移检测**:洞察子树里新写的 bottom 抽屉/自研浮层如果没抬层,直接红。
 *      这一条是防第七次的,豁免必须写进下面的表并说明理由。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// 先剥掉 CSS 注释:注释会落进「选择器」那一段,而这份文件的注释里到处写着类名
// (「与 .nesio-sheet-overlay--elevated 同层」之类),不剥就会把邻近规则的 z 认成它的。
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
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

/** 取某个类选择器上声明的 z-index(取全文件里的最大值 —— 后面的覆盖前面的)。 */
function zIndexOf(cls) {
  let z;
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`\\.${cls}(?![\\w-])`).test(sel)) continue;
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
  assert.ok(bottomOverlay < bottomPanel, '遮罩要在面板下');
  assert.ok(bottomPanel < fsOverlay, 'fullscreen 必须盖住触发它的 bottom 卡(记忆详情→阅读原文那条路)');
  assert.ok(fsOverlay < fsPanel);
  assert.ok(fsPanel < elOverlay, 'elevated 必须高过 fullscreen —— 这就是六次「点了没反应」的解药');
  assert.ok(elOverlay < elPanel);
  assert.ok(elPanel < viewer, '看图器永远在最上层');
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
  ['components/portal/relationships/PersonExtractSheet.tsx', '洞察 → 关系 → 记给某人'],
  ['components/portal/relationships/RelationshipDetailSheet.tsx', '洞察 → 关系 → 关系详情'],
  ['components/portal/insights/SchedulePanel.tsx', '洞察 → 日程 → 日程详情'],
  ['components/portal/insights/TimelineTab.tsx', '洞察 → 时间线 → 到访记忆详情'],
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

// ── ⑤ 漂移检测:洞察子树里新写的层不许留在下面 ───────────────────────────
//
// 洞察面板本身是 fullscreen(929/930),它的所有 tab/子面板都活在里面。
// 这些文件里 portal 到 body 的浮层,只要 z 低于 elevated 档就会被盖住。

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
]);

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
const insightsFiles = walk('components/portal/insights').filter((f) => f.endsWith('.tsx'));
assert.ok(insightsFiles.length > 5, '洞察子树没扫到文件 —— 目录结构变了,这条测试失效了,要跟着改');

const offenders = [];
for (const file of insightsFiles) {
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
      offenders.push(`${file}: .${cls} 的 z-index=${z} < ${ELEVATED_FLOOR},会被洞察面板整个盖住`);
    }
  }
}

assert.deepEqual(offenders, [], [
  '',
  '洞察(fullscreen z-930)里有层没抬到 elevated 档 —— 这就是那六次「点了没反应」的形状:',
  ...offenders.map((o) => `  · ${o}`),
  '',
  '修法二选一:NesioSheet/MemoryNodeDetail 传 elevated;自研浮层把 z-index 提到 940 以上。',
  '确认不是 bug 的,加进本文件的 EXEMPT_CLASSES 并写明理由。',
].join('\n'));

console.log(`sheet-elevation: OK(洞察子树 ${insightsFiles.length} 个文件,零漏层)`);
