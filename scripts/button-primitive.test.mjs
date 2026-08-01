/**
 * 行为契约:Button 原语(components/portal/ui/Button.tsx,2026-07-29)。
 *
 * 这条测试存在的理由,和 SegTabs / NesioSheet 那两条一样:
 * **没有原语的地方,每个板块都会自己长一套。**
 * 建这个组件之前全站至少有七八套按钮(nesio-ob-primary-btn / nesio-camera-save-btn /
 * nesio-fin-review-accept / nesio-proactive-action-btn …),各自决定圆角、字号、内边距,
 * 于是同一屏里两个按钮长得不像一家 —— 用户原话「整体都不统一」。
 *
 * 更要命的是:设计系统 _adherence.oxlintrc.json 里**早就写好了 <Button> 的契约**
 * (variant/size/tone/pill/full/disabled/iconLeft/iconRight),但代码里没有这个组件,
 * 规则一直在等一个不存在的东西。所以第一条断言钉的就是「规则和实现对得上」——
 * 哪天有人给 Button 加了个规则里没有的 prop,eslint 会当场报错而不是默默放行。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = stripComments;

const SRC = code(read('components/portal/ui/Button.tsx'));
const CSS = read('app/globals.css');

// ── ① 实现必须和设计系统声明的契约完全对上 ───────────────────────────────────
{
  const rules = JSON.parse(read('design-system/nesio/_adherence.oxlintrc.json'));
  const msgs = rules.rules['no-restricted-syntax'].slice(1).map((r) => r.message);

  const propsMsg = msgs.find((m) => m.startsWith('<Button> doesn’t accept') || m.includes('<Button> doesn'));
  assert.ok(propsMsg, '设计系统里 <Button> 的 prop 契约不见了');
  // 从规则里把声明的 prop 名抠出来,逐个确认组件真的接
  const declared = (/Declared props:\s*([^.]+)\./.exec(propsMsg)?.[1] || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(declared.length >= 8, `没解析出 prop 清单:${propsMsg}`);
  // disabled / className / style / key / ref 是 React/HTML 内建的,由 ButtonHTMLAttributes 带进来;
  // 组件只需要**显式声明**设计系统特有的那几个。
  const INHERITED = new Set(['disabled', 'className', 'style', 'key', 'ref', 'children']);
  assert.ok(
    /extends Omit<ButtonHTMLAttributes<HTMLButtonElement>/.test(SRC),
    'Button 没有继承 ButtonHTMLAttributes —— disabled / aria-* / onClick 这些会全丢',
  );
  for (const p of declared) {
    if (INHERITED.has(p)) continue;
    assert.ok(
      new RegExp(`^\\s*(?:/\\*\\*[\\s\\S]*?)?\\s*${p}\\?:`, 'm').test(SRC),
      `设计系统声明了 <Button> 的 ${p},但组件的 props 里没有 —— 规则会一直在等一个不存在的 prop`,
    );
  }

  // 三组枚举值也要一字不差(规则用的正则和实现里的联合类型必须同源)
  for (const [kind, expected] of [
    ['variant', ['primary', 'secondary', 'soft', 'ghost']],
    ['size', ['sm', 'md', 'lg']],
    ['tone', ['brand', 'risk']],
  ]) {
    const msg = msgs.find((m) => m.includes(`<Button> ${kind} must be`));
    assert.ok(msg, `设计系统里 <Button> 的 ${kind} 枚举规则不见了`);
    for (const v of expected) {
      assert.ok(msg.includes(`'${v}'`), `设计系统的 ${kind} 枚举里少了 ${v}`);
      assert.ok(SRC.includes(`'${v}'`), `Button.tsx 的 ${kind} 联合类型里少了 ${v}`);
    }
  }
}

// ── ② 每个变体 × 每个尺寸都得有样式,不能渲染成裸按钮 ─────────────────────────
{
  // 允许选择器分组:旧类(如 .nesio-ob-primary-btn)会被挂到同一批声明上做桥接,
  // 那时选择器长这样 `.nesio-btn--lg,\n.nesio-ob-primary-btn {` —— 只认独占一行会假红。
  const hasRule = (cls) => new RegExp(`\\${cls}\\s*[,{]`).test(CSS);
  for (const v of ['primary', 'secondary', 'soft', 'ghost']) {
    assert.ok(hasRule(`.nesio-btn--${v}`), `变体 ${v} 没有样式 —— 会渲染成浏览器默认按钮`);
  }
  for (const s of ['sm', 'md', 'lg']) {
    assert.ok(hasRule(`.nesio-btn--${s}`), `尺寸 ${s} 没有样式`);
  }
  assert.ok(CSS.includes('.nesio-btn--risk.nesio-btn--primary'), 'risk 语气没有样式');
}

// ── ③ 尺寸和颜色一律走 token(这正是「不统一」的病根)───────────────────────
{
  const at = CSS.search(/\n\.nesio-btn[,{ ]/);
  assert.ok(at > 0, 'Button 基础样式不见了');
  const block = CSS.slice(at, CSS.indexOf('/* ══', at + 10) > 0 ? CSS.indexOf('/* ══', at + 10) : at + 4000);
  // 三档尺寸的字号必须是 token —— 写死 rem 就是「两个挨着的按钮差一截」的来源
  for (const s of ['sm', 'md', 'lg']) {
    const m = new RegExp(`\\.nesio-btn--${s}[,\\s][^{]*\\{[^}]*font-size:\\s*var\\(--text-`).test(block);
    assert.ok(m, `尺寸 ${s} 的字号没走 --text-* token`);
  }
  // 颜色必须从当前皮肤派生,不许写死
  const colorBlock = block.slice(block.indexOf('.nesio-btn--primary'));
  assert.ok(/var\(--portal-accent\)/.test(colorBlock), '主按钮底色没跟随皮肤强调色');
  assert.ok(
    !/#[0-9a-fA-F]{6}/.test(colorBlock.replace(/var\([^)]*,\s*#[0-9a-fA-F]{3,8}\)/g, '')),
    'Button 的变体样式里出现了写死色值 —— 换皮肤时按钮不会跟着变',
  );
}

// ── ④ 无障碍与手感:禁用态、按下反馈、减少动效 ───────────────────────────────
{
  // 要带花括号:只搜 '.nesio-btn:disabled' 会被下面那条
  // `.nesio-btn:disabled:active { transform: none }` 喂饱(变异测试抓到的)。
  assert.ok(/\.nesio-btn:disabled[,\s][^{]*\{/.test(CSS), '禁用态没有样式 —— 看不出按钮不能点');
  assert.ok(/\.nesio-btn:active[,\s]/.test(CSS), '没有按下反馈');
  assert.ok(
    /prefers-reduced-motion[\s\S]{0,220}\.nesio-btn:active \{ transform: none/.test(CSS),
    '按下的缩放没有尊重「减少动态效果」',
  );
}

// ── ⑤ 已经迁过来的调用点不许退回自造按钮 ─────────────────────────────────────
// 相机那一对是这次的样板(用户拍了照片报的就是它们):主按钮和次按钮挨着,
// 以前各写各的尺寸,肉眼可见一高一矮。
{
  const cam = code(read('components/portal/CameraSheet.tsx'));
  assert.ok(/from '\.\/ui\/Button'/.test(cam), 'CameraSheet 没有引 Button 原语');
  assert.ok(/<Button variant="secondary" onClick=\{retake\}/.test(cam), '「重拍」又变回自造按钮了');
  assert.ok(
    !/className="nesio-camera-save-btn"/.test(cam) && !/className="nesio-camera-retake-btn"/.test(cam),
    '相机的保存/重拍又用回了自己那套类 —— 两个按钮会重新长歪',
  );

  // 桥接的终点是**换标签**:调用点换成 <Button>,旧类只剩布局职责(或者干脆消失)。
  // 这一批走完全程的两处 —— 它们的旧类已经从原语的选择器组里摘掉了,
  // 谁把 <Button> 换回 <button className="nesio-settings-…"> 就当场没样式。
  {
    const st = code(read('components/portal/SettingsSheets.tsx'));
    assert.ok(/from '\.\/ui\/Button'/.test(st), '设置页没有引 Button 原语');
    assert.ok(
      !/<button[^>]*className="nesio-settings-(action|danger)-btn/.test(st),
      '设置页的备份/导出/删除又变回自造按钮了 —— 那两个类已经不在原语的分组里,会渲染成裸按钮',
    );
    assert.ok(
      /<Button variant="soft" size="md" tone="risk" full/.test(st),
      '「清除所有 Memory / 删除账号」丢了 risk 语气 —— 破坏性动作必须看得出来',
    );
    // 反过来也钉住:那两个旧类**只准**剩间距。哪天有人往里加回 background/font-size,
    // 就等于在原语之外又开了一份外观。
    for (const cls of ['.nesio-settings-action-btn', '.nesio-settings-danger-btn']) {
      const at = CSS.search(new RegExp(`\\n\\${cls} \\{`));
      assert.ok(at > 0, `${cls} 的间距规则不见了`);
      const own = CSS.slice(at, CSS.indexOf('}', at));
      assert.ok(
        /^\s*[\n.a-z-]*\{?\s*margin-top:[^;]+;\s*$/.test(own.slice(own.indexOf('{') + 1)),
        `${cls} 又不止管间距了 —— 它现在只该有 margin-top:${own}`,
      );
    }
  }
  {
    const nd = code(read('components/portal/MemoryNodeDetail.tsx'));
    assert.ok(
      !/<button[^>]*className="nesio-(ob-primary|today|settings-danger)-btn[^"]*nesio-nd-action-btn/.test(nd),
      '记忆详情底部那一排又拆回三套自造按钮了 —— 那正是「按钮大小形状不统一」的原始现场',
    );
    // 载体从 className="nesio-nd-action-btn" 换成 layoutStyle={{ flex: 1 }}:
    // 那个类名原来把外观也盖了一遍(假迁移),现在只剩「这一行等宽」这一条布局职责。
    // 2026-08-01:这一排统一加了 size="sm"(用户「样子一样,缩小」),
    // 所以 variant 和 layoutStyle 之间会隔着它 —— 正则放宽到「中间可以有别的属性」,
    // 压的仍然是「三档语气都在、布局走 layoutStyle」这两件事。
    for (const v of ['variant="primary"', 'variant="secondary"', 'variant="soft" size="sm" tone="risk"']) {
      assert.ok(
        new RegExp(`<Button ${v}[^>]*layoutStyle=\\{\\{ flex: 1 \\}\\}`).test(nd),
        `记忆详情底部那排少了 <Button ${v} layoutStyle={{ flex: 1 }}> —— 阅读/编辑/删除三档语气要分得开`,
      );
    }
  }
}

// ── ⑥ .nesio-glass:液态玻璃在 WKWebView 上真能生效的那部分 ──────────────────
// 用户问过能不能引 liquid-glass-react。不能:它的核心(SVG feDisplacementMap 折射)
// WebKit 不支持,而 IPA 里跑的正是 WKWebView。这个类给的是**真能出效果**的三件事。
{
  const at = CSS.indexOf('.nesio-glass {');
  assert.ok(at > 0, '.nesio-glass 不见了');
  const blk = CSS.slice(at, CSS.indexOf('}', at));
  // Safari 至今要 -webkit- 前缀,少了这行在 iOS 上就是**完全没有模糊**
  assert.ok(
    /-webkit-backdrop-filter:\s*blur/.test(blk),
    '.nesio-glass 少了 -webkit-backdrop-filter —— iOS(也就是你的 IPA)上一点模糊都不会有',
  );
  assert.ok(/backdrop-filter:\s*blur/.test(blk), '.nesio-glass 少了标准 backdrop-filter');
  // 提饱和是玻璃感的另一半:只模糊不提饱和,底下的颜色会发灰
  assert.ok(/saturate\(/.test(blk), '.nesio-glass 只剩模糊没有提饱和 —— 玻璃底下的颜色会发灰发脏');
  // 内描边高光 = 玻璃的厚度感。它走 --glass-highlight token(昼夜两套值),不是写死的
  assert.ok(/var\(--glass-highlight\)/.test(blk), '.nesio-glass 少了内描边高光 —— 会退化成普通毛玻璃');
  assert.ok(
    /--glass-highlight:\s*inset/.test(CSS),
    '--glass-highlight 不再是 inset 高光了',
  );
  // 行首锚定:夜间那条 `html[...] .nesio-glass::before` 含同样的子串,
  // 只用 includes 会被它喂饱(变异测试抓到的)。
  assert.ok(/\n\.nesio-glass::before \{/.test(CSS), '.nesio-glass 少了顶部镜面反光');
  // 低电量/减少透明度时必须退成实底 —— 满屏 backdrop-filter 在 iOS 上会明显掉帧
  assert.ok(
    /prefers-reduced-transparency[\s\S]{0,400}backdrop-filter: none/.test(CSS),
    '.nesio-glass 没有降级路径 —— 低电量模式下满屏模糊会掉帧',
  );
  // 颜色跟皮肤走
  assert.ok(/background:\s*var\(--glass-bg-/.test(blk), '.nesio-glass 的底色没走 token');
}

// ── ⑦ 旧类桥接:最大的一套自造主按钮已并到原语的声明上 ──────────────────────
// .nesio-ob-primary-btn 有 41 处调用,一次改 41 处 JSX 风险大;
// 先把它挂到 Button 原语**同一批声明**上(CSS 选择器分组),值从此只有一处、
// 视觉立刻统一、零回归。调用点之后一批批换成 <Button>,换完再删这个类名。
{
  // 每个旧类要挂到哪几组声明上。桥接一个就在这里记一笔 —— 解开会当场红。
  const BRIDGED = {
    '.nesio-ob-primary-btn': ['.nesio-btn--primary', '.nesio-btn--lg', '.nesio-btn--pill', '.nesio-btn--full'],
    '.nesio-rel-log-btn': ['.nesio-btn--soft', '.nesio-btn--sm', '.nesio-btn--pill'],
    '.nesio-today-btn': ['.nesio-btn--md', '.nesio-btn--pill'],
    '.nesio-proactive-action-btn': ['.nesio-btn--secondary', '.nesio-btn--sm', '.nesio-btn--pill'],
    '.nesio-ob-auth-btn': ['.nesio-btn--secondary', '.nesio-btn--lg', '.nesio-btn--full'],
    '.nesio-ob-skip-btn': ['.nesio-btn--ghost', '.nesio-btn--sm', '.nesio-btn--full'],
    '.nesio-type-action-btn': ['.nesio-btn--soft', '.nesio-btn--sm', '.nesio-btn--pill'],
    '.nesio-collapsed-act-btn': ['.nesio-btn--soft', '.nesio-btn--sm', '.nesio-btn--pill'],
    '.nesio-exp-cancel-btn': ['.nesio-btn--secondary', '.nesio-btn--md'],
  };
  for (const [old, sels] of Object.entries(BRIDGED)) {
    for (const sel of sels) {
      // 选择器组里可能夹着别的类名,所以只要求「sel 之后、下一个 { 之前」出现这个旧类
      const at = CSS.indexOf(`${sel},`);
      const at2 = at < 0 ? CSS.indexOf(`${sel} {`) : at;
      assert.ok(at2 > 0, `${sel} 这组声明不见了`);
      const selectorList = CSS.slice(at2, CSS.indexOf('{', at2));
      assert.ok(
        selectorList.includes(old),
        `${old} 没有和 ${sel} 共用声明 —— 那批按钮会和原语重新分叉`,
      );
    }
  }
  // ── 引用的 --portal-* 必须都有定义 ──────────────────────────────────────
  // 2026-07-29 扫出来 8 个名字(--portal-border/-text/-surface/-hairline/
  // -card-bg/-green/-text-secondary/-on-accent)全站 35 处在用,却**从来没定义过**,
  // 一直在吃后面的 fallback。后果是静默的:那些边框和文字既不跟昼夜也不跟皮肤,
  // 而且因为有 fallback 页面看着「正常」,没人会发现。这条断言让它不可能再发生。
  {
    const used = new Set([...CSS.matchAll(/var\((--portal-[a-z0-9-]+)[,)]/g)].map((m) => m[1]));
    const defined = new Set([...CSS.matchAll(/^\s*(--portal-[a-z0-9-]+):/gm)].map((m) => m[1]));
    const ghosts = [...used].filter((t) => !defined.has(t)).sort();
    assert.equal(
      ghosts.length, 0,
      `这些 --portal-* token 被引用却从没定义过,只会永远吃 fallback(不跟主题、不跟皮肤):\n  ${ghosts.join('\n  ')}\n`
      + '  在 :root, .portal-root 里给它们一个映射(别名到已有 token)即可。',
    );
  }
  // ── 旧类自己那块只该剩布局职责,而且**位置也算数** ────────────────────────
  // 桥接是靠选择器分组做的,同权重下**文件里靠后的赢**。旧类的自有声明大多写在
  // 原语那一段之前(几千行之前),所以它再写一遍 padding/background 不是「又分叉了」,
  // 是**那行根本不生效** —— 改了没反应,比分叉更难查。这一批就踩到过:
  // .nesio-ob-skip-btn 的 muted 文字色写在原地,被后面的 .nesio-btn--ghost 分组顶掉,
  // 「跳过」会跟「继续」一样是强调色。真正要保留的差异得写在原语之后。
  const PRIM_AT = CSS.search(/\n\.nesio-btn,/);
  assert.ok(PRIM_AT > 0, 'Button 原语那一段不见了');
  const GEOMETRY = ['font-size', 'padding', 'background', 'border-radius', 'width', 'color'];
  // 只查**裸类名**那条(权重 0,1,0,和原语分组一模一样,靠位置分胜负)。
  // `:active` / `:hover` / `:disabled` 是 0,2,0,压得住分组,那些留给各自的旧类自己管。
  for (const old of Object.keys(BRIDGED)) {
    const own = new RegExp(`^\\${old}\\s*\\{([^}]*)\\}`, 'gm');
    for (const m of CSS.matchAll(own)) {
      if (m.index > PRIM_AT) continue;            // 写在原语之后 = 有意的覆盖,放行
      for (const forbidden of GEOMETRY) {
        assert.ok(
          !new RegExp(`(^|;)\\s*${forbidden}:`).test(m[1]),
          `${old} 在原语之前(第 ~${CSS.slice(0, m.index).split('\n').length} 行)又写了 ${forbidden} —— `
          + '同权重下后面的原语分组会把它顶掉,这行不生效。要保留的差异请写到原语那一段之后。',
        );
      }
    }
  }
  // 夜间覆盖同理,而且更隐蔽:它权重比原语高(0,2,0),写死的 hex 会把跟皮肤走的 token
  // 顶掉,而页面看着「有夜间色」所以没人会怀疑(.nesio-type-action-btn 的 #93c5fd、
  // .nesio-today-btn--ghost 的 #8fa3c0 都是这么潜伏下来的)。修饰类(--ghost/--primary)
  // 一并算进来 —— 它们是同一个按钮的另一半。
  for (const old of Object.keys(BRIDGED)) {
    const night = new RegExp(`(html\\[data-portal-theme[^{]*\\${old}[a-z0-9-]*[^{]*)\\{([^}]*)\\}`, 'g');
    for (const m of CSS.matchAll(night)) {
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b/.test(m[2].replace(/var\([^)]*,\s*#[0-9a-fA-F]{3,8}\)/g, '')),
        `这条夜间覆盖写死了色值,换皮肤时这个按钮不会跟着变:\n    ${m[1].trim()}`,
      );
    }
  }
  // 投影也得跟皮肤走(原来写死 rgba(88,140,227,.35),灰粉皮肤下是蓝影子配陶红按钮)
  const shadowAt = CSS.search(/\n\.nesio-ob-primary-btn \{/);
  assert.ok(shadowAt > 0, '.nesio-ob-primary-btn 的自有声明块不见了');
  assert.ok(
    !/rgba\(88, ?140, ?227/.test(CSS.slice(shadowAt, CSS.indexOf('}', shadowAt))),
    '.nesio-ob-primary-btn 的投影又写死品牌蓝了',
  );

  // ── 挂在 <Button> 上的板块类名:只准放布局 ────────────────────────────────
  //
  // 这里原来是一条**反过来**的断言:要求 .nesio-nd-action-btn 排在原语之后,
  // 好「压住」原语的 padding/radius/font。那等于把假迁移写进契约保护起来 ——
  // 调用点写着 <Button variant="primary">,类名里却又把 height/padding/border-radius/
  // font-size/font-weight 盖了一遍,原语等于没用上,「同一屏两个按钮长得不像一家」照旧。
  //
  // 现在的规矩:板块类名可以留(动画钩子/测试选择器要用),但**只准放布局**。
  // 外观一律 variant/size/tone。
  const APPEARANCE = /\b(background|background-color|color|border|border-color|border-radius|font-size|font-weight|font-family|padding|box-shadow|opacity)\s*:/;
  for (const cls of ['nesio-nd-action-btn', 'nesio-settings-action-btn', 'nesio-settings-danger-btn']) {
    const at = CSS.search(new RegExp(`\\n\\.${cls}[ ,{]`));
    if (at < 0) continue;   // 类名被删掉是更好的结局,不算违规
    const body = CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('}', at));
    const bad = body.split(';').map((s) => s.trim()).filter((s) => APPEARANCE.test(s));
    assert.deepEqual(
      bad, [],
      `.${cls} 挂在 <Button> 上,却自己写了外观:${bad.join(' / ')}\n`
      + '  → 那就是假迁移:原语定一套、类名盖一套,等于把 <Button> 当带额外步骤的 <button> 用。\n'
      + '    外观走 variant/size/tone;这里只留布局(margin/flex/width…)。',
    );
  }

  // ── md/lg 必须够得着最小触摸目标 ──────────────────────────────────────────
  // 设计系统声明了 --tap-min: 44px,站内别处都在守。原语自己不守时 md 只有 ~36px,
  // 于是每个板块各自补一个 height:46px —— 这正是迁移一直不敢动的原因之一:
  // 换成原语反而缩水成点不中的目标。
  assert.match(
    CSS, /\.nesio-btn--md,?\s*\n?\.nesio-btn--lg\s*\{[^}]*min-height:\s*var\(--tap-min/,
    'Button 原语的 md/lg 没有 min-height: var(--tap-min) —— 按内容算只有 ~36px,'
    + '低于设计系统第 142 行自己声明的 44px。板块只好各自补 height,迁移就永远做不干净。',
  );
}

// ── 出口只有一个,而且是窄的 ──────────────────────────────────────────────────
//
// layoutStyle 如果类型是 CSSProperties,那 213 个裸按钮里那 ~249 处外观
// (color/background/border/fontSize/borderRadius…)会原样从新口子漏过去,
// 迁移就只是把 <button> 改名叫 <Button>。所以:宽口封掉、窄口是白名单。
{
  assert.match(
    SRC, /Omit<ButtonHTMLAttributes<HTMLButtonElement>,\s*'children'\s*\|\s*'style'>/,
    'ButtonProps 又把 style 放进来了 —— 有了它,layoutStyle 白名单形同虚设:'
    + '外观直接从 style 塞进去就行。宽口必须封死,只留 layoutStyle。',
  );

  const wl = SRC.slice(SRC.indexOf('ButtonLayoutStyle = Pick<CSSProperties'));
  const wlBody = wl.slice(0, wl.indexOf('>;'));
  assert.ok(wlBody.length > 100, 'ButtonLayoutStyle 白名单没找到 —— 窄口不见了');
  const LEAKED = ['background', 'backgroundColor', 'color', 'border', 'borderRadius',
    'fontSize', 'fontWeight', 'fontFamily', 'boxShadow', 'opacity', 'padding'];
  const leaks = LEAKED.filter((k) => new RegExp(`'${k}'`).test(wlBody));
  assert.deepEqual(
    leaks, [],
    `ButtonLayoutStyle 白名单里混进了外观属性:${leaks.join(', ')}\n`
    + '  → 加字段前先问:它决定的是按钮**长什么样**,还是按钮**在哪**?\n'
    + '    长什么样的一律不加 —— 那正是这个白名单要挡住的。',
  );
}

console.log('button-primitive: OK(契约对得上 · 变体齐 · 走 token · 有禁用/按下态 · 相机已迁)');
