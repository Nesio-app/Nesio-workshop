/**
 * 设计系统棘轮 —— 写死的尺寸/颜色**只减不增**(2026-07-29)。
 *
 * 背景:用户说「整体都不统一」。查下来病根不是审美,是**没有唯一的写值处**:
 * 字号 254 处、间距 360 处、圆角 13 处、色值 67 处直接写在组件的 inline style 里,
 * 绕过了 design-system 的 token。于是两个挨着的按钮一个 0.78rem 一个 0.8rem、
 * 一个 padding 0.5 一个 0.55 —— 单看都合理,并排就是歪的。
 *
 * 为什么用棘轮而不是「一次清干净」:
 *   · 694 处一轮改不完,硬改必然出回归;
 *   · 只挂 eslint warning 等于没挂 —— 几百条警告没人会看,新增的一条淹在里面。
 * 棘轮把「不能更糟」变成 CI 能判的事:存量慢慢还,但**任何新代码都别想再加一处**。
 * 每清理一批就把下面的基线调低,数字只能往下走。
 *
 * 判据和 .eslintrc.json 里那几条 no-restricted-syntax 是同一套(编辑器里给提示,
 * 这里给 CI 一道闸)。加新规则时两边一起改。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url);

/**
 * 当前基线。**只能调低,不能调高。**
 * 清理完一批就把对应数字改成新的实际值 —— 那一刻棘轮就卡在更严的位置上了。
 */
const BASELINE = {
  fontSize: 13,
  spacing: 14,
  radius: 42,
  hex: 27,
  rawButton: 193,
};

/*
 * 2026-07-31(三次):间距 571→16。**两件事一起发生,别把它们混着读。**
 *
 * ① **量具修好了**:原来的正则是 `\b(?:padding|margin|gap):`,要求属性名后面**紧跟冒号**
 *    —— 于是 `paddingTop:` / `marginBottom:` / `rowGap:` 这些方向变体**从来没被数进来**。
 *    旧读数 323 只是真实违规的一小半;同一时刻用修好的正则去量,是 571。
 * ② **清理**:571 → 16,按 4px 网格就近吸附(规则见下)。
 *
 * 吸附规则(代码级、可重跑,和字号那次同一套):把声明按空白拆成分量逐个吸,
 * 每个分量找最近的一档,**漂移超过 0.125rem(2px)就不吸**。2px 是这里的正确上限 ——
 * 网格步长就是 4px,「吸到最近格点」的最大漂移按定义是半格。字号那次用 1px 是因为
 * 字号档位密;间距只有 4px 一档,用 1px 会把 0.6/0.4/0.35/0.9(共 264 处,正好卡在
 * 两个格点中间)永久留在场上,基线就再也下不去了。
 *
 * 两条附加规则,都是为了不改变**语义**而不只是数值:
 *   · 一条声明里只要有一个分量吸不动,整条不改 —— 半吸会留下
 *     `'var(--space-1) 0.6rem'` 这种混合串,既没减少写死值又更难读。
 *   · **非零的间距不许吸成 0**。`0.1rem` 是 1.6px 的发丝缝,吸到 0 不是漂移,
 *     是「这里本来有条缝」变成「没有缝」。
 *
 * 留下的 16 处,每一处都是上面规则挡住的,不是漏网:
 *   发丝值 0.05/0.1/0.12rem(吸到 0 会让缝消失)· 负间距 -0.35rem(有意的拉回)
 *   · 和 `2px`/`6px`/`auto`/`env()`/`calc()` 混在一个串里的(拼不出纯 token 串)
 *   · `1.75rem`(离 --space-6 和 --space-8 各 4px,正中间,吸哪边都是人来定)。
 *
 * 2026-07-31(二次):字号 164→13、圆角 66→42。**按值就近吸附到设计系统档位**,
 * 规则是代码级的、可重跑的,不靠看图:每个写死值找最近的一档,**漂移超过 0.06rem
 * (≈1px)就不吸**,原样留下。
 *
 * 留下来没吸的 13 处字号:0.6(×4) 1.15(×3) 1.4(×2) 1.7 2.0 —— 它们离最近档位
 * 都超过 1px,吸过去是**真的改变视觉**,那需要你看着定,不是机械替换能决定的。
 * 圆角同理留下 24 处(多为 2/4/5/10/11/14px 这类小值,和 8/12/16 档不对齐)。
 *
 * 2026-07-31:字号 231→164 —— 把和现有 token **完全相等**的写死值(0.75/0.68/0.85/0.95…)
 * 换成 token,零视觉变化。剩下的 164 处是 0.72/0.7/0.78/0.82 这类**没有精确对应档**的,
 * 换过去会改变字号,得一屏一屏看着改,不能批量。
 *
 * 2026-07-30:字号 254→231、间距 360→323、圆角 67→66、色值 28→27。
 * 棘轮卡到当前实际值 —— 之前几轮清理没同步调基线,等于白留了一截空间给新违规。
 * (色值那一处是这轮把 --accent-info 的废弃蓝换成 token 清掉的。)
 */

/*
 * 2026-07-29:字号 252→254、间距 358→360、圆角 66→67、色值 24→28。**这一次的上调不是放宽标准,是量具修好了。**
 *
 * 这份脚本原来自带一行剥注释的正则,它把字符串里的「斜杠星号」也当成注释起点 ——
 * NesioChatSheet.tsx 里一句 accept = image 斜杠星号 让它一路吃掉 10086 个字符,
 * 那段代码里的写死值(2 个字号 + 2 个间距 + 1 个圆角 + 4 个色值,共 9 处)从来没被数进来。换成 scripts/lib/strip-comments.mjs
 * 之后它们现身了。数字变大是**读数变准**,不是有人新写了违规。
 *
 * 这是唯一一次允许调高。往后只能往下走。
 */

