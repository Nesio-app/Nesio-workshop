/**
 * native-plugin-parity —— **JS 侧声明的每个原生插件,得真有对面。**
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
 * ## 两个「有」不是一回事(这一版加的)
 *
 * 补完 iOS 工程之后又冒出第二种失败,比上面那种更隐蔽:
 * **Swift 文件写好了、躺在仓里,但没登记进 `project.pbxproj` 的 Sources 编译清单。**
 * 后果是它根本没被编译进去 —— 装上的 App 照常跑,只有那个功能永远「这版没带」,
 * 而 Xcode 不会有任何警告(它压根不知道有这么个文件)。
 *
 * 所以清单分两列:
 *
 *   · `inProject`  —— 源码在不在**这份仓里的 iOS 工程**(而且真的进了编译清单)
 *   · `inShipped`  —— **现在装在手机上的那个壳**里有没有
 *
 * 前者这道守卫**能自己验**(文件在不在 + pbxproj 里登记没登记),所以它是硬断言。
 * 后者静态验不了(要拆 IPA),所以它是一张**要手工维护的事实表** ——
 * 出了新壳、装上了,才把 `inShipped` 改成 true。
 *
 * ## 判据
 *
 * ① JS 侧新增一个插件而清单里没有 → 红。逼你去核一次「对面到底有没有」。
 * ② `inShipped: false` 的,消费者**必须有可见的不可用分支** —— 不能默默失败。
 * ②c JS `addListener` 的每个事件名,清单备注里必须交代过。
 * ③ `inProject: true` 的,Swift 文件必须在,而且必须进了 pbxproj 的 Sources。
 * ④ 清单里标的桥文件必须真在;备注不许空。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PBXPROJ = 'treasurebox-ios/ios/App/App.xcodeproj/project.pbxproj';
const SWIFT_DIR = 'treasurebox-ios/ios/App/App';

/**
 * `inShipped` 是从真实 IPA(Nesioshellfix.ipa,2026-07-31)的
 * `capacitor.config.json` packageClassList 和二进制符号里核出来的。
 * **改这一列之前先拆一次新壳**,别照着代码填 —— 照着代码填正是 Vision 那次的犯法方式。
 */
