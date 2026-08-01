/**
 * speech —— 端上语音转文字的 JS 桥。
 *
 * 对面是 Capacitor 插件 `SpeechRecognition`
 * (treasurebox-ios/.../NesioSpeechPlugin.swift),用 `SFSpeechRecognizer` +
 * `requiresOnDeviceRecognition = true`。**录音一个字节都不离开这台手机。**
 *
 * ## 它补的是一个被关掉的功能
 *
 * iOS 的 WKWebView 里 Web `SpeechRecognition` 根本不存在,所以今天页那个话筒
 * 以前每次点都失败、每次都挂一条「语音输入没起来」的横幅。上一轮的处理是
 * 「探不到引擎就不摆这个话筒」—— 按钮直接收起来了。
 *
 * `platform-capabilities.ts` 的 `speechEngine()` 探的就是这个插件名,
 * 装上带插件的壳之后它会自己返回 `'native'`,话筒自己会回来 —— **那边不用改**。
 *
 * ## 三条,和 vision.ts 同一套
 *
 *   ① **没有插件就老实说没有。**「这版壳没带」和「这次没听清」是两回事。
 *   ② **绝不偷偷改走云端。** 端上模型不支持这个语言时返回不可用,
 *      而不是退回 Apple 的服务器识别 —— 悄悄把录音发出去比功能不可用严重得多。
 *   ③ 停下来一定要有个说法。以前最大的毛病就是对着话筒说半天什么都没发生。
 */

import { logDropped } from '@/lib/portal/storage-health';

export type SpeechUnavailableReason =
  | 'not_native'            // 浏览器/PWA,没有原生壳
  | 'plugin_missing'        // 有壳,但这次构建没带这个插件(要重出 IPA)
  | 'locale_unsupported'    // 这台设备不认这个语言
  | 'recognizer_unavailable'
  | 'no_on_device_model'    // 有识别器,但端上模型没装 —— 见 ② ,不退云端
  | 'not_authorized';

export interface SpeechEvents {
  /** 边说边出的临时结果,拿来做实时回显。 */
  onPartial?: (text: string) => void;
  /** 一段说完的最终结果。 */
  onResult?: (text: string) => void;
  /** 出岔子了。**一定会调** —— 静默停下来是这个功能以前最大的毛病。 */
  onError?: (reason: string, message: string) => void;
}

interface SpeechPlugin {
  isAvailable(o?: { locale?: string }): Promise<{ available: boolean; onDevice?: boolean; reason?: string }>;
  requestPermissions(): Promise<{ speech?: string; microphone?: string }>;
  start(o?: { locale?: string }): Promise<{ ok?: boolean; reason?: string }>;
  stop(): Promise<{ ok?: boolean }>;
  addListener(
    event: 'partial' | 'result' | 'error',
    cb: (data: { text?: string; isFinal?: boolean; reason?: string; message?: string }) => void,
  ): Promise<{ remove: () => void }>;
}

function plugin(): SpeechPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = cap?.Plugins?.SpeechRecognition;
  return p ? (p as unknown as SpeechPlugin) : null;
}

function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

const DEFAULT_LOCALE = 'zh-CN';

/** 这台设备现在能不能端上听写。UI 用它决定摆不摆那个话筒。 */
export async function speechAvailability(
  locale: string = DEFAULT_LOCALE,
): Promise<{ available: boolean; reason?: SpeechUnavailableReason }> {
  if (!isNative()) return { available: false, reason: 'not_native' };
  const p = plugin();
  if (!p) return { available: false, reason: 'plugin_missing' };
  try {
    const r = await p.isAvailable({ locale });
    if (r?.available) return { available: true };
    const known: SpeechUnavailableReason[] = ['locale_unsupported', 'recognizer_unavailable', 'no_on_device_model'];
    const reason = known.find((k) => k === r?.reason) || 'plugin_missing';
    return { available: false, reason };
  } catch (err) {
    logDropped('speech.is_available', err);
    return { available: false, reason: 'plugin_missing' };
  }
}

/**
 * 开始听。返回一个 `stop()` —— 调它把最后半句也收完再停。
 *
 * 拿不到就返回 `null` 并且**已经**通过 `onError` 说明了原因,
 * 调用方不用再自己编一句话。
 */
export async function startOnDeviceSpeech(
  events: SpeechEvents,
  locale: string = DEFAULT_LOCALE,
): Promise<null | (() => Promise<void>)> {
  const avail = await speechAvailability(locale);
  if (!avail.available) {
    events.onError?.(avail.reason || 'plugin_missing', speechUnavailableMessage(avail.reason));
    return null;
  }
  const p = plugin();
  if (!p) {
    events.onError?.('plugin_missing', speechUnavailableMessage('plugin_missing'));
    return null;
  }

  try {
    const perm = await p.requestPermissions();
    if (perm?.speech !== 'granted' || perm?.microphone !== 'granted') {
      // 两个权限分开说 —— 「去开麦克风」和「去开语音识别」在设置里是两个不同的地方。
      const missing = perm?.microphone !== 'granted' ? '麦克风' : '语音识别';
      events.onError?.('not_authorized', `还差一个${missing}权限。去「设置 → 宝盒」里打开就能用了。`);
      return null;
    }
  } catch (err) {
    logDropped('speech.permissions', err);
    events.onError?.('not_authorized', '权限没问下来,先用打字吧。');
    return null;
  }

  const subs: Array<{ remove: () => void }> = [];
  try {
    subs.push(await p.addListener('partial', (d) => { if (d?.text) events.onPartial?.(d.text); }));
    subs.push(await p.addListener('result', (d) => { if (d?.text) events.onResult?.(d.text); }));
    subs.push(await p.addListener('error', (d) => {
      events.onError?.(d?.reason || 'failed', '刚才那段没听清 —— 再说一次,或者直接打字。');
    }));

    const res = await p.start({ locale });
    if (!res?.ok) {
      subs.forEach((s) => s.remove());
      events.onError?.(res?.reason || 'failed', '话筒没起来。检查一下是不是别的应用正在录音。');
      return null;
    }
  } catch (err) {
    subs.forEach((s) => s.remove());
    logDropped('speech.start', err);
    events.onError?.('failed', '话筒没起来,先用打字吧。');
    return null;
  }

  return async () => {
    try { await p.stop(); } catch (err) { logDropped('speech.stop', err); }
    // 先 stop 再摘监听:stop 之后原生还会补最后一条 result,
    // 反过来的话用户说的最后几个字就没了。
    setTimeout(() => subs.forEach((s) => s.remove()), 1200);
  };
}

/** 把机器原因翻成一句人话。混着说会让人不知道下一步该干嘛。 */
export function speechUnavailableMessage(reason?: SpeechUnavailableReason): string {
  switch (reason) {
    case 'not_native':
      return '语音输入要在 iPhone 上的宝盒里用(网页版没有)。先打字也行。';
    case 'locale_unsupported':
    case 'no_on_device_model':
      return '这台设备还没装好中文的端上语音包 —— 在「设置 → 通用 → 键盘 → 听写」里打开一次就会下载。现在可以先打字。';
    case 'not_authorized':
      return '还差一个权限。去「设置 → 宝盒」里打开麦克风和语音识别。';
    default:
      return '这个版本的 App 还没带端上语音 —— 装一次新版本就有了。现在可以先打字。';
  }
}