/** 和 .eslintrc.json 同源的判据(那边管编辑器提示,这边管 CI)。 */
const CHECKS = [
  { key: 'fontSize', re: /\bfontSize:\s*'[0-9.]+(rem|px|em)'/g, what: '写死的字号', fix: 'var(--text-xs/sm/body/h3/h2/h1/display)' },
  // ⚠️ 方向变体必须一起数:原来只写 `padding|margin|gap:`,于是 `paddingTop`/`marginBottom`
  // 这些**根本没被数进来**(它们后面不是冒号)—— 这次清理的 663 处里大半是方向变体,
  // 也就是说旧读数 323 只是全部违规的一小半。量具补上了,基线按新读数重卡。
  { key: 'spacing', re: /\b(?:padding|margin|gap|rowGap|columnGap)(?:Top|Bottom|Left|Right|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?:\s*'[^']*[0-9.]+rem[^']*'/g, what: '写死的间距', fix: 'var(--space-1..16)(4px 网格)' },
  { key: 'radius', re: /\bborderRadius:\s*(?:'[0-9.]+(?:rem|px|em)?'|[0-9]+)/g, what: '写死的圆角', fix: 'var(--radius-sm/md/xl/pill)' },
  // 先摘掉 var(--x, #fallback) 这种兜底(全站惯例,不算硬编码),剩下的才是真写死。
  /**
   * 绕过 Button 原语的裸 <button>。**一个文件一个文件地还,新代码别再加一个。**
   *
   * 2026-07-31:213 → 193。原语开了 `layoutStyle` 窄口(布局留在外面、外观进原语)
   * 之后,第一个迁的是 WardrobePanel(20 → 4)。
   *
   * 迁移的验收标准不是「<button> 变成 <Button>」,是:
   *   · 外观参数化成 variant/size/tone —— 板块自造的样式常量该删掉,不是搬进 className;
   *   · 只有布局走 layoutStyle(类型白名单挡着,写外观是编译错误);
   *   · 手搓的禁用态(`opacity: busy ? 0.6 : 1`)换成 `disabled` —— 原语 :disabled 已经有。
   * WardrobePanel 里 outfitActionBtn / linkish / chip 三个自造样式常量因此全删了,
   * 它们分别就是 soft / ghost / (primary|secondary)+sm。
   *
   * 剩下的 4 处**不是漏网**:照片投放区 ×2(虚线框,里面填满一张 img)、衣物网格瓦片、
   * 日历日格 —— 都是「可点的图块」,不是按钮。塞进按钮原语反而是错的。
   * 往后每个文件都会有这么几处,棘轮的地板不会是 0。
   */
  { key: 'rawButton', re: /<button[^>]*\sstyle=\{/gs, what: '绕过 Button 原语的裸按钮', fix: "components/portal/ui/Button.tsx 的 <Button variant=...>" },
  { key: 'hex', re: /#[0-9a-fA-F]{6}\b/g, what: '写死的色值', fix: 'var(--portal-*/--status-*/--viz-*)', strip: (s) => s.replace(/var\([^)]*,\s*#[0-9a-fA-F]{3,8}\)/g, '') },
];

/** ui/ 下是原语本身 —— 它就是那个「唯一写值的地方」,不该被自己的规则挡住。 */
const EXEMPT = /^components\/portal\/ui\//;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !EXEMPT.test(rel)) out.push(rel);
  }
  return out;
}

const files = walk('components');
const counts = Object.fromEntries(CHECKS.map((c) => [c.key, 0]));
const worst = Object.fromEntries(CHECKS.map((c) => [c.key, new Map()]));

for (const rel of files) {
  const raw = fs.readFileSync(new URL(rel, ROOT), 'utf8')

  for (const c of CHECKS) {
    const src = c.strip ? c.strip(raw) : raw;
    const n = (src.match(c.re) || []).length;
    if (n) {
      counts[c.key] += n;
      worst[c.key].set(rel, n);
    }
  }
}

let failed = false;
for (const c of CHECKS) {
  const now = counts[c.key];
  const base = BASELINE[c.key];
  if (now > base) {
    failed = true;
    const top = [...worst[c.key].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([f, n]) => `      ${n.toString().padStart(3)}  ${path.basename(f)}`).join('\n');
    console.error(
      `\n  ✗ ${c.what}:${now} 处,比基线 ${base} 多了 ${now - base}。\n`
      + `    新代码不许再写死 —— 用 ${c.fix}。\n`
      + `    (如果你**清理**了一批导致数字变化,把 scripts/design-token-ratchet.test.mjs 里的基线调低即可,\n`
      + `     但绝不能调高:那等于把棘轮往回拧。)\n`
      + `    当前最多的几个文件:\n${top}`,
    );
  } else if (now < base) {
    console.log(`  ↓ ${c.what}:${now} 处(基线 ${base},已清理 ${base - now} 处)—— 记得把基线调到 ${now}`);
  }
}
assert.ok(!failed, '设计系统棘轮被往回拧了 —— 详见上面的清单');

// 原语必须存在,否则这条棘轮就成了「只许挡、不给替代品」
for (const p of ['components/portal/ui/Button.tsx', 'components/portal/ui/SegTabs.tsx', 'components/portal/ui/NesioSheet.tsx']) {
  assert.ok(fs.existsSync(new URL(p, ROOT)), `原语 ${p} 不见了 —— 挡住写死值却不给替代品,只会逼人绕过规则`);
}

console.log(`design-token-ratchet: OK(字号 ${counts.fontSize} · 间距 ${counts.spacing} · 圆角 ${counts.radius} · 色值 ${counts.hex},均未超基线)`);