const PLUGINS = [
  {
    js: 'NesioGeolocation',
    bridge: 'lib/portal/native-geolocation.ts',
    swift: 'NesioGeolocationPlugin.swift',
    inProject: true,
    inShipped: true,
    note: '壳类 NesioGeolocationPlugin;Info.plist 三条 Location 描述 + UIBackgroundModes:[location] 齐全。'
      + '⚠️ **老壳的事件通道是断的**:它有 startTrailWatch/stopTrailWatch/trailWatching、也确实起了 '
      + 'startMonitoringSignificantLocationChanges + startMonitoringVisits,但二进制里 `trailPoint` 出现 0 次 —— '
      + '而 JS 侧 addListener("trailPoint") 就等着它。所以 startTrailWatch 返回 ok(UI 显示「足迹监听已开」),'
      + '点却一个都回不来。这就是「位置后台一直收集还不管用」。'
      + '仓里这一版补上了 notifyListeners("trailPoint", …),另外加了 drainTrailPoints() —— '
      + 'App 被系统唤醒时 WebView 常常还没起来,事件发出去没人接,所以原生侧同时攒一份队列,'
      + '回前台一次性取走。**装上新壳之后这条才真的通**。',
  },
  {
    js: 'NesioLocalNotify',
    bridge: 'lib/portal/native-local-notifications.ts',
    swift: 'NesioLocalNotifyPlugin.swift',
    inProject: true,
    inShipped: true,
    note: '壳类 NesioLocalNotifyPlugin。**老壳只有 checkPermissions/requestPermissions/schedule** —— '
      + '没有 cancel,所以撤销走 tombstoneScheduled 那个 workaround(同 id 重排到十年后,'
      + '占着 64 条 pending 配额里的一格)。仓里这一版补了 cancel/cancelAll/listPending/scheduleAt;'
      + 'JS 侧 tombstoneScheduled 会先探 cancel,探不到才写墓碑,所以两代壳都能跑。',
  },
  {
    js: 'NesioHealthKit',
    bridge: 'lib/portal/native-healthkit.ts',
    swift: 'NesioHealthKitPlugin.swift',
    inProject: true,
    inShipped: true,
    note: '壳类 NesioHealthKitPlugin,链接 HealthKit.framework;Info.plist 有 Share/Update 两条描述。'
      + '老壳出参是算好的 HealthMetric[](fetchMetrics);仓里这一版改成 fetchSamples —— '
      + '只把样本按 Apple 导出的 <Record> 形状原样倒出来,单位换算/多设备去重/脏值丢弃/睡眠区间合并 '
      + '全部留在 JS 的同一个解析器里,一份规则两个入口。JS 侧两条路都探,老壳照样能跑。'
      + '⚠️ **HealthKit 是这里唯一要 entitlement 的能力** —— 免费 Apple ID 签名(Sideloadly)拿不到,'
      + '那种构建里它会如实返回不可用。',
  },
  {
    js: 'Vision',
    bridge: 'lib/native/vision.ts',
    swift: 'NesioVisionPlugin.swift',
    inProject: true,
    inShipped: false,
    note: '**现在手机上那版壳里没有**(packageClassList 里没有、二进制里搜不到 '
      + 'NesioVisionPlugin / VNRecognizeTextRequest)。整轮端上识别都建在它上面 —— '
      + '真机上会全线走 plugin_missing。仓里的工程有 Swift 源码(jsName = "Vision",'
      + 'usesLanguageCorrection = false —— 票据要照抄不要通顺),出一版新壳就点亮。',
  },
  {
    js: 'SpeechRecognition',
    bridge: 'lib/native/speech.ts',
    swift: 'NesioSpeechPlugin.swift',
    inProject: true,
    inShipped: false,
    note: '**现在手机上那版壳里没有**。它补的是一个被关掉的功能:iOS 的 WKWebView 里 '
      + 'Web SpeechRecognition 根本不存在,所以今天页那个话筒以前每次点都失败;'
      + '上一轮的处理是「探不到引擎就不摆这个话筒」。仓里这一版用 SFSpeechRecognizer + '
      + 'requiresOnDeviceRecognition = true(录音不出手机;端上模型不支持某语言时**返回不可用而不是退回云端**)。'
      + '事件三个,Swift 里都有 notifyListeners:partial(边说边出的临时结果)/ result(一段说完)/ '
      + 'error(一定会发 —— 静默停下来是这个功能以前最大的毛病)。'
      + 'Info.plist 要 NSSpeechRecognitionUsageDescription。',
  },
  {
    js: 'Spotlight',
    bridge: 'lib/native/spotlight.ts',
    swift: 'NesioSpotlightPlugin.swift',
    inProject: true,
    inShipped: false,
    note: '**现在手机上那版壳里没有**。Core Spotlight 把记忆索引进 iOS 系统搜索,'
      + '点搜索结果 deep link 回 nesio://memory/<id>(AppDelegate 里接 CSSearchableItemActionType)。'
      + '不要权限、不要 entitlement。隐私上默认关、只送标题不送正文、敏感类型(化验单/财务/证件)'
      + '一律不索引、关开关时必须真清干净 —— 索引进去的内容会离开沙箱交给系统搜索库,'
      + '锁屏搜索和 Siri 建议都可能显示出来。无事件。',
  },
  {
    js: 'StoreKit',
    bridge: 'lib/portal/storekit-bridge.ts',
    swift: null,
    inProject: false,
    inShipped: false,
    note: '**两边都没有,而且是故意的** —— 内购不做(你定的)。'
      + '桥保持返回 web_unavailable,UI 该据此显示「这个版本还不能购买」而不是转圈。',
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
  + '  → 加进 scripts/native-plugin-parity.test.mjs 的 PLUGINS,并说清两件事:\n'
  + '    inProject(仓里的 iOS 工程有没有这个 Swift 插件)\n'
  + '    inShipped(**现在装在手机上的那个壳**里有没有 —— 这一列要拆 IPA 核,别照着代码填)',
);

// ── ② 装机的壳里没有的,消费者必须有可见的不可用分支 ────────────────────────
// 「这个版本的 App 没带这个功能」和「你操作错了」是两回事。静默失败会让用户一直重试。
for (const p of PLUGINS.filter((x) => !x.inShipped)) {
  const src = stripComments(read(p.bridge));
  // ⚠️ 判据必须是**具体的原因码**,不能是「出现了 unavailable 这个词」那种泛匹配 ——
  //    泛匹配会被文案里碰巧出现的一个词满足(第一版就是这么假绿的:
  //    把三个原因码全删掉,中文文案里的「没带」还在,断言照过)。
  assert.match(
    src, /['"`](plugin_missing|web_unavailable|not_native)['"`]/,
    `${p.bridge} 对应的插件**不在装机的那个壳里**,但这个桥没有可见的不可用原因。\n`
    + `  → 用户拿到的会是「什么都没发生」。至少要能区分「这版 App 没带」和「这次没成功」。\n`
    + `  清单备注:${p.note}`,
  );
}

// ── ②c 事件通道:JS addListener 的事件名,必须在清单备注里被交代过 ──────────────
//
// 方法名对得上**不代表**通道通。NesioGeolocation 就是这么坏的:
// startTrailWatch 有、返回 ok,但壳从不 notifyListeners("trailPoint"),
// 于是 UI 一路显示「足迹监听已开」,而一个点都没进来过 —— 比整个插件缺失更难查,
// 因为每一层看起来都成功了。
//
// 静态没法验证壳到底发不发某个事件(那要真机跑),所以这里只钉一件事:
// **每个 addListener 的事件名都得在清单备注里出现过** —— 逼你核一次,
// 而不是写完 addListener 就当它通了。
const listened = new Map();
for (const p of PLUGINS) {
  const src = stripComments(read(p.bridge));
  for (const m of src.matchAll(/addListener\(\s*['"]([A-Za-z0-9_]+)['"]/g)) listened.set(m[1], p);
  // 把事件名写成联合类型的(`event: 'partial' | 'result' | 'error'`)也要认,
  // 否则换个写法就绕过了这道判据。
  for (const m of src.matchAll(/addListener\(\s*\n?\s*event:\s*([^,)]+)/g)) {
    for (const q of m[1].matchAll(/'([A-Za-z0-9_]+)'/g)) listened.set(q[1], p);
  }
}
const uncheckedEvents = [...listened.entries()]
  .filter(([ev, p]) => !p.note.includes(ev))
  .map(([ev, p]) => `${ev}(${p.bridge})`);
assert.deepEqual(
  uncheckedEvents, [],
  `这些事件 JS 在监听,但清单备注里没交代对面发不发:${uncheckedEvents.join(', ')}\n`
  + '  → 去 Swift 里确认有 notifyListeners("<事件名>", …),把结论写进对应插件的 note。\n'
  + '    方法名对得上不代表通道通 —— trailPoint 就是这么断了还一路显示「已开启」的。',
);

// ── ③ inProject 的:Swift 文件要在,而且要进 pbxproj 的 Sources ──────────────
//
// 这是这一版新加的那道。**只有文件在是不够的** ——
// 没登记进编译清单的 .swift 根本不会被编译,而 Xcode 一声不吭。
// 装上的 App 照常跑,只有那个功能永远「这版没带」,构建却全绿。
const pbx = fs.existsSync(path.join(ROOT, PBXPROJ)) ? read(PBXPROJ) : '';
assert.ok(pbx.length > 0, `${PBXPROJ} 读不到 —— 这道守卫验不了编译清单,等于失效`);

/**
 * 只取 `PBXSourcesBuildPhase` 那一段来判。
 *
 * ⚠️ **不能全文搜 `"<文件名> in Sources"`** —— 第一版就是这么写的,反证当场翻车:
 * 那个串在 `PBXBuildFile` 的**声明行**里也有一份
 * (`AE… /* X.swift in Sources *\/ = {isa = PBXBuildFile; …}`)。
 * 于是把文件从编译阶段摘掉,声明还在,断言照过 —— 判据恒绿。
 *
 * 「声明了一个编译产物」和「把它排进了编译阶段」是两件事,
 * 而正是后者决定这个 .swift 会不会真的被编译。判据必须落在后者上。
 */
const sourcesPhase = (() => {
  const start = pbx.indexOf('/* Begin PBXSourcesBuildPhase section */');
  const end = pbx.indexOf('/* End PBXSourcesBuildPhase section */');
  return start >= 0 && end > start ? pbx.slice(start, end) : '';
})();
assert.ok(
  sourcesPhase.length > 0,
  `${PBXPROJ} 里找不到 PBXSourcesBuildPhase 段 —— 判据坏了,这道守卫会永远绿着`,
);
assert.ok(
  sourcesPhase.includes('AppDelegate.swift in Sources'),
  'PBXSourcesBuildPhase 段里连 AppDelegate 都没有 —— 段落切歪了,判据不可信',
);

for (const p of PLUGINS.filter((x) => x.inProject)) {
  const rel = `${SWIFT_DIR}/${p.swift}`;
  assert.ok(
    fs.existsSync(path.join(ROOT, rel)),
    `清单说 ${p.js} 的 Swift 在仓里,但 ${rel} 不存在。\n`
    + '  → 要么补上文件,要么把 inProject 改成 false(并说清为什么)。',
  );
  assert.ok(
    sourcesPhase.includes(`${p.swift} in Sources`),
    `${p.swift} 在仓里,但**没排进 ${PBXPROJ} 的 PBXSourcesBuildPhase**。\n`
    + '  → 它不会被编译进 App。装上去之后那个功能永远是「这版没带」,而构建全绿 —— \n'
    + '    这正是这道断言存在的理由。四处登记缺一不可:PBXBuildFile + PBXFileReference\n'
    + '    + PBXGroup children + **PBXSourcesBuildPhase files**(最后这处最容易漏)。',
  );
}

// ── ③c Swift 文件必须**被 git 跟踪** ──────────────────────────────────────
//
// 第三种失败,而且它真的发生了:`.gitignore` 里有一条 `ios/`(本意是「Capacitor
// 生成的原生工程不入库」),它把 `treasurebox-ios/ios/` 也一起吞了。
//
// 目录里几个老文件是历史上 force-add 进来的,所以 `git status` 看得见它们的改动 ——
// 一切看起来正常。而**新加的文件一律被静默忽略**:
// 写了五个插件、改好 pbxproj、测试全绿,`git status` 上一个新文件都没有。
// 提交推上去,CI 拉下来编译,出的包里五个插件一个都没有,整条流水线全绿。
//
// 更早的证据:`NesioVisionPlugin.swift` **从来就没被提交过** —— 它只活在工作区里。
// 这也解释了为什么那个壳一直没有 Vision。
//
// 「文件在磁盘上」和「文件在仓里」是两件事,而 CI 只看得见后者。
let tracked = new Set();
try {
  const out = execFileSync('git', ['ls-files', '-z', SWIFT_DIR], { cwd: ROOT, encoding: 'utf8' });
  tracked = new Set(out.split('\0').filter(Boolean));
} catch {
  // 不在 git 工作区里(比如从 tarball 解出来跑)——跳过这道,别把无关环境判红。
  tracked = null;
}
if (tracked) {
  const untracked = PLUGINS
    .filter((p) => p.inProject && !tracked.has(`${SWIFT_DIR}/${p.swift}`))
    .map((p) => p.swift);
  assert.deepEqual(
    untracked, [],
    `这些插件的 Swift **没被 git 跟踪**:${untracked.join(', ')}\n`
    + '  → 它们只活在你的工作区里。CI 拉下来的仓里没有,编译出的包里也就没有 ——\n'
    + '    而构建会全绿。先看一眼 .gitignore(那条 `ios/` 会吞掉整个原生工程),\n'
    + '    再 `git add` 上去。',
  );
}

// ── ④ 桥文件要在;备注不许空 —— 这张表的价值全在「为什么」上 ────────────────
const missingBridge = PLUGINS.filter((p) => !fs.existsSync(path.join(ROOT, p.bridge))).map((p) => p.bridge);
assert.deepEqual(missingBridge, [], `清单里这些桥文件不存在了:${missingBridge.join(', ')}`);

const noNote = PLUGINS.filter((p) => !p.note || p.note.trim().length < 15).map((p) => p.js);
assert.deepEqual(noNote, [], `清单里这些条目没写备注:${noNote.join(', ')}`);

const inProject = PLUGINS.filter((p) => p.inProject).length;
const inShipped = PLUGINS.filter((p) => p.inShipped).length;
console.log(
  `native-plugin-parity: OK(${PLUGINS.length} 个插件在册 · 仓里工程有 ${inProject} 个(都进了编译清单)· `
  + `装机的壳里有 ${inShipped} 个 · 差的 ${PLUGINS.length - inShipped} 个都有可见的不可用分支)`,
);
