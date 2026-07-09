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

/** 视觉/OCR。native: 原生 Vision;web: 浏览器内 ML(transformers.js/MediaPipe,WebGPU 优先)。 */
export function vision(): CapabilityImpl {
  if (hasNativePlugin('Vision')) return 'native';
  if (typeof window !== 'undefined' && hasWebGPU()) return 'web';
  return 'none'; // 无 WebGPU 也可退 WASM,但性能差,交由调用方决定是否上
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

/** 相机/录音(getUserMedia)。web 基本全平台可用;native 插件可选。 */
export function camera(): CapabilityImpl {
  if (hasNativePlugin('Camera')) return 'native';
  if (typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') return 'web';
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
    camera: camera(),
  };
}
