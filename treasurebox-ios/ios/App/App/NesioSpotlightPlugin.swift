import Foundation
import Capacitor
import CoreSpotlight
import MobileCoreServices
import UniformTypeIdentifiers

/**
 * Spotlight —— 把记忆索引进 iOS 系统搜索(桌面下拉那个)。
 *
 * ## 为什么这件事对这个 App 特别划算
 *
 * 它是个记忆库。「我那张化验单呢」「上次跟谁吃的那家店叫什么」——
 * 这些问题人会**先在系统搜索里打字**,而不是先想起要开哪个 App。
 * Core Spotlight 让它们直接搜得到,点进来 deep link 到那条记忆。
 *
 * 而且很便宜:不要权限、不要 entitlement、不走网络,索引就在本机。
 *
 * ## 隐私上的一个真问题,以及这里怎么处理
 *
 * **索引进 Spotlight 的内容会离开这个 App 的沙箱**,交给系统的搜索数据库。
 * 它不上传,但锁屏搜索、Siri 建议都可能显示出来 —— 手机借人一看就看见了。
 *
 * 所以这里定死一条:**只索引调用方明确交上来的字段**,不自己去翻数据。
 * 索引什么由 JS 侧决定(化验单、私密日记这类默认不进),
 * 而且 `removeAll()` 必须留着 —— 用户在设置里关掉这个开关时要能一键清干净。
 *
 * ## deep link
 *
 * 每条的 uniqueIdentifier 就是节点 id。用户点搜索结果时系统会用
 * `NSUserActivity`(`CSSearchableItemActionType`)把 App 拉起来,
 * AppDelegate 里把它转成 `nesio://memory/<id>` 交给 WebView。
 */
@objc(NesioSpotlightPlugin)
public class NesioSpotlightPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NesioSpotlightPlugin"
    public let jsName = "Spotlight"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "indexItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAll", returnType: CAPPluginReturnPromise)
    ]

    private let domain = "app.nesio.memory"

    @objc func isAvailable(_ call: CAPPluginCall) {
        // 低配设备 / 关掉了 Siri 与搜索时,indexingAvailable 会是 false。
        call.resolve([
            "available": CSSearchableIndex.isIndexingAvailable(),
            "reason": CSSearchableIndex.isIndexingAvailable() ? "" : "indexing_disabled",
        ])
    }

    /**
     * 入参 `items: [{id, title, body?, date?, keywords?}]`。
     *
     * 同 id 重复索引 = 覆盖,所以调用方可以放心地全量重推,不用先算差集。
     */
    @objc func indexItems(_ call: CAPPluginCall) {
        guard CSSearchableIndex.isIndexingAvailable() else {
            call.resolve(["ok": false, "reason": "indexing_disabled"]); return
        }
        guard let raw = call.getArray("items") as? [[String: Any]], !raw.isEmpty else {
            call.resolve(["ok": true, "indexed": 0]); return
        }

        let items: [CSSearchableItem] = raw.compactMap { row in
            guard let id = row["id"] as? String, !id.isEmpty else { return nil }
            let attrs: CSSearchableItemAttributeSet
            if #available(iOS 14.0, *) {
                attrs = CSSearchableItemAttributeSet(contentType: UTType.text)
            } else {
                attrs = CSSearchableItemAttributeSet(itemContentType: kUTTypeText as String)
            }
            attrs.title = row["title"] as? String
            attrs.contentDescription = row["body"] as? String
            if let kws = row["keywords"] as? [String], !kws.isEmpty { attrs.keywords = kws }
            if let ms = row["date"] as? Double {
                attrs.contentCreationDate = Date(timeIntervalSince1970: ms / 1000)
            }
            let item = CSSearchableItem(uniqueIdentifier: id, domainIdentifier: domain, attributeSet: attrs)
            // 一个月不用就让系统回收。记忆库会一直长,不设过期的话索引只增不减,
            // 而真正会被搜的永远是最近那批。
            item.expirationDate = Date().addingTimeInterval(30 * 24 * 3600)
            return item
        }

        CSSearchableIndex.default().indexSearchableItems(items) { err in
            if let err = err {
                call.resolve(["ok": false, "reason": "index_failed", "message": err.localizedDescription])
            } else {
                call.resolve(["ok": true, "indexed": items.count])
            }
        }
    }

    @objc func removeItems(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        guard !ids.isEmpty else { call.resolve(["ok": true, "removed": 0]); return }
        CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids) { err in
            if let err = err {
                call.resolve(["ok": false, "reason": "remove_failed", "message": err.localizedDescription])
            } else {
                call.resolve(["ok": true, "removed": ids.count])
            }
        }
    }

    /// 用户在设置里关掉「让系统搜索找到我的记忆」时调这个。**必须真的清空** ——
    /// 关了开关但索引还在,是最坏的一种:用户以为清了,实际锁屏搜索还搜得到。
    @objc func removeAll(_ call: CAPPluginCall) {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domain]) { err in
            if let err = err {
                call.resolve(["ok": false, "reason": "remove_failed", "message": err.localizedDescription])
            } else {
                call.resolve(["ok": true])
            }
        }
    }
}
