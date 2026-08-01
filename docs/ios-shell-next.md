# 出一版新壳:六个插件 + Sideloadly 装机

**基线**:`Nesioshellfix.ipa`(2026-07-31 拆过)。这份文档是它的**替代方案**,不是愿望单 ——
下面说的每一条,Swift 都已经在 `treasurebox-ios/ios/App/App/` 里了。

---

## 先说一件必须先知道的事

**`treasurebox-ios/` 这份工程,原来不是你手机上那个壳的来源。** 三条证据:

| | 仓里的工程(改之前) | 手机上的 IPA |
|---|---|---|
| appId | `com.jiuxiao.treasurebox` | `app.nesio.ios` |
| 插件 | 只有 `NesioVisionPlugin` | Geolocation / LocalNotify / HealthKit,**没有** Vision |
| 加载方式 | `webDir: 'www'`(本地打包) | `server.url`(远程加载) |

所以直接拿老工程出包 = 出一个**别的 App**:bundle id 不同不会覆盖安装,而且会
**丢掉**定位、通知、健康这三个现在能用的功能。

这一轮把工程补成了那个 IPA 的等价物 **+ 三个新能力**,六个插件齐活:

| 插件 | 状态 | 这一轮做了什么 |
|---|---|---|
| `NesioGeolocation` | 补写 | **修好了 `trailPoint`** —— 见下面 ① |
| `NesioLocalNotify` | 补写 | 加 `cancel` / `cancelAll` / `listPending` / `scheduleAt` |
| `NesioHealthKit` | 补写 | 改成 `fetchSamples`(薄壳,规则留 JS) |
| `Vision` | 已有 | 不动。终于能被编译进包了 |
| `SpeechRecognition` | **新** | 端上语音,`requiresOnDeviceRecognition` |
| `Spotlight` | **新** | Core Spotlight 系统搜索 |

守卫 `scripts/native-plugin-parity.test.mjs` 现在盯两件事:Swift 文件在不在、
**有没有排进 pbxproj 的编译阶段**。第二条是新加的 —— 文件躺在仓里但没进编译清单,
App 照常跑、构建全绿,只有那个功能永远「这版没带」。

---

## ① `trailPoint` —— 「位置后台一直收集还不管用」的真正原因

老壳里 `startTrailWatch` / `stopTrailWatch` / `trailWatching` 全都有,
`startMonitoringSignificantLocationChanges` 和 `startMonitoringVisits` 也真的起了。
但二进制里 **`trailPoint` 出现 0 次**。

也就是说:系统在往 delegate 里送点,delegate 收下了,然后**谁也没通知**。
而 JS 侧挂的正是 `addListener('trailPoint', …)` —— 它一直在等一个永远不会来的事件。
`startTrailWatch()` 又老老实实返回 `{ok: true}`,于是 UI 一路显示「足迹监听已开」。

**每一层看起来都成功了,只有数据没有。** 这比插件整个缺失难查得多。

新插件补了两条路,两条都要:

- `notifyListeners("trailPoint", …)` —— 前台时事件即时到
- `drainTrailPoints()` + `UserDefaults` 队列 —— App 被系统唤醒时 WebView 常常还没起来,
  事件发出去没人接,点就丢了。而**真正的后台足迹恰恰全是这种点**。
  所以原生侧同时攒一份(上限 200),JS 回前台一次性取走,取完即清。

顺带确认一件事:`allowsBackgroundLocationUpdates` **故意没设**。
它是给 `startUpdatingLocation` 连续定位用的,那会一直吃电、状态栏一直挂蓝条。
足迹要的是「你今天去过哪」(500m 粒度),significant change + visits 正合适,
而且**系统会为它们唤醒 App**,不需要那个属性。

---

## ② Vision:终于会被编译进去了

Swift 源码一直在仓里,只是那份工程从来没被用来出包。要点没变:

```swift
public let jsName = "Vision"              // ← 错一个字就是「这版没带识别」而代码全绿
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false    // ← 硬要求
```

最后那条:语言纠正会把 `$52.30` 改成看起来更像词的东西,把订单号改错一位。
票据识别要的是**照抄**,不是通顺。

