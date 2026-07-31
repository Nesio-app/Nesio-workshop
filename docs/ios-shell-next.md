# 下一版 iOS 壳要什么

**基线**：`Nesioshellfix.ipa`（2026-07-31 拆过）。appId `app.nesio.ios`，MinimumOSVersion 17.0，
`server.url = https://treasurebox-nu.vercel.app`（加载远程 JS —— **纯 JS 的改动推部署就生效，不用重出 IPA**；
这份单子上的每一条都不是纯 JS，都要出新壳）。

现有三个插件：`NesioGeolocationPlugin` / `NesioLocalNotifyPlugin` / `NesioHealthKitPlugin`。

判据来源：`capacitor.config.json` 的 `packageClassList` + `strings App | grep`。
`scripts/native-plugin-parity.test.mjs` 里那张清单是同一份事实，改壳之后**两边一起更新**。

---

## P0 ①：`NesioGeolocation` 补 `trailPoint` 事件 —— 后台足迹现在是断的

**症状**：「位置后台一直收集还不管用」。开了始终定位，UI 显示「足迹监听已开」，一个点都进不来。

**根因不是权限，是事件通道没接上。** 壳这边全都有：

```
startTrailWatch                            ✅ 4 处
stopTrailWatch                             ✅ 4 处
trailWatching                              ✅ 5 处
startMonitoringSignificantLocationChanges  ✅
startMonitoringVisits                      ✅
requestAlwaysPermission                    ✅ 7 处
trailPoint                                 ❌ 0 处   ← 就是这里
```

JS 侧 `lib/portal/native-geolocation.ts` 挂的是：

```ts
await NesioGeolocation.addListener('trailPoint', (point) => {
  if (typeof point?.lat !== 'number' || typeof point?.lon !== 'number') return;
  void ingestTrailPoint(point.lat, point.lon);
});
```

壳从不 `notifyListeners("trailPoint", …)`，所以这个回调**永远不会触发**。
而 `startTrailWatch()` 返回 `{ok: true}` —— 于是每一层看起来都成功了，只有数据没有。
这比插件整个缺失更难查。

**要做的**：在 `CLLocationManagerDelegate` 的两个回调里推事件。

```swift
func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
    guard trailWatching, let l = locs.last else { return }
    notifyListeners("trailPoint", data: [
        "lat": l.coordinate.latitude,
        "lon": l.coordinate.longitude,
        "at": ISO8601DateFormatter().string(from: l.timestamp),
        "accuracy": l.horizontalAccuracy,
        "source": "significant",
    ])
}

func locationManager(_ m: CLLocationManager, didVisit visit: CLVisit) {
    guard trailWatching, visit.horizontalAccuracy > 0 else { return }
    notifyListeners("trailPoint", data: [
        "lat": visit.coordinate.latitude,
        "lon": visit.coordinate.longitude,
        "at": ISO8601DateFormatter().string(from: visit.arrivalDate),
        "accuracy": visit.horizontalAccuracy,
        "source": "visit",           // 停留 —— 比路过的点更该进足迹
    ])
}
```

字段名要对上 JS：至少 `lat` / `lon`（数字）。`at` / `accuracy` / `source` 是加分项，
JS 侧会一起收（有 `at` 就能把点落到**发生那天**而不是收到那天）。

**一并确认两件事**：

- `allowsBackgroundLocationUpdates` 在二进制里是 **0 次**。如果将来要用
  `startUpdatingLocation` 做连续定位，这个属性不设为 `true`，App 一进后台投递就停。
  现在走的是 significant change + visits（**不需要**这个属性，系统会唤醒 App），
  所以当前配置是对的 —— 但别哪天换成连续定位却忘了它。
- App 被系统唤醒时 WebView 可能还没起来，`notifyListeners` 会丢。
  稳妥做法是原生侧攒一个小队列（比如最近 200 个点），JS 侧 `startTrailWatch` 时
  一次性 `drainTrailPoints()` 取走。**如果做这个，把方法名告诉我，JS 侧要一起改。**

---

## P0 ②：加 `Vision` 插件 —— 端上文字识别

**为什么最优先**：上一轮把全站 20+ 个取图入口都改成了「先在这台设备上认字，认出来就不打云」——
小票、订单、账单、化验单。整条链建在这个插件上。
现在壳里没有（`NesioVisionPlugin` / `VNRecognizeTextRequest` 符号都是 0），
所以真机上全线走 `plugin_missing`（会如实说「这台设备认不了字」，不会静默失败，但功能等于没有）。

**JS 侧已经写好并且不会再改**，`lib/native/vision.ts`：

```ts
const p = window.Capacitor.Plugins.Vision;   // ⚠️ jsName 必须是 "Vision"，不是 "NesioVision"
p.isAvailable()   → { available: boolean, reason?: string }
p.recognizeText({ imageBase64 })
                  → { text: string, lines?: [{ text, confidence }] }
```

**Swift 侧要点**：

```swift
@objc(NesioVisionPlugin)
public class NesioVisionPlugin: CAPPlugin {
    public let jsName = "Vision"        // ← 两头必须一致，错一个字就是「这版没带识别」而代码全绿
    // VNRecognizeTextRequest
    //   recognitionLevel = .accurate
    //   recognitionLanguages = ["zh-Hans", "en-US"]
    //   usesLanguageCorrection = false   ← 小票金额/单号不能被「纠正」
}
```

