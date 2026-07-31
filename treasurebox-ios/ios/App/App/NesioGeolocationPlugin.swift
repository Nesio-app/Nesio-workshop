import Foundation
import Capacitor
import CoreLocation

/**
 * NesioGeolocation —— 取一次位置 + **后台足迹**。
 *
 * ## 这个插件存在的理由,以及上一版壳错在哪
 *
 * 上一版壳里 `startTrailWatch` / `stopTrailWatch` / `trailWatching` 都有,
 * `startMonitoringSignificantLocationChanges` 和 `startMonitoringVisits` 也真起了 ——
 * 但二进制里 `trailPoint` 出现 **0 次**。也就是说系统在往 delegate 里送点,
 * delegate 收下了,然后**谁也没通知**。
 *
 * 而 JS 侧 (`lib/portal/native-geolocation.ts`) 挂的就是
 * `addListener('trailPoint', …)` —— 它一直在等一个永远不会来的事件。
 * `startTrailWatch()` 又老老实实返回 `{ok: true}`,于是 UI 一路显示「足迹监听已开」。
 *
 * 每一层看起来都成功了,只有数据没有。这比插件整个缺失难查得多 ——
 * 「位置后台一直收集还不管用」就是这么来的。这一版补的就是那句 `notifyListeners`。
 *
 * ## 为什么还要一个队列
 *
 * significant-change / visit 会在 App **被系统唤醒**时投递 —— 那时 WebView 常常还没起来,
 * `notifyListeners` 发出去没人接,点就丢了。真正的后台足迹恰恰全是这种点。
 *
 * 所以收到的点先落 `UserDefaults`(轻量、进程重启还在),JS 侧 `startTrailWatch` 时
 * 调一次 `drainTrailPoints()` 把攒下的一次性取走。**发事件 + 落队列两条都走**:
 * 前台时事件即时到,后台攒的下次回前台补齐。重复由 JS 侧按 (lat,lon,时刻) 去重。
 *
 * ## 为什么不用 startUpdatingLocation
 *
 * 连续定位要 `allowsBackgroundLocationUpdates = true`,而且会一直吃电、一直在状态栏
 * 挂蓝条。足迹要的是「你今天去过哪」,不是「你此刻在哪」——
 * significant change(约 500m/5 分钟)+ visits(停留)正好是这个粒度,
 * 而且**系统会为它们唤醒 App**,不需要那个属性,也不需要 App 常驻。
 */