---

## ③ `NesioLocalNotify`:真的 cancel

老壳没有 cancel,所以「删掉一条提醒」只能用 workaround:同 id 重排到十年后
(iOS 对相同 identifier 是替换)。能用,但在系统里留了一条永不触发的排程,
**占着 64 条 pending 配额里的一格**。

新插件有 `cancel(id)` / `cancelAll()` / `listPending()`。
JS 侧 `tombstoneScheduled()` **先探 cancel,探不到才写墓碑** —— 所以两代壳都能跑,
调用方一行都不用改。

`listPending()` 还有个额外好处:JS 侧那份 `nesio-reminder-notify-state-v1` 簿记
不再是唯一依据。簿记会有记错的一天(写失败、换设备、手动清缓存),系统不会。

---

## ④ `SpeechRecognition`:把被关掉的话筒开回来

iOS 的 WKWebView 里 Web `SpeechRecognition` **根本不存在**。所以今天页那个话筒
以前每次点都失败、每次都挂一条「语音输入没起来」的横幅;上一轮的处理是
「探不到引擎就不摆这个话筒」—— 按钮直接收起来了。

新插件走 `SFSpeechRecognizer`:

```swift
req.requiresOnDeviceRecognition = true    // ← 关键:音频不出这台手机
```

不设的话录音会发到 Apple 的服务器。对一个「说一句就记下来」的输入框,
那不是我们要的隐私姿态。

代价是端上模型不是每台设备/每种语言都支持。`supportsOnDeviceRecognition` 为 false 时
**直接说不可用**,而不是偷偷退回云端 —— 悄悄把用户的录音发出去,比功能不可用严重得多。

`platform-capabilities.ts` 的 `speechEngine()` 探的就是这个插件名,
装上新壳它自己会返回 `'native'`,话筒自己回来。`VoiceInputSheet` 已经改成
「先试原生,不行再退 Web」—— 顺序不能反,反了会在 iOS Safari 上把本来能用的
Web 路径也绕过去。

Info.plist 已加 `NSSpeechRecognitionUsageDescription`。**缺这个 key 是闪退,不是报错。**

---

## ⑤ `Spotlight`:让 iOS 下拉搜索能搜到你的记忆

对一个记忆库 App 这是天作之合:「我那张化验单呢」「上次那家店叫什么」——
人会先在系统搜索里打字,而不是先想起要开哪个 App。不要权限、不要 entitlement。

点搜索结果时系统给的是一个 `NSUserActivity`(不是 URL),真正的 id 在 `userInfo` 里。
AppDelegate 里接住 `CSSearchableItemActionType` 转成 `nesio://memory/<id>`。
**这一段没有的话搜到了也跳不过去** —— 比搜不到更恼火。

**隐私上定了四条,都写进代码了:**

1. **默认关**,设置里主动打开才索引
2. **只送标题,不送正文**
3. 敏感类型(化验单 / 财务 / 证件)**一律不索引**,开了开关也不索引
4. 关开关时**必须真清干净** —— 索引进去的内容会离开沙箱交给系统搜索库,
   锁屏搜索和 Siri 建议都可能显示出来。关了开关索引还在,比没做这个功能更糟

---

## 出包 → 装机

### 0. ⚠️ Xcode 必须 16+

Capacitor 8.4.0 发的是**预编译 xcframework**,它的 `.swiftinterface` 里一百多处声明
包在 `#if compiler(>=5.3) && $NonescapableTypes` 里 —— 那是 **Swift 6.0 才有**的
编译器特性。用 Xcode 15.x(Swift 5.9)消费它,那批声明对编译器**直接不存在**,
被藏掉的正好包括 `CAPPluginCall.reject(...)` 和所有单参数取值器
(`getString(key)` / `getInt(key)` / `getArray(key)`)。

