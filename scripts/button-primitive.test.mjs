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

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
  for (const v of ['primary', 'secondary', 'soft', 'ghost']) {
    assert.ok(CSS.includes(`.nesio-btn--${v} {`), `变体 ${v} 没有样式 —— 会渲染成浏览器默认按钮`);
  }
  for (const s of ['sm', 'md', 'lg']) {
    assert.ok(CSS.includes(`.nesio-btn--${s} {`), `尺寸 ${s} 没有样式`);
  }
  assert.ok(CSS.includes('.nesio-btn--risk.nesio-btn--primary'), 'risk 语气没有样式');
}

// ── ③ 尺寸和颜色一律走 token(这正是「不统一」的病根)───────────────────────
{
  const at = CSS.indexOf('.nesio-btn {');
  assert.ok(at > 0, 'Button 基础样式不见了');
  const block = CSS.slice(at, CSS.indexOf('/* ══', at + 10) > 0 ? CSS.indexOf('/* ══', at + 10) : at + 4000);
  // 三档尺寸的字号必须是 token —— 写死 rem 就是「两个挨着的按钮差一截」的来源
  for (const s of ['sm', 'md', 'lg']) {
    const m = new RegExp(`\\.nesio-btn--${s} \\{[^}]*font-size:\\s*var\\(--text-`).test(block);
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
  assert.ok(/\.nesio-btn:disabled \{/.test(CSS), '禁用态没有样式 —— 看不出按钮不能点');
  assert.ok(CSS.includes('.nesio-btn:active'), '没有按下反馈');
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
}

console.log('button-primitive: OK(契约对得上 · 变体齐 · 走 token · 有禁用/按下态 · 相机已迁)');
