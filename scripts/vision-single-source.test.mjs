/**
 * vision-single-source —— 端上识别只能有**一个**判据,而且它不许比真相乐观。
 *
 * ## 病灶
 *
 * 「这台设备能不能认字」这一件事,仓里曾经有两个说法:
 *
 *   · `lib/native/vision.ts` —— 真桥。对面是 Capacitor 插件 `Vision`
 *     (treasurebox-ios/.../NesioVisionPlugin.swift,VNRecognizeTextRequest)。
 *     它**故意没有 web 分支**:端上不可用 → 明说 + 引导手填,绝不改走云。
 *   · `lib/portal/platform-capabilities.ts` 的 `vision()` —— 能力汇总用的同步快照。
 *     它原来写着「有 WebGPU 就是 'web',浏览器内 ML(transformers.js/MediaPipe)」,
 *     而**那个实现从来不存在**。
 *
 * 后果不是「少个功能」,是任何有 WebGPU 的浏览器上,能力汇总报 `vision: 'web'`,
 * 真去调 `recognizeOnDevice()` 拿到的却是 `not_native`。谁信了汇总去排功能可用性,
 * 就会排出一条根本走不通的路 —— 而且从代码上看两边都「写得挺对」。
 *
 * ## 这道守卫管什么
 *
 * ① 快照不许比真桥乐观:`vision()` 说 'web',真桥就得真有 web 路径。
 * ② 真桥不许偷偷改走云 —— 化验单是病历,发票上是税号和金额。
 * ③ 两头的插件名必须对得上(JS 找 `Plugins.Vision`,Swift 得 `jsName = "Vision"`)。
 *    这条最阴:名字错一个字,真机上就是「这个版本没带端上识别」,而代码全绿。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripComments(read(rel));

const CAPS = code('lib/portal/platform-capabilities.ts');
const BRIDGE = code('lib/native/vision.ts');

// ── ① 快照不许比真桥乐观 ────────────────────────────────────────────────────
const visionFn = (CAPS.match(/export function vision\(\)[\s\S]*?\n\}/) || [''])[0];
assert.ok(visionFn, 'platform-capabilities 里找不到 vision() 了');

const claimsWeb = /return 'web'/.test(visionFn);
// 真桥有没有 web 路径:它是否在非原生环境下还能识别。
// 现在的实现是 `if (!cap?.isNativePlatform?.()) return { available: false, reason: 'not_native' }`。
const bridgeHasWeb = !/reason:\s*'not_native'/.test(BRIDGE);
assert.ok(
  !claimsWeb || bridgeHasWeb,
  'platform-capabilities 的 vision() 报了 \'web\',但 lib/native/vision.ts 在非原生环境直接返回 not_native。\n'
  + '  → 能力汇总会说「浏览器能认字」,真去调却认不了。这不是少个功能,是排出一条走不通的路。\n'
  + '    要么把 web 实现真做出来(走 Rust→WASM,别用 Tesseract.js),要么这里老实返回 none。',
);

// ── ② 真桥不许偷偷改走云 ────────────────────────────────────────────────────
assert.ok(
  !/fetch\(\s*['"`]\/api\//.test(BRIDGE),
  'lib/native/vision.ts 打了云接口 —— 端上不可用时的正解是「明说 + 引导手填」,\n'
  + '  不是换条路把图发出去。化验单是病历,发票上是税号和金额。',
);
assert.match(
  BRIDGE, /not_native/,
  '真桥少了 not_native 这个原因 —— 「网页版没有端上识别」和「这张图没认出字」\n'
  + '  混成一句,用户就不知道该换设备还是该重拍。',
);

// ── ③ 两头的插件名必须对得上 ────────────────────────────────────────────────
// 这条最阴:名字错一个字,真机上就是「这个版本没带端上识别」,而 tsc / 测试全绿。
const jsKeys = [...BRIDGE.matchAll(/Plugins\?\.([A-Za-z]+)/g)].map((m) => m[1]);
assert.ok(jsKeys.length > 0, '真桥里找不到 Capacitor.Plugins.<名字> 的取用');
const jsName = jsKeys[0];

const SWIFT = 'treasurebox-ios/ios/App/App/NesioVisionPlugin.swift';
if (fs.existsSync(path.join(ROOT, SWIFT))) {
  const swift = read(SWIFT);
  const m = /let jsName\s*=\s*"([A-Za-z]+)"/.exec(swift);
  assert.ok(m, `${SWIFT} 里没有 jsName —— Capacitor 桥不上,JS 那头永远是 plugin_missing`);
  assert.strictEqual(
    m[1], jsName,
    `插件名两头对不上:JS 找 Plugins.${jsName},Swift 声明 jsName = "${m[1]}"。\n`
    + '  → 真机上表现为「这个版本的 App 还没带端上识别」,而代码全绿、tsc 也过。',
  );
  // 识别器本身得是真的,不是占位
  assert.match(
    swift, /VNRecognizeTextRequest/,
    'Swift 插件没在用 VNRecognizeTextRequest —— 那 isAvailable 返回 true 就是骗人的',
  );
}

// ── ④ 消费者必须先探能力再识别 ──────────────────────────────────────────────
// 直接调 recognizeOnDevice 也不会出错(它内部自己会探),但 UI 就没机会
// 在按钮层面区分「这台设备认不了字」和「这张图没认出来」。
const consumers = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) {
      const s = stripComments(fs.readFileSync(p, 'utf8'));
      if (/recognizeOnDevice\s*\(/.test(s)) consumers.push([path.relative(ROOT, p), s]);
    }
  }
}
walk(path.join(ROOT, 'components'));
assert.ok(consumers.length > 0, '端上识别一个消费者都没有 —— 桥和插件都写好了却点不到');
const noProbe = consumers.filter(([, s]) => !/visionAvailability\s*\(\)/.test(s)).map(([f]) => f);
assert.deepEqual(
  noProbe, [],
  `这些地方直接识别、没先探能力:${noProbe.join(', ')}\n`
  + '  → 探不到时要在按钮层面就说「这台设备认不了字」,而不是让人拍完了才被告知。',
);

console.log(`vision-single-source: OK(判据唯一 · 不走云 · 插件名两头对上(${jsName}) · ${consumers.length} 个消费者都先探能力)`);