症状是一堆看起来毫不相干的错(`reject` has no member、
`getString` missing argument for parameter #2、闭包类型推断失败……)——
**全是同一个根因,跟插件写得对不对无关**。任何 Capacitor 8 插件在 Xcode 15 上都编不过。

Codemagic 的 `xcode: latest` 给的是 16+,所以**走云端这条路不受影响**。
本地要编才需要先升 Xcode。

(2026-07-31 本地打包实测撞到并定位。当时 42 个编译错里 14 个是真错
——四个插件的 `checkPermissions`/`requestPermissions` 写成了 `@objc func`,
而 `CAPPlugin` 把它们声明为 `open func`,所以那是覆盖不是新方法,
必须 `@objc public override func`。这 14 个已修并入库;
剩下 28 个全是上面那道门里的 API。)

### 1. 在 Codemagic 跑 `ios-sideload`

```
workflow: ios-sideload   →  产出 Nesio-sideload.ipa(未签名)
```

**这条流水线不需要开发者账号** —— 不用证书、不用 provisioning profile、
不用 App Store Connect 集成。因为 Sideloadly 反正要用你自己的 Apple ID 重签一次,
我们这边签的会被覆盖掉,干脆不签。

流水线里有一道自查:六个插件必须都在编译清单里,漏一个直接红。

### 2. Sideloadly 装

把 `Nesio-sideload.ipa` 拖进 Sideloadly,填 Apple ID,Start。

### 免费 Apple ID 的两条限制

| | |
|---|---|
| **7 天到期** | 到期在 Sideloadly 里再点一次 Start 重签。**App 数据不丢**(重签不是重装) |
| **拿不到 HealthKit entitlement** | 步数 / 睡眠 / 心率读不了。健康插件会如实返回不可用 |

所以 sideload 档用的是空的 `App-sideload.entitlements`。带一个免费账号给不了的
entitlement 去签会直接失败,报错还是那种看不懂的 provisioning profile 错误。

**其余能力一个都不受影响** —— 它们统统不需要 entitlement:

- Vision 端上识别 ✅
- 端上语音转文字 ✅
- Core Spotlight 系统搜索 ✅
- 本地通知 ✅
- 后台足迹(significant change + visits)✅ —— 只要 Info.plist 里的
  `UIBackgroundModes:[location]` 和三条位置说明,这些都已经有了

想要健康:用付费开发者账号签(那时用 `App.entitlements`,或者走 `ios-testflight`)。

### 3. 装完之后

**JS 不用再出包了。** `capacitor.config.ts` 里 `server.url` 指向线上,
壳只是个空 WebView。改一行 JS 推一次部署就生效 —— 只有改了 Swift / Info.plist / 权限
才需要重新出壳。

装完请把 `scripts/native-plugin-parity.test.mjs` 里那几条的 `inShipped` 改成 `true`。
那一列是**手工维护的事实表**,静态验不了,只能拆 IPA 核 ——
照着代码填正是 Vision 那次的犯法方式。

---

## 不做

- **内购 / StoreKit** —— 你说不要。JS 侧 `storekit-bridge.ts` 保持返回 `web_unavailable`。
- **AlarmKit** —— 能穿透静音和专注模式,适合「该吃药了」这种不能错过的。
  但要 iOS 26,而工程 min 15.0,加了会把老设备挡在外面。
  **等你说「有些提醒被我错过了」再做。**
- **Live Activities** —— 锁屏/灵动岛。现在没有明确场景,没场景就先不做。
- **Apple Intelligence / Foundation Models** —— 同 AlarmKit 的版本问题。

---

## 还欠你两个回答

**「小剧场的内置播放器」想解决什么?** 现在 `MontageTab` 是 WebView 里的
`<video>` + `webkitEnterFullscreen`(iOS 上这已经会调起系统播放器了)。
换原生 `AVPlayer` 只在这三种情况才值得:要**后台播放**(锁屏后继续放)、
要**画中画**、要**锁屏控制中心**的播放条。
如果只是「播不起来」,那多半不是播放器的问题,是片源/编码 —— 得先看具体哪一条播不了。

**「Media & Apple Music」权限想要什么?** 那是访问 **Apple Music 资料库**
(`MPMediaLibrary`)。音乐模块现在放的是本地文件(IndexedDB)。
两件事不一样:Apple Music 库里的内容有 DRM,能放但不能导出、不能做波形分析。
想要「放我 Apple Music 里的歌」才需要这个权限;「我自己的音频文件」现在这条路就够。
