import Foundation
import Capacitor
import UserNotifications

/**
 * NesioLocalNotify —— 纯本地定时通知。**不经服务器、不走 APNs、不需要推送证书。**
 *
 * ## 这一版补了什么
 *
 * 上一版壳只有 `checkPermissions` / `requestPermissions` / `schedule(afterSec, id)`。
 * **没有 cancel** —— 于是 JS 侧「删掉一条提醒」只能用 workaround:
 * 拿同一个 id 重排到十年后(iOS 对相同 identifier 是替换,那条就永远不响了)。
 *
 * 能用,但它在系统里留了一条永不触发的排程,**占着 64 条 pending 配额里的一格**。
 * 提醒一多,占掉的格子就开始挤掉真要响的那些 —— 而 iOS 排不进去是**静默**的,
 * 你不会收到任何错误,只会有一天发现某条提醒没响。
 *
 * 这一版加了三个:
 *
 * · `cancel(id)` / `cancelAll()` —— 真的撤掉,不留残渣
 * · `listPending()` —— 系统里现在排着哪些 id。有了它,JS 侧那份
 *   `nesio-reminder-notify-state-v1` 簿记就可以扔掉:直接问系统,
 *   不用自己记「我上次排过什么」(自己记就会有记错的一天)
 * · `scheduleAt(epochMs)` —— 直接给绝对时刻,不用调用方自己算差值
 *
 * ## 为什么仍然是「相对秒数」的触发器
 *
 * 因为 `at` 存的是**墙上时钟**(`YYYY-MM-DDTHH:mm`,不带时区)——
 * 「每月 15 号早上 9 点交房租」说的是钟面,不是某个 UTC 瞬间。
 * JS 侧每次回前台按**当前**时区重算一遍,所以你飞去欧洲,它就在当地 9 点响。
 * 折成 UNTimeInterval 是这个设计的自然结果,不是将就。
 *
 * (`UNCalendarNotificationTrigger` 能原生表达钟面时间,但它会把「哪个时区」
 * 固定在排程那一刻 —— 反而是错的。所以不用。)
 */
@objc(NesioLocalNotifyPlugin)
public class NesioLocalNotifyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NesioLocalNotifyPlugin"
    public let jsName = "NesioLocalNotify"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleAt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listPending", returnType: CAPPluginReturnPromise)
    ]

    private let center = UNUserNotificationCenter.current()

    // ── 权限 ────────────────────────────────────────────────────────────────

    @objc public override func checkPermissions(_ call: CAPPluginCall) {
        center.getNotificationSettings { settings in
            let display: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: display = "granted"
            case .denied: display = "denied"
            case .notDetermined: display = "prompt"
            @unknown default: display = "prompt"
            }
            call.resolve(["display": display])
        }
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            // 用户点「不允许」不是错误,是一个答案。如实回 denied,
            // 让 JS 侧去说「想让它到点提醒你,要在设置里打开通知」。
            call.resolve(["display": granted ? "granted" : "denied"])
        }
    }

    // ── 排程 ────────────────────────────────────────────────────────────────

    /// 老签名:几秒之后。JS 侧现有调用走的是这条,保持不动。
    @objc func schedule(_ call: CAPPluginCall) {
        let afterSec = max(1, call.getInt("afterSec", 1))
        submit(call, seconds: TimeInterval(afterSec))
    }

    /// 新签名:绝对时刻(epoch 毫秒)。差值在原生侧算,少一处时钟不一致的机会。
    @objc func scheduleAt(_ call: CAPPluginCall) {
        // 0 当哨兵:JS 侧传的是毫秒时间戳,永远 > 0,不会和「没传」撞上。
        let epochMs = call.getDouble("epochMs", 0)
        guard epochMs > 0 else {
            call.resolve(["ok": false, "reason": "missing_epoch"]); return
        }
        let seconds = epochMs / 1000.0 - Date().timeIntervalSince1970
        guard seconds >= 1 else {
            // 已经过去的时刻不排。补一条「本该昨天响」的通知只会吓人一跳。
            call.resolve(["ok": false, "reason": "in_past"]); return
        }
        submit(call, seconds: seconds)
    }

    private func submit(_ call: CAPPluginCall, seconds: TimeInterval) {
        // -1 当哨兵:JS 侧 notifyIdOf() 走 FNV-1a 取正再取模,永远 >= 0。
        let id = call.getInt("id", -1)
        guard id >= 0 else {
            call.resolve(["ok": false, "reason": "missing_id"]); return
        }
        let content = UNMutableNotificationContent()
        content.title = call.getString("title", "")
        content.body = call.getString("body", "")
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        // identifier 用调用方给的 id:**同 id 再排 = 替换**。
        // JS 侧靠这个保证「回前台重排一遍」不会把同一条提醒排成两条。
        let req = UNNotificationRequest(identifier: String(id), content: content, trigger: trigger)

        center.add(req) { err in
            if let err = err {
                call.resolve(["ok": false, "reason": "add_failed", "message": err.localizedDescription])
            } else {
                call.resolve(["ok": true, "id": id])
            }
        }
    }

    // ── 撤销 ────────────────────────────────────────────────────────────────

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getInt("id", -1)
        guard id >= 0 else {
            call.resolve(["ok": false, "reason": "missing_id"]); return
        }
        center.removePendingNotificationRequests(withIdentifiers: [String(id)])
        // 已经弹出来躺在通知中心里的那条也一并收走 —— 提醒都删了,
        // 通知列表里还挂着它就成了幽灵。
        center.removeDeliveredNotifications(withIdentifiers: [String(id)])
        call.resolve(["ok": true])
    }

    @objc func cancelAll(_ call: CAPPluginCall) {
        center.removeAllPendingNotificationRequests()
        call.resolve(["ok": true])
    }

    /**
     * 系统里现在排着哪些。
     *
     * 这是「真相在系统那边」的那一半 —— JS 侧不用再自己记一份簿记,
     * 也就没有簿记和现实对不上的那一天。顺便把 `count` 一起回去,
     * 调用方能自己判断离 64 条上限还有多远。
     */
    @objc func listPending(_ call: CAPPluginCall) {
        center.getPendingNotificationRequests { reqs in
            let items: [[String: Any]] = reqs.map { r in
                var next: Any = NSNull()
                if let t = r.trigger as? UNTimeIntervalNotificationTrigger,
                   let d = t.nextTriggerDate() {
                    next = Int(d.timeIntervalSince1970 * 1000)
                }
                return [
                    "id": Int(r.identifier) ?? -1,
                    "title": r.content.title,
                    "at": next,
                ]
            }
            call.resolve(["items": items, "count": items.count, "limit": 64])
        }
    }
}