@objc(NesioGeolocationPlugin)
public class NesioGeolocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "NesioGeolocationPlugin"
    public let jsName = "NesioGeolocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlwaysPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTrailWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTrailWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainTrailPoints", returnType: CAPPluginReturnPromise)
    ]

    private let manager = CLLocationManager()

    /// 一次性取点的等待中调用。可能同时有多个(JS 侧会重试),所以是数组。
    private var pendingFixes: [CAPPluginCall] = []
    /// 等权限弹窗结果的调用。
    private var pendingPermission: CAPPluginCall?
    private var pendingAlways: CAPPluginCall?

    private var trailWatching = false
    private var fixTimer: Timer?

    /// 攒点的上限。200 个点够覆盖好几天的 significant change;
    /// 再多也没意义 —— 足迹要的是去过哪,不是每一步。
    private let queueCap = 200
    private let queueKey = "nesio.trail.queue.v1"
    private let watchingKey = "nesio.trail.watching.v1"

    override public func load() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        // App 被 significant-change 唤醒时会重新 load();
        // 如果上次开着足迹,这里要把监听接回去 —— 否则唤醒一次之后就再也不收点了。
        if UserDefaults.standard.bool(forKey: watchingKey) {
            trailWatching = true
            beginTrailMonitoring()
        }
    }

    // ── 权限 ────────────────────────────────────────────────────────────────

    /// JS 侧看 `location` / `coarseLocation` / `always` 三个字段(值是 'granted' / 'denied' / 'prompt')。
    private func permissionPayload() -> [String: Any] {
        let status = CLLocationManager.authorizationStatus()
        let whenInUse: String
        let always: String
        switch status {
        case .authorizedAlways:
            whenInUse = "granted"; always = "granted"
        case .authorizedWhenInUse:
            whenInUse = "granted"; always = "prompt"
        case .denied, .restricted:
            whenInUse = "denied"; always = "denied"
        case .notDetermined:
            whenInUse = "prompt"; always = "prompt"
        @unknown default:
            whenInUse = "prompt"; always = "prompt"
        }
        // 精确/模糊:iOS 14 起用户可以只给模糊位置。给模糊也算给了 ——
        // 足迹本来就是 500m 粒度的,模糊完全够用,不该因此把功能关掉。
        var coarse = whenInUse
        if #available(iOS 14.0, *), manager.accuracyAuthorization == .reducedAccuracy, whenInUse == "granted" {
            coarse = "granted"
        }
        return [
            "location": whenInUse,
            "coarseLocation": coarse,
            "always": always,
            "trailWatching": trailWatching,
        ]
    }

    @objc func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(permissionPayload())
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        let status = CLLocationManager.authorizationStatus()
        guard status == .notDetermined else {
            // 已经问过了。再调 requestWhenInUse 系统**不会**再弹,
            // 直接把当前状态回给 JS —— 让它去引导「去设置里开」,而不是干等一个不会来的回调。
            call.resolve(permissionPayload()); return
        }
        pendingPermission = call
        DispatchQueue.main.async { self.manager.requestWhenInUseAuthorization() }
    }

    /**
     * 升级到 Always。
     *
     * iOS 的规矩:必须**先有** WhenInUse 才能请求 Always,而且 Always 的弹窗
     * 系统只给一次机会。所以这里分两步 —— 还没有 WhenInUse 就先请求它,
     * 拿到之后再请求 Always。
     */
    @objc func requestAlwaysPermission(_ call: CAPPluginCall) {
        let status = CLLocationManager.authorizationStatus()
        if status == .authorizedAlways {
            call.resolve(permissionPayload()); return
        }
        pendingAlways = call
        DispatchQueue.main.async {
            if status == .notDetermined {
                self.manager.requestWhenInUseAuthorization()
            } else {
                self.manager.requestAlwaysAuthorization()
            }
        }
    }

    // ── 取一次位置 ──────────────────────────────────────────────────────────

    /**
     * 出参用 `{ok, lat, lon, accuracy, timestamp}`(JS 侧 `getDevicePosition` 就读这几个)。
     *
     * **失败也 resolve,不 reject** —— 带 `ok:false` + `reason`。
     * 定位失败是常事(室内、刚开机、飞行模式),它不该在 JS 侧变成一个异常;
     * 但也不能静默返回空对象,那样调用方分不清「没权限」和「一时没定上」。
     */
    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        let status = CLLocationManager.authorizationStatus()
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            call.resolve(["ok": false, "reason": status == .notDetermined ? "not_determined" : "denied"])
            return
        }
        // maximumAge:缓存够新就直接用,省一次 GPS 唤醒(室内首点要 8 秒以上)。
        let maxAgeMs = call.getInt("maximumAge") ?? 0
        if maxAgeMs > 0, let last = manager.location,
           Date().timeIntervalSince(last.timestamp) * 1000 <= Double(maxAgeMs) {
            call.resolve(fixPayload(last)); return
        }

        if call.getBool("enableHighAccuracy") == true {
            manager.desiredAccuracy = kCLLocationAccuracyBest
        }
        pendingFixes.append(call)
        DispatchQueue.main.async {
            self.manager.requestLocation()
            // requestLocation 自己有超时,但那个超时**不保证**回调 ——
            // 没有这一层的话 JS 侧那个 Promise 会永远挂着(UI 转圈转到天荒地老)。
            let ms = call.getInt("timeout") ?? 18_000
            self.fixTimer?.invalidate()
            self.fixTimer = Timer.scheduledTimer(withTimeInterval: Double(ms) / 1000.0, repeats: false) { [weak self] _ in
                self?.flushFixes(["ok": false, "reason": "timeout"])
            }
        }
    }

    private func fixPayload(_ l: CLLocation) -> [String: Any] {
        return [
            "ok": true,
            "lat": l.coordinate.latitude,
            "lon": l.coordinate.longitude,
            "accuracy": l.horizontalAccuracy,
            "timestamp": Int(l.timestamp.timeIntervalSince1970 * 1000),
        ]
    }

    private func flushFixes(_ payload: [String: Any]) {
        fixTimer?.invalidate(); fixTimer = nil
        let calls = pendingFixes
        pendingFixes.removeAll()
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        for c in calls { c.resolve(payload) }
    }

    // ── 足迹 ────────────────────────────────────────────────────────────────

    @objc func startTrailWatch(_ call: CAPPluginCall) {
        let status = CLLocationManager.authorizationStatus()
        guard status == .authorizedAlways || status == .authorizedWhenInUse else {
            call.resolve(["ok": false, "reason": status == .notDetermined ? "not_determined" : "denied"])
            return
        }
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else {
            call.resolve(["ok": false, "reason": "unavailable_on_device"]); return
        }
        trailWatching = true
        UserDefaults.standard.set(true, forKey: watchingKey)
        beginTrailMonitoring()
        // always=false 时如实告诉 JS:只给了「使用期间」,App 一进后台就不再收点。
        // UI 该据此说「想在后台也记,要把定位改成『始终』」,而不是笼统显示「已开启」。
        call.resolve(["ok": true, "always": status == .authorizedAlways])
    }

    @objc func stopTrailWatch(_ call: CAPPluginCall) {
        trailWatching = false
        UserDefaults.standard.set(false, forKey: watchingKey)
        DispatchQueue.main.async {
            self.manager.stopMonitoringSignificantLocationChanges()
            self.manager.stopMonitoringVisits()
        }
        call.resolve(["ok": true])
    }

    private func beginTrailMonitoring() {
        DispatchQueue.main.async {
            self.manager.startMonitoringSignificantLocationChanges()
            self.manager.startMonitoringVisits()
        }
    }

    /**
     * 取走后台攒下的点。**取完即清** —— 这是「至多消费一次」:
     * 宁可偶尔丢一个点,也不要每次回前台把同一批点重复灌进足迹。
     */
    @objc func drainTrailPoints(_ call: CAPPluginCall) {
        let queued = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
        UserDefaults.standard.removeObject(forKey: queueKey)
        call.resolve(["points": queued])
    }

    /// 一个点两条路都走:发事件(前台有人听就即时到)+ 落队列(后台没人听时留着)。
    private func emitTrailPoint(_ payload: [String: Any]) {
        notifyListeners("trailPoint", data: payload)
        var queued = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
        queued.append(payload)
        if queued.count > queueCap { queued.removeFirst(queued.count - queueCap) }
        UserDefaults.standard.set(queued, forKey: queueKey)
    }

    // ── CLLocationManagerDelegate ───────────────────────────────────────────

    public func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let last = locs.last else { return }
        if !pendingFixes.isEmpty { flushFixes(fixPayload(last)) }
        guard trailWatching else { return }
        emitTrailPoint([
            "lat": last.coordinate.latitude,
            "lon": last.coordinate.longitude,
            "accuracy": last.horizontalAccuracy,
            "timestamp": Int(last.timestamp.timeIntervalSince1970 * 1000),
            "source": "significant",
        ])
    }

    /**
     * 停留(visit)比路过的点更该进足迹 —— 「在这儿待了两小时」才是一个地点,
     * 路上飘过的坐标不是。
     *
     * `departureDate` 是 distantFuture 表示「还在这儿」;用 arrivalDate 记时刻,
     * 这样这条足迹会落在**到达那天**,而不是离开那天。
     */
    public func locationManager(_ m: CLLocationManager, didVisit visit: CLVisit) {
        guard trailWatching, visit.horizontalAccuracy > 0 else { return }
        let at = visit.arrivalDate == Date.distantPast ? Date() : visit.arrivalDate
        emitTrailPoint([
            "lat": visit.coordinate.latitude,
            "lon": visit.coordinate.longitude,
            "accuracy": visit.horizontalAccuracy,
            "timestamp": Int(at.timeIntervalSince1970 * 1000),
            "source": "visit",
        ])
    }

    public func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        // kCLErrorLocationUnknown 是「暂时定不上」,系统还会继续试 —— 不当失败处理,
        // 否则室内第一次取点必失败(而 JS 侧的重试就白写了)。
        if let e = error as? CLError, e.code == .locationUnknown { return }
        if !pendingFixes.isEmpty { flushFixes(["ok": false, "reason": "location_failed"]) }
    }

    public func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        let status = CLLocationManager.authorizationStatus()

        if let call = pendingPermission {
            pendingPermission = nil
            call.resolve(permissionPayload())
        }

        if let call = pendingAlways {
            // 两段式:刚拿到 WhenInUse,接着请求 Always(这次弹的是第二个窗)。
            if status == .authorizedWhenInUse {
                DispatchQueue.main.async { self.manager.requestAlwaysAuthorization() }
                // 不 resolve —— 等 Always 那一轮回调。
            } else {
                pendingAlways = nil
                call.resolve(permissionPayload())
            }
        }
    }
}
