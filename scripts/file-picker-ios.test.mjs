/**
 * 行为契约:文件选择器在 iOS 上真的能弹起来(2026-08-01,用户「本地上传也没有实现」)。
 *
 * iOS 的 WKWebView 对**不参与布局**的 `<input type="file">` 会忽略程序化 `click()`。
 * 桌面 Chrome 照开 —— 所以本地怎么测都是好的,装到手机上就是
 * 「点『+』/『文件』完全没反应,也不报错」。没有报错、没有失败态,
 * 从用户那边看就等于「这个功能没实现」。
 *
 * 仓里为这件事栽过两次:
 *   · 第一次是首页输入条的「+」(today/CaptureBar.tsx,已修并留了注释);
 *   · 第二次是**问一问界面**的「+ → 文件 / 相册」—— 一个 display:none,
 *     一个干脆是 `document.createElement('input')` 之后直接 click(连 DOM 都没进)。
 *     修那次时顺手全仓扫了一遍,又找出 14 处同样写法。
 *
 * 判据是**正形式**的:被代码 click() 的 file input,只许用一份已知「留着布局盒子」的
 * 类名白名单(而且白名单里每个类名都会去 CSS 里现验一遍)。不写成「不许出现 display:none」
 * 是因为反向过滤永远列不全 —— `hidden` 属性、`visibility:hidden`、`width:0` 都是同一个坑。
 * 页面上让用户直接点的裸 input(如 lab 的模型文件选择)本来就在布局里,不在此列。
 *
 * 另外钉住两条同源的产品红线:
 *   · 通用文件入口不许设 accept 白名单(白名单永远会漏掉 PDF/docx/xlsx 这类常见格式,
 *     在 iOS 的文件选择器里它们直接是灰的 —— 连选都选不中);
 *   · 收不下和读不懂是两件事:读不出正文的文件必须**先存下来**,不许回一句「暂不支持」了事。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

const FILES = [...walk('components'), ...walk('app')];

/*
 * 「参与布局」的两种已知正确写法。**白名单而不是黑名单** ——
 * 反向去禁 display:none 永远列不全(hidden 属性 / visibility:hidden / width:0 是同一个坑),
 * 所以判据反过来:只认这几个类名,而且下面 ① 会去 CSS 里逐个验证它们确实留着盒子。
 * 想加第三种写法就得同时通过那道验证,加不了一个徒有其名的类。
 */
const SAFE_HIDDEN = ['nesio-visually-hidden', 'portal-avatar-file'];

// ── ① 白名单里的类名,确实都还留着布局盒子 ──────────────────────────────────
{
  const css = read('app/globals.css');
  for (const cls of SAFE_HIDDEN) {
    const at = css.indexOf(`.${cls} {`);
    assert.ok(at >= 0, `.${cls} 在 globals.css 里找不到 —— 白名单指向一个不存在的类等于没有判据`);
    const body = css.slice(at, css.indexOf('\n}', at));
    assert.doesNotMatch(body, /display:\s*none/,
      `.${cls} 用了 display:none —— 那就不再参与布局,iOS 上程序化 click() 会被忽略`);
    // 必须有非零尺寸。1px 就够(视觉上看不见,但盒子在)。
    assert.match(body, /width:\s*1px|height:\s*1px/,
      `.${cls} 没有留下 1px 的盒子 —— 「看不见」要靠 clip/opacity 做到,不能靠不渲染`);
  }
}

