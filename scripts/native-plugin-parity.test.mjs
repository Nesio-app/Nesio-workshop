/**
 * native-plugin-parity —— **JS 侧声明的每个原生插件,壳里都得真有。**
 *
 * ## 病灶(2026-07-31 拆 IPA 拆出来的)
 *
 * `lib/native/vision.ts` 取的是 `Capacitor.Plugins.Vision`,整轮「端上识别」都建在它上面。
 * 而真机壳(Nesioshellfix.ipa)里 `packageClassList` 只有三个:
 * NesioGeolocationPlugin / NesioLocalNotifyPlugin / NesioHealthKitPlugin —— **没有 Vision**,
 * 二进制里连 `VNRecognizeTextRequest` 的符号都搜不到。
 *
 * 表现:装上去,全站取图入口一律走「这台设备认不了字」,而 tsc 全绿、测试全绿、
 * 代码读起来完全正确。桥有,对面没有。
 *
 * 这不是第一次了 —— `NesioLocalNotify` 的 Swift 实现在 treasurebox-ios/ 里也不存在
 * (它是在另一个壳工程里写的)。所以判据不能只看仓里的 Swift 文件。
 *
 * ## 判据
 *
 * 维护一张**清单**:每个 JS 侧注册/取用的插件名 → 它在哪个壳里、有没有。
 * 清单是从真实 IPA 核出来的,不是从代码猜的。
 *
 * ① JS 侧新增一个插件而清单里没有 → 红。逼你去核一次「壳里到底有没有」。
 * ② 清单里标着 `inShell: false` 的,消费者**必须有可见的不可用分支** ——
 *    不能默默失败。用户得知道「这个版本的 App 没带这个」,而不是以为自己操作错了。
 * ③ 清单不许烂:标了 `swift` 路径的,那个文件得真在。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 从真实 IPA(Nesioshellfix.ipa,2026-07-31)的 capacitor.config.json `packageClassList`
 * 和二进制符号里核出来的。**改这张表之前先拆一次新壳**,别照着代码填。
 *
 * inShell=false 不代表「以后也没有」,代表「**现在装在手机上的那个壳**里没有」。
 */
const PLUGINS = [
  {
    js: 'NesioGeolocation',
    bridge: 'lib/portal/native-geolocation.ts',
    inShell: true,
    note: '壳类 NesioGeolocationPlugin;Info.plist 三条 Location 描述 + UIBackgroundModes:[location] 齐全。',
  },
  {
    js: 'NesioLocalNotify',
    bridge: 'lib/portal/native-local-notifications.ts',
    inShell: true,
    note: '壳类 NesioLocalNotifyPlugin。只有 checkPermissions/requestPermissions/schedule —— **没有 cancel**,'
      + '所以撤销走 tombstoneScheduled 那个 workaround。壳加了 cancel 之后把它换掉。',
  },
  {
    js: 'NesioHealthKit',
    bridge: 'lib/portal/native-healthkit.ts',
    inShell: true,
    note: '壳类 NesioHealthKitPlugin,链接了 HealthKit.framework;Info.plist 有 Share/Update 两条描述。',
  },
  {
    js: 'StoreKit',
    bridge: 'lib/portal/storekit-bridge.ts',
    inShell: false,
    note: '**这一版壳里没有**(二进制里 StoreKit/SKPayment 符号数为 0)。内购要等带 StoreKit 的壳;'
      + '桥现在返回 web_unavailable,UI 该据此显示「这个版本还不能购买」而不是转圈。',
  },
  {
    js: 'Vision',
    bridge: 'lib/native/vision.ts',
    inShell: false,
    note: '**这一版壳里没有**。packageClassList 里没有、二进制里搜不到 NesioVisionPlugin / VNRecognizeTextRequest。'
      + '整轮端上识别都建在它上面 —— 真机上会全线走 plugin_missing。要它就得重出一版带 Vision 的壳。',
  },
];

// ── ① JS 侧取用的插件名必须都在清单里 ──────────────────────────────────────
const declared = new Set(PLUGINS.map((p) => p.js));
const found = new Map();

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    const rel = path.relative(ROOT, p);
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    // 两种取法都要认:registerPlugin('X') 和 Capacitor.Plugins.X
    for (const m of src.matchAll(/registerPlugin<[^>]*>\(\s*['"]([A-Za-z0-9_]+)['"]/g)) found.set(m[1], rel);
    for (const m of src.matchAll(/registerPlugin\(\s*['"]([A-Za-z0-9_]+)['"]/g)) found.set(m[1], rel);
    for (const m of src.matchAll(/Plugins\??\.\s*([A-Z][A-Za-z0-9_]*)/g)) found.set(m[1], rel);
  }
}
walk(path.join(ROOT, 'lib'));
walk(path.join(ROOT, 'components'));

assert.ok(found.size > 0, '一个原生插件取用点都没扫到 —— 判据坏了,这道守卫会永远绿着');

const unlisted = [...found.keys()].filter((n) => !declared.has(n)).sort();
assert.deepEqual(
  unlisted, [],
  `这些原生插件在 JS 里用了,但不在清单里:${unlisted.map((n) => `${n}(${found.get(n)})`).join(', ')}\n`
  + '  → 加进 scripts/native-plugin-parity.test.mjs 的 PLUGINS,并**先拆一次真实 IPA**\n'
  + '    确认壳里到底有没有(看 capacitor.config.json 的 packageClassList + 二进制符号)。\n'
  + '    照着代码填「应该有吧」正是 Vision 那次的犯法方式。',
);

// ── ② 壳里没有的,消费者必须有可见的不可用分支 ──────────────────────────────
// 「这个版本的 App 没带这个功能」和「你操作错了」是两回事。静默失败会让用户一直重试。
for (const p of PLUGINS.filter((x) => !x.inShell)) {
  const src = stripComments(read(p.bridge));
  // ⚠️ 判据必须是**具体的原因码**,不能是「出现了 unavailable 这个词」那种泛匹配 ——
  //    泛匹配会被文案里碰巧出现的一个词满足(第一版就是这么假绿的:
  //    把三个原因码全删掉,中文文案里的「没带」还在,断言照过)。
  assert.match(
    src, /['"`](plugin_missing|web_unavailable|not_native)['"`]/,
    `${p.bridge} 对应的插件**不在当前壳里**,但这个桥没有可见的不可用原因。\n`
    + `  → 用户拿到的会是「什么都没发生」。至少要能区分「这版 App 没带」和「这次没成功」。\n`
    + `  清单备注:${p.note}`,
  );
}

// ── ③ 清单里标的桥文件必须真在 ────────────────────────────────────────────
const missingBridge = PLUGINS.filter((p) => !fs.existsSync(path.join(ROOT, p.bridge))).map((p) => p.bridge);
assert.deepEqual(missingBridge, [], `清单里这些桥文件不存在了:${missingBridge.join(', ')}`);

// ── ④ 备注不许空 —— 这张表的价值全在「为什么」上 ──────────────────────────
const noNote = PLUGINS.filter((p) => !p.note || p.note.trim().length < 15).map((p) => p.js);
assert.deepEqual(noNote, [], `清单里这些条目没写备注:${noNote.join(', ')}`);

const inShell = PLUGINS.filter((p) => p.inShell).length;
console.log(
  `native-plugin-parity: OK(${PLUGINS.length} 个插件在册 · 壳里有 ${inShell} 个 · `
  + `缺 ${PLUGINS.length - inShell} 个都有可见的不可用分支)`,
);
