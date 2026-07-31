/**
 * 平台能力抽象(Capacitor 就绪)—— 一套 web 代码 + 一层薄原生插件的**唯一检测点**,
 * 防止 web / 原生两个构建能力漂移。调用方问"这个能力用什么实现",不各自 if 判平台。
 *
 * 每个能力返回 'native' | 'web' | 'none':
 *  - native:有原生插件(Capacitor 桥),用原生(端上 Apple 语音/Vision/Foundation Models、原生推送)。
 *  - web  :无原生但有 Web API / 浏览器内 ML,用 web 兜底。
 *  - none :两者都没有 → 降级到手动/模板(别崩)。
 *
 * SSR 安全:服务端一律 'none'(无 window)。原生插件的具体桥接在 Capacitor 打包阶段接,
 * 这里只做**存在性检测**,不 import 原生包(web 构建不该链原生)。
 */

export type CapabilityImpl = 'native' | 'web' | 'none';

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}
function bridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor ?? null;
}

/** 是否跑在 Capacitor 原生壳里(iOS/Android 原生构建)。 */
export function isNativePlatform(): boolean {
  const b = bridge();
  return !!(b && b.isNativePlatform && b.isNativePlatform());
}

function hasNativePlugin(name: string): boolean {
  const b = bridge();
  return !!(b && b.Plugins && name in b.Plugins);
}

/** 浏览器内 GPU 加速(端上 ML 快慢分水岭;iOS 17+)。 */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** 语音转文字。native: 原生 SFSpeech;web: Web Speech API(iOS 用端上 Siri 听写)。 */
export function speechToText(): CapabilityImpl {
  if (hasNativePlugin('SpeechRecognition')) return 'native';
  if (typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) return 'web';
  return 'none';
}

/**
 * 视觉/OCR。**只有 native 一条真路**,web 一律 'none'。
 *
 * ## 这里原来在撒谎
 *
 * 原实现是「有 WebGPU 就返回 'web'」,注释写着「浏览器内 ML
 * (transformers.js/MediaPipe)」—— **那个实现不存在**。后果不是少个功能,是
 * 任何有 WebGPU 的浏览器上,能力汇总都会报 `vision: 'web'`,而真去调
 * `recognizeOnDevice()` 拿到的是 `not_native`。谁信了这个汇总去排功能可用性,
 * 就会排出一条根本走不通的路。
 *
 * 同一个关切**不许有两个判据**。运行时的权威是 `lib/native/vision.ts`
 * (`visionAvailability()` / `recognizeOnDevice()`),它设计上就没有 web 分支:
 * 端上不可用 → 明说 + 引导手填,**绝不改走云**(化验单是病历,发票上是税号和金额)。
 * 这个函数是那条判据的**同步快照**,只能比它保守,不能比它乐观。
 *
 * ## 为什么现在不做浏览器端 OCR
 *
 * 不是技术问题,是场景:浏览器不是拍照的地方。化验单、小票都是手机拍的,
 * web 端是回看和整理的面。为一个不发生拍照的场景建 WASM OCR,
 * 是把最贵的选项花在最少发生的事情上。
 *
 * 将来真要做,走 Rust→WASM,不要 Tesseract.js。**那时这段注释和下面的实现
 * 必须一起改** —— 上一次就是注释先跑到实现前面去,才留下这个假的 'web'。
 */
export function vision(): CapabilityImpl {
  if (hasNativePlugin('Vision')) return 'native';
  return 'none';
}

/** 端上免费 LLM(Apple Foundation Models,iOS 26+)。仅原生插件可得,纯 PWA 拿不到。 */
export function onDeviceLLM(): CapabilityImpl {
  return hasNativePlugin('AppleIntelligence') ? 'native' : 'none';
}

/** 推送。native: 原生 APNs;web: Web Push(iOS 16.4+ 且已加主屏)。 */
export function push(): CapabilityImpl {
  if (hasNativePlugin('PushNotifications')) return 'native';
  if (typeof window !== 'undefined' && 'Notification' in window &&
    'serviceWorker' in navigator && 'PushManager' in window) return 'web';
  return 'none';
}

/** 本地通知(到点提醒)。native: NesioLocalNotify(自研);web: 不可靠 → none。 */
export function localNotifications(): CapabilityImpl {
  if (hasNativePlugin('NesioLocalNotify') || hasNativePlugin('LocalNotifications')) return 'native';
  return 'none';
}

/** 定位。native: NesioGeolocation(使用期间/Always);web: navigator.geolocation。 */
export function geolocation(): CapabilityImpl {
  if (hasNativePlugin('NesioGeolocation') || hasNativePlugin('Geolocation')) return 'native';
  if (typeof navigator !== 'undefined' && !!navigator.geolocation) return 'web';
  return 'none';
}

/** HealthKit 读。仅原生壳;web 走导出文件。 */
export function healthKit(): CapabilityImpl {
  if (hasNativePlugin('NesioHealthKit')) return 'native';
  return 'none';
}

/** 相机/录音(getUserMedia)。web 基本全平台可用;native 插件可选。 */
export function camera(): CapabilityImpl {
  if (hasNativePlugin('Camera')) return 'native';
  if (typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') return 'web';
  return 'none';
}

/**
 * 发邮件。native: 系统写信卡(MFMailComposeViewController —— Nesio 内弹出、AI 预填、
 * 用户点发送;$0 且免 Google 受限 scope 验证,v1 决策);web: Gmail API send
 * (/api/portal/gmail/send,需已连接 Gmail);none: 回退 mailto:(会跳走)/复制正文。
 * 原生插件必须先查 canSendMail() —— 设备没配系统邮件账号(只用 Gmail App 的用户)时
 * composer 不可用,插件应报 'none' 让调用方走兜底,否则点「回复」没反应。
 * Pro 门挂在 AI 起草上,不挂在发送上(发送是系统能力,成本在起草)。
 */
export function composeEmail(): CapabilityImpl {
  if (hasNativePlugin('EmailComposer')) return 'native';
  if (typeof window !== 'undefined') return 'web'; // Gmail send 路由;未连接由调用方引导
  return 'none';
}

/** 一次性快照 —— 调试 / 分析(匿名,别带内容),看这台设备的能力矩阵。 */
export function capabilitiesSnapshot(): Record<string, CapabilityImpl | boolean> {
  return {
    native: isNativePlatform(),
    webgpu: hasWebGPU(),
    speechToText: speechToText(),
    vision: vision(),
    onDeviceLLM: onDeviceLLM(),
    push: push(),
    localNotifications: localNotifications(),
    geolocation: geolocation(),
    camera: camera(),
    composeEmail: composeEmail(),
  };
}
