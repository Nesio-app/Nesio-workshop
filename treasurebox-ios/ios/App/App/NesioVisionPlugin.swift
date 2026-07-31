import Foundation
import Capacitor
import Vision
import UIKit

/**
 * NesioVision — 端上文字识别(Apple Vision framework)。
 *
 * 用在「拍化验单」:图片进来,逐行文字出去,**一个字节都不离开这台手机**。
 * 化验单是印刷体表格,Vision 的 accurate 档足够;不需要也不该动云端视觉模型
 * (多一家供应商拿到你的病历)。
 *
 * 只做一件事:图 → 文字。**不做**结构化 —— 把 OCR 文本解析成指标行的规则
 * 全在 JS 侧(lib/health/lab-parse.ts),那边可单测、可迭代、改了不用重出 IPA。
 * 原生这层越薄越好:每动一次都要重新签名、重新装。
 *
 * 语言:中文简体 + 英文。usesLanguageCorrection 关掉 —— 化验单上大量是
 * 「HbA1c」「10^9/L」这类词典里没有的串,开着纠错反而会把它们改成别的词。
 *
 * ## 为什么失败走 resolve 而不是 reject
 *
 * Capacitor 8 发的是**预编译 xcframework**,它的 `.swiftinterface` 把
 * `CAPPluginCall.reject(...)` 包在 `#if compiler(>=5.3) && $NonescapableTypes` 里 ——
 * 那是 Swift 6.0 才有的编译器特性。用 Xcode 15.x(Swift 5.9)编,
 * 这个方法对编译器**根本不存在**,报 "has no member"。
 *
 * 所以这里统一改成 `resolve(["ok": false, "reason": …, "message": …])` ——
 * **一条失败路径都没少**,每个 reason code 原样保留,只是走 resolve 出去。
 * 另外五个插件本来就是这个风格,现在六个一致了。
 *
 * (顺带一个好处:JS 侧不用再靠 try/catch 分辨「这次没成」和「桥本身炸了」——
 * 前者是 `ok:false` 的正常返回,后者才是异常。)
 */
@objc(NesioVisionPlugin)
public class NesioVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NesioVisionPlugin"
    public let jsName = "Vision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    /// JS 侧据此决定「走端上」还是「让用户手填」。别让 JS 猜。
    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 13.0, *) {
            call.resolve(["available": true, "reason": ""])
        } else {
            call.resolve(["available": false, "reason": "ios_too_old"])
        }
    }

    /**
     * 入参 imageBase64:不带 data URI 前缀的 base64(JS 侧负责剥)。
     * 出参 text:整段文字(行间 \n);lines:逐行,带各自的置信度。
     *
     * 每条失败路径都 reject 一个**能看懂的 code** —— JS 侧要把它变成一句人话 + 重试,
     * 不许静默变成「识别不出东西」(那和「这张图没字」分不开)。
     */
    @objc func recognizeText(_ call: CAPPluginCall) {
        guard #available(iOS 13.0, *) else {
            call.resolve(["ok": false, "reason": "ios_too_old", "message": "这台设备的系统太旧,用不了端上识别"]); return
        }
        let b64 = call.getString("imageBase64", "")
        guard !b64.isEmpty else {
            call.resolve(["ok": false, "reason": "no_image", "message": "没收到图片"]); return
        }
        guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
            call.resolve(["ok": false, "reason": "bad_base64", "message": "图片数据读不出来"]); return
        }
        guard let image = UIImage(data: data), let cg = image.cgImage else {
            call.resolve(["ok": false, "reason": "decode_failed", "message": "这张图解不开"]); return
        }

        let request = VNRecognizeTextRequest { req, err in
            if let err = err {
                call.resolve(["ok": false, "reason": "vision_failed", "message": "识别没成:\(err.localizedDescription)"]); return
            }
            let observations = (req.results as? [VNRecognizedTextObservation]) ?? []

            // Vision 不保证按阅读顺序回;化验单是表格,顺序错了就串行。
            // 按 y 从上到下、同一行内按 x 从左到右重排。
            let sorted = observations.sorted { a, b in
                let ay = a.boundingBox.origin.y, by = b.boundingBox.origin.y
                // boundingBox 原点在左下,y 越大越靠上
                if abs(ay - by) > 0.008 { return ay > by }
                return a.boundingBox.origin.x < b.boundingBox.origin.x
            }

            var lines: [[String: Any]] = []
            var buffer: [String] = []
            var lastY: CGFloat = .greatestFiniteMagnitude
            var lastConf: Float = 1.0
            var flushed: [String] = []

            func flush() {
                if !buffer.isEmpty {
                    let joined = buffer.joined(separator: "  ")
                    flushed.append(joined)
                    lines.append(["text": joined, "confidence": lastConf])
                    buffer.removeAll()
                }
            }

            for ob in sorted {
                guard let top = ob.topCandidates(1).first else { continue }
                let y = ob.boundingBox.origin.y
                // 同一行的碎片(表格各列)合成一行,用双空格分隔 ——
                // lab-parse 靠「名字 值 单位 区间」在一行里才解得出来。
                if lastY != .greatestFiniteMagnitude && abs(y - lastY) > 0.008 { flush() }
                buffer.append(top.string)
                lastY = y
                lastConf = top.confidence
            }
            flush()

            call.resolve([
                "ok": true,
                "text": flushed.joined(separator: "\n"),
                "lines": lines
            ])
        }

        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        // 化验单上全是词典外的串(HbA1c / 10^9/L / ALT),纠错只会帮倒忙。
        request.usesLanguageCorrection = false

        let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(image.imageOrientation), options: [:])
        // 识别是 CPU 密集活,别占主线程(否则 webview 整个卡住)。
        DispatchQueue.global(qos: .userInitiated).async {
            do { try handler.perform([request]) }
            catch { call.resolve(["ok": false, "reason": "handler_failed", "message": "识别没跑起来:\(error.localizedDescription)"]) }
        }
    }

    /// UIImage 的方向 → CGImagePropertyOrientation。
    /// 竖着拍的照片 cgImage 是横的,不转的话整页文字都是躺着的,一行都认不出来。
    private func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