// ── ② 被程序化 click 的 file input,必须用白名单里的写法 ─────────────────────
{
  const offenders = [];
  let checked = 0;
  for (const f of FILES) {
    const src = read(f);
    for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) {
      const tag = m[0];
      if (!/type=["']file["']/.test(tag)) continue;
      // 只管**代码去 click() 它**的那些。页面上让用户直接点的裸 input
      // (如 lab 的模型文件选择)本来就在布局里,不在此列。
      const ref = tag.match(/ref=\{(\w+)\}/);
      if (!ref) continue;
      if (!new RegExp(`${ref[1]}\\.current\\??\\.?\\??\\.click\\(`).test(src)) continue;
      checked += 1;
      if (!SAFE_HIDDEN.some((c) => tag.includes(c))) {
        offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  // 正则没匹配上就会「零个违规」地绿掉 —— 先钉住确实扫到了东西。
  assert.ok(checked >= 25, `应扫到几十个程序化触发的 file input,实际只有 ${checked} —— 正则没匹配上就会假绿`);
  assert.deepEqual(offenders, [],
    `这些 file input 被代码 click(),却没用参与布局的隐藏写法:${offenders.join(', ')} —— ` +
    'iOS 的 WKWebView 会忽略不参与布局的 file input 的程序化 click(),' +
    '表现是「点了完全没反应、也不报错」。桌面 Chrome 测不出来。');
}

// ── ③ 不许再造脱离 DOM 的临时 picker ────────────────────────────────────────
{
  const offenders = [];
  for (const f of FILES) {
    // ⚠️ 必须剥注释再扫。这条判据第一版直接扫源码,于是**解释这个坑的那句注释**
    //    (里面照抄了 createElement('input'))被当成真代码抓了出来。
    //    扫源码找模式的契约不剥注释,迟早会把讲解自己的文字当成违规。
    const src = stripComments(read(f));
    // createElement('input') 之后设成 file 再 click —— 比 display:none 更彻底地不在布局里
    if (/createElement\(\s*['"]input['"]\s*\)/.test(src) && /type\s*=\s*['"]file['"]/.test(src)) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(', ')} 用 document.createElement 造了临时 file input —— ` +
    '那个元素从来没进过 DOM,iOS 上 click() 一定不响应。用页面里真实存在的 input。');
}

// ── ④ 两个通用文件入口不许设 accept 白名单 ─────────────────────────────────
{
  // 首页输入条:白名单在这里已经被明确废除(CAPTURE_ACCEPT = '')
  const cap = read('components/portal/today/CaptureBar.tsx');
  assert.match(cap, /export const CAPTURE_ACCEPT = ''/,
    'CaptureBar 的通用入口不许设 accept —— 白名单永远会漏掉某个常见类型');

  // 问一问的「+ → 文件」:那个 input 必须没有 accept 属性
  const chat = read('components/portal/NesioChatSheet.tsx');
  const chatFileInputs = [...chat.matchAll(/<input\b[\s\S]*?\/>/g)]
    .map((m) => m[0]).filter((t) => /type="file"/.test(t));
  assert.ok(chatFileInputs.length >= 2, `问一问里应有 2 个以上 file input,实际 ${chatFileInputs.length}`);
  const generic = chatFileInputs.filter((t) => /filePickerRef/.test(t));
  assert.equal(generic.length, 1, '问一问的通用文件 picker 应当只有一个(filePickerRef)');
  assert.doesNotMatch(generic[0], /\baccept=/,
    '问一问的「文件」入口不许设 accept —— 原来那份白名单把 PDF/docx/xlsx 全挡在外面,' +
    '在 iOS 文件选择器里它们直接是灰的,而这正是用户说的「本地上传没有实现」');
}

// ── ⑤ 读不懂 ≠ 收不下:非文本文件必须先落库,不许回「暂不支持」了事 ──────────
{
  const chat = read('components/portal/NesioChatSheet.tsx');
  // 正形式:非文本分支里真的调了本机存储 + 主事实表写入闸门
  const branch = chat.slice(chat.indexOf('if (!isText)'), chat.indexOf('if (!isText)') + 2600);
  assert.ok(branch.length > 100, '找不到非文本分支 —— 判据挂在这一段上,比错块就会假绿');
  assert.match(branch, /putLocalFile\(/, '非文本文件必须真的存进本机(local-file-store)');
  assert.match(branch, /ingestLifeNode\(/,
    '必须走 ingestLifeNode 进主事实表 —— 只存 Blob 不建节点的话,记忆里根本找不到它');
  assert.doesNotMatch(branch, /暂不支持|not supported yet/,
    '不许再用「暂不支持」把人打发走:首页的「+」早就能原样收下任意文件,' +
    '同一个 app 里两套能力,人在问一问这边传个 PDF 得到的就是「没实现」');
  // 失败态(红线:每个 async 动作都要有可见失败态)
  assert.match(branch, /没能存下来|Couldn't save/, '存不下必须说出来,不许静默');
}

console.log('file-picker-ios: OK(file input 参与布局 / 无临时 picker / 通用入口无白名单 / 读不懂也先收下)');