最后那条是硬要求：语言纠正会把 `$52.30` 改成看起来更像词的东西，把订单号改错一位。
票据识别要的是**照抄**，不是通顺。

`Info.plist` 不用加 key（Vision 不需要单独授权，相机权限已经有了）。

---

## P1 ③：`NesioLocalNotify` 补 `cancel(id)` / `cancelAll()`

现在只有 `checkPermissions` / `requestPermissions` / `schedule(afterSec, id)`。
没有 cancel，所以「删掉一条提醒」在 JS 侧只能用 workaround：
同 id 重排到十年后（iOS 对相同 identifier 是替换，那条就永远不响了）。

能用，但它在系统里留了一条永不触发的排程，**占着 64 条 pending 配额里的一格**。

```swift
@objc func cancel(_ call: CAPPluginCall) {
    guard let id = call.getInt("id") else { return call.reject("missing_id") }
    UNUserNotificationCenter.current()
        .removePendingNotificationRequests(withIdentifiers: [String(id)])
    call.resolve(["ok": true])
}
@objc func cancelAll(_ call: CAPPluginCall) { … removeAllPendingNotificationRequests() … }
```

顺带一个能省事的：`listPending()` 返回当前排了哪些 id。
有了它，JS 侧那份 `nesio-reminder-notify-state-v1` 簿记就可以扔掉 —— 直接问系统。

壳加完之后 JS 只改 `tombstoneScheduled()` 一个函数的实现，调用方不动。

---

## P1 ④：加 `SpeechRecognition` —— 端上语音转文字

**它补的是一个现在被关掉的功能。** 今天页那个话筒：iOS PWA 上 Web SpeechRecognition
根本不存在，所以每次点都失败、每次都挂一条「语音输入没起来」的横幅。
这一轮的处理是「探不到引擎就不摆这个话筒」—— 按钮直接收起来了。

原生 `SFSpeechRecognizer` 能让它真的能用，而且和 Vision 一个路子：

```swift
let r = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
let req = SFSpeechAudioBufferRecognitionRequest()
req.requiresOnDeviceRecognition = true      // ← 关键：端上跑，音频不出手机
```

`requiresOnDeviceRecognition = true` 是要点。不设的话音频会发到 Apple 服务器 ——
对一个「说一句就记下来」的输入框，那不是我们要的隐私姿态。

**`Info.plist` 要加 `NSSpeechRecognitionUsageDescription`**（`NSMicrophoneUsageDescription` 已经有了）。

JS 侧我会照 `lib/native/vision.ts` 的形状写桥（`isAvailable` + 流式回调），
壳这边 jsName 定 `SpeechRecognition`。

---

## P2 ⑤：Core Spotlight 索引 —— 让 iOS 下拉搜索能搜到你的记忆

截图里 Fitness 那个「Search」开关就是这个。

对一个记忆库 App，这是天作之合而且很便宜：`CSSearchableItem` 把节点标题 + 摘要
索引进系统搜索，从桌面下拉直接搜到，点进来 deep link 到那条记忆。

要壳提供 `indexItems([{id, title, body, date}])` / `removeItems([id])`，
再加一条 `nesio://memory/<id>` 的 URL scheme 处理。

**先做 ③④ 再说这条** —— 它是锦上添花，前面几条是「功能现在不能用」。

---

## 不做

- **内购 / StoreKit** —— 你说不要。JS 侧 `storekit-bridge.ts` 保持返回 `web_unavailable`。
- **Alarms（AlarmKit）** —— Granola 那张截图里的。它能穿透静音和专注模式，
  适合「该吃药了」这种不能错过的。但：① 要 iOS 26，壳现在 min 17.0，加了会把 17/18 用户挡住；
  ② 本地通知刚接上，先用一阵看够不够。**等你说「有些提醒被我错过了」再做。**
- **Live Activities** —— 锁屏/灵动岛。现在没有明确场景（训练计时？做饭倒计时？），
  没有场景就先不做。
- **Apple Intelligence / Foundation Models** —— iOS 26 的端上大模型。
  同 AlarmKit 的版本问题，而且它要解决的问题（端上 LLM）现在还没有非它不可的场景。

---

## 待你确认

**「小剧场的内置播放器」想解决什么？** 现在 `MontageTab` 是 WebView 里的
`<video>` + `webkitEnterFullscreen`（iOS 上这已经会调起系统播放器了）。
换原生 `AVPlayer` 只在下面这些情况才值得：

- 要**后台播放**（锁屏后继续放）
- 要**画中画**
- 要**锁屏控制中心**的播放条

如果只是「播不起来」，那多半不是播放器的问题，是片源/编码，得先看具体哪一条播不了。

**「Media & Apple Music」（Google Maps 那张截图）想要什么？**
那个权限是访问用户的 **Apple Music 资料库**（`MPMediaLibrary`）。
仓里的 `MusicPanel` 现在放的是本地文件（IndexedDB）。两件事不一样：
Apple Music 库里的内容有 DRM，能放但不能导出、不能做波形分析。
如果你想要的是「放我 Apple Music 里的歌」，那要这个权限；
如果是「我自己的音频文件」，现在这条路就够。
