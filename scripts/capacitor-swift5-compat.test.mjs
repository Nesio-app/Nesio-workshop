/**
 * capacitor-swift5-compat —— **别再用那些在 Xcode 15 上不存在的 Capacitor API。**
 *
 * ## 病灶(2026-07-31 本地打包实测)
 *
 * Capacitor 8.4.0 通过 `capacitor-swift-pm` 发的是**预编译 xcframework**,不是源码。
 * 它的 `.swiftinterface` 里一百多处声明包在:
 *
 *     #if compiler(>=5.3) && $NonescapableTypes
 *
 * `$NonescapableTypes` 是 **Swift 6.0 才有**的编译器特性。用 Swift 5.9
 * (Xcode 15.x)消费它,条件为假,那批声明对编译器**根本不存在**。
 *
 * 被藏掉的正好是最常用的那几个:
 *
 *   · `CAPPluginCall.reject(...)` —— 整份接口里只有这一个 reject
 *   · 所有**单参数**取值器:`getString(key)` / `getInt(key)` / `getBool(key)` /
 *     `getDouble(key)` / `getArray(key)` —— 只剩必须给默认值的双参数版
 *
 * 症状是一堆看起来毫不相干的错(reject has no member、
 * missing argument for parameter #2、闭包类型推断失败……),**全是同一个根因**。
 *
 * ## 为什么要一道守卫而不是「记得就行」
 *
 * 这类错**不会**在这个仓里被任何检查发现:tsc 管不着 Swift,
 * 契约测试也不编译 Swift。要等到有人在 Mac 上跑 xcodebuild 才会炸,
 * 而那通常是「我要出个包」的时候 —— 最不想被拦住的那一刻。
 *
 * ## 判据
 *
 * ① 六个插件里不许出现 `call.reject(`
 * ② 不许出现单参数取值器
 * ③ Vision 的失败必须带 `ok: false` —— 因为 JS 侧靠它区分成败(见下)
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const SWIFT_DIR = path.join(ROOT, 'treasurebox-ios/ios/App/App');

const files = fs.existsSync(SWIFT_DIR)
  ? fs.readdirSync(SWIFT_DIR).filter((f) => f.endsWith('Plugin.swift'))
  : [];
assert.ok(files.length >= 6, `插件 Swift 只扫到 ${files.length} 个 —— 判据大概率失效`);

// Swift 没有块注释以外的复杂情况,这里只剥 // 行注释和 /* */ 块 ——
// 不剥的话这个文件里到处在讲 `call.reject`,讲解本身会把判据判红。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── ① reject ──────────────────────────────────────────────────────────────
const rejects = [];
// ── ② 单参数取值器 ────────────────────────────────────────────────────────
const oneArg = [];

for (const f of files) {
  const src = strip(fs.readFileSync(path.join(SWIFT_DIR, f), 'utf8'));
  for (const m of src.matchAll(/call\.reject\s*\(/g)) rejects.push(f);
  for (const m of src.matchAll(/call\.get(?:String|Int|Double|Bool|Array|Object)\(\s*"[^"]*"\s*\)/g)) {
    oneArg.push(`${f}: ${m[0]}`);
  }
}

assert.deepEqual(
  [...new Set(rejects)], [],
  `这些插件用了 call.reject —— **在 Xcode 15 上编不过**:${[...new Set(rejects)].join(', ')}\n`
  + '  → 换成 call.resolve(["ok": false, "reason": "…", "message": "…"])。\n'
  + '    失败路径一条都不用删,reason code 原样保留,只是走 resolve 出去。\n'
  + '    ⚠️ 改了原生就**必须同步改 JS 侧**:reject 会触发 catch,resolve 不会 ——\n'
  + '      不改的话「识别失败」会静默变成「这张图上没有字」。',
);

assert.deepEqual(
  oneArg, [],
  `这些是**单参数**取值器 —— 在 Xcode 15 上不存在(只剩双参数版):\n  ${oneArg.join('\n  ')}\n`
  + '  → 给个显式默认值:call.getInt("days", 30)。\n'
  + '    要区分「没传」和「传了默认值」时用哨兵(id 用 -1、时间戳用 0),\n'
  + '    别偷偷把「没传」当成一个合法值 —— 那会把参数缺失变成静默的错误行为。\n'
  + '    数组更麻烦(双参数版是泛型的,推断容易翻):直接读 call.options["key"]。',
);

// ── ③ Vision 的成败标志:原生和 JS 两侧必须对得上 ──────────────────────────
//
// 这一条是整件事里最容易出人命的地方。原生从 reject 改成 resolve 之后,
// 如果 JS 侧还在靠 try/catch 判失败,那么**失败会被当成成功**:
// catch 不触发,text 是 undefined,String(undefined || '') 得到空串,
// 于是「识别失败,请重拍」变成「这张图上没有字」。
// 两者对用户是完全不同的下一步 —— 一个该重试,一个该手填。
const vision = strip(fs.readFileSync(path.join(SWIFT_DIR, 'NesioVisionPlugin.swift'), 'utf8'));
assert.match(
  vision, /"ok":\s*false/,
  'NesioVisionPlugin 的失败路径没有带 "ok": false —— JS 侧靠它区分成败,少了就分不出来',
);
assert.match(
  vision, /"ok":\s*true/,
  'NesioVisionPlugin 的成功路径没有带 "ok": true —— 只有失败带标志的话,JS 判不了「这次到底成没成」',
);

const visionTs = fs.readFileSync(path.join(ROOT, 'lib/native/vision.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.match(
  visionTs, /\.ok\s*===\s*false/,
  'lib/native/vision.ts 没有判 `ok === false` —— 原生失败现在走 resolve 不走 reject,\n'
  + '  catch 接不到。不判这一句的话失败会静默变成「这张图上没有字」。',
);

console.log(
  `capacitor-swift5-compat: OK(${files.length} 个插件 · 无 reject · 无单参数取值器 · `
  + 'Vision 成败标志两侧对得上)',
);
