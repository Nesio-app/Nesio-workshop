import Foundation
import Capacitor
import Speech
import AVFoundation

/**
 * SpeechRecognition —— 端上语音转文字。
 *
 * ## 它补的是一个**现在被关掉的**功能
 *
 * 今天页那个话筒:iOS 的 PWA / WKWebView 里 Web `SpeechRecognition` 根本不存在。
 * 所以以前每次点都失败、每次都挂一条「语音输入没起来」的横幅。上一轮的处理是
 * 「探不到引擎就不摆这个话筒」—— 按钮直接收起来了(见 `platform-capabilities.ts`
 * 的 `speechEngine()`:探到原生插件才返回 'native')。
 *
 * 这个插件一装上,那个探针就会返回 'native',话筒自己会回来。**JS 侧不用改判断。**
 *
 * ## `requiresOnDeviceRecognition = true` 是硬要求
 *
 * 不设的话,音频会被发到 Apple 的服务器做识别。对一个「说一句就记下来」的输入框,
 * 那不是我们要的隐私姿态 —— 整个产品的说法是「能在这台设备上做的就不出门」,
 * 语音是里面最私密的一类。
 *
 * 代价是端上模型比云端弱一些,而且**不是每台设备/每种语言都支持**。
 * `supportsOnDeviceRecognition` 为 false 时这里**直接说不可用**,
 * 而不是偷偷退回云端识别 —— 悄悄把用户的录音发出去,比功能不可用严重得多。
 *
 * ## 两条权限
 *
 * 语音识别(`NSSpeechRecognitionUsageDescription`)和麦克风
 * (`NSMicrophoneUsageDescription`)是两件事,两个都要。少一个 Info.plist key
 * 的后果是**闪退**,不是报错 —— iOS 对缺 usage description 一律直接杀进程。
 */
@objc(NesioSpeechPlugin)
public class NesioSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NesioSpeechPlugin"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var listening = false

    // ── 可用性 ──────────────────────────────────────────────────────────────

    /**
     * JS 侧据此决定「摆不摆这个话筒」。**每一条不可用都带一个 reason** ——
     * 「这台设备的端上识别不支持中文」和「你没给麦克风权限」要说不同的话。
     */
    @objc func isAvailable(_ call: CAPPluginCall) {
        let locale = Locale(identifier: call.getString("locale") ?? "zh-CN")
        guard let r = SFSpeechRecognizer(locale: locale) else {
            call.resolve(["available": false, "reason": "locale_unsupported"]); return
        }
        guard r.isAvailable else {
            call.resolve(["available": false, "reason": "recognizer_unavailable"]); return
        }
        if #available(iOS 13.0, *), !r.supportsOnDeviceRecognition {
            // 见文件头:不退回云端。宁可这个按钮不出现。
            call.resolve(["available": false, "reason": "no_on_device_model"]); return
        }
        call.resolve(["available": true, "onDevice": true, "reason": ""])
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.resolve(["speech": status == .denied ? "denied" : "prompt", "microphone": "prompt"])
                return
            }
            // 语音识别给了还不够 —— 没有麦克风就没有音频。两个都问完再回。
            AVAudioSession.sharedInstance().requestRecordPermission { micOK in
                call.resolve([
                    "speech": "granted",
                    "microphone": micOK ? "granted" : "denied",
                ])
            }
        }
    }

    // ── 听写 ────────────────────────────────────────────────────────────────

    /**
     * 开始听。结果通过事件流出去:
     *   `partial` —— 边说边出的临时结果(JS 侧拿它做实时回显)
     *   `result`  —— 一段说完的最终结果(`isFinal`)
     *   `error`   —— 出岔子了,带 reason
     *
     * **`error` 一定会发。** 静默停下来是这个功能以前最大的毛病:
     * 用户对着话筒说了半天,什么都没发生,也不知道是没听见还是没权限。
     */
    @objc func start(_ call: CAPPluginCall) {
        guard !listening else { call.resolve(["ok": true, "already": true]); return }

        let locale = Locale(identifier: call.getString("locale") ?? "zh-CN")
        guard let r = SFSpeechRecognizer(locale: locale), r.isAvailable else {
            call.resolve(["ok": false, "reason": "recognizer_unavailable"]); return
        }
        if #available(iOS 13.0, *), !r.supportsOnDeviceRecognition {
            call.resolve(["ok": false, "reason": "no_on_device_model"]); return
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.resolve(["ok": false, "reason": "not_authorized"]); return
        }
        recognizer = r

        let session = AVAudioSession.sharedInstance()
        do {
            // .duckOthers:正在放的音乐压低而不是掐断 —— 说完一句还能接着听。
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.resolve(["ok": false, "reason": "audio_session_failed"]); return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if #available(iOS 13.0, *) {
            req.requiresOnDeviceRecognition = true   // ← 关键:音频不出这台手机
        }
        request = req

        task = r.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    self.notifyListeners("result", data: ["text": text, "isFinal": true])
                } else {
                    self.notifyListeners("partial", data: ["text": text, "isFinal": false])
                }
            }
            if let error = error {
                self.notifyListeners("error", data: [
                    "reason": "recognition_failed",
                    "message": error.localizedDescription,
                ])
                self.teardown()
            }
        }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buf, _ in
            self?.request?.append(buf)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            teardown()
            call.resolve(["ok": false, "reason": "audio_engine_failed"]); return
        }

        listening = true
        call.resolve(["ok": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        // endAudio 而不是 cancel —— 让引擎把最后半句处理完,`result` 还会来一条。
        // 直接 cancel 的话用户说的最后几个字就没了。
        request?.endAudio()
        teardown()
        call.resolve(["ok": true])
    }

    private func teardown() {
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        task?.finish()
        task = nil
        request = nil
        listening = false
        // 交还音频会话,否则刚才被 duck 下去的音乐不会自己升回来。
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
