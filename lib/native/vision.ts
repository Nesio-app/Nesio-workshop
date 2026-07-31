/**
 * vision — 端上文字识别的 JS 桥(健康镜头 B 屏,2026-07-29)。
 *
 * 对面是 Capacitor 插件 `Vision`(treasurebox-ios/.../NesioVisionPlugin.swift),
 * 用 Apple Vision framework 做 OCR。**图片一个字节都不离开这台手机。**
 *
 * 三条:
 *   ① **没有插件就老实说没有**,不静默降级、不假装识别失败。
 *      「这台壳里没带端上识别」和「这张图没认出字」是两回事,混成一句
 *      用户就永远搞不清该重拍还是该手填。
 *   ② **绝不偷偷改走云端。** 化验单是病历,不因为端上不可用就换条路发出去。
 *      端上没有 → 引导手填(表单本来就有)。
 *   ③ 超时要有。Vision 对一张大图可能跑几秒,但不该无限等 —— 卡住比失败更难受。
 */

import { logDropped } from '@/lib/portal/storage-health';

export type VisionUnavailableReason =
  | 'not_native'      // 在浏览器/PWA 里,没有原生壳
  | 'plugin_missing'  // 有壳,但这次构建没带 Vision 插件(需要重出 IPA)
  | 'ios_too_old';

export type VisionResult =
  | { ok: true; text: string; lines: Array<{ text: string; confidence: number }> }
  | { ok: false; reason: VisionUnavailableReason | 'failed' | 'timeout'; message: string };

const TIMEOUT_MS = 20_000;

interface VisionPlugin {
  recognizeText(o: { imageBase64: string }): Promise<{
    /**
     * 原生侧成败标志。**必须看它** —— 见下。
     *
     * 2026-07-31:原生那边把六条失败路径从 `call.reject` 换成了
     * `call.resolve({ok:false, reason, message})`。理由是 Capacitor 8 的
     * 预编译 xcframework 把 `reject` 藏在 `$NonescapableTypes` 门后
     * (Swift 6.0 才有的特性),Xcode 15 上根本调不到。
     *
     * ⚠️ 那次改动如果不同步改这里,后果是**失败被当成成功**:
     * reject 会触发下面的 catch,resolve 不会 —— `text` 是 undefined,
     * `String(undefined || '')` 得到空串,于是「识别失败」变成
     * 「这张图上没有字」。两者对用户是完全不同的下一步。
     */
    ok?: boolean;
    reason?: string;
    message?: string;
    text?: string;
    lines?: Array<{ text: string; confidence: number }>;
  }>;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
}

function plugin(): VisionPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap) return null;
  const p = cap.Plugins?.Vision;
  return p ? (p as unknown as VisionPlugin) : null;
}

/** 这台设备现在能不能做端上识别。UI 用它决定是给「拍化验单」还是只给「手填」。 */
export async function visionAvailability(): Promise<{ available: boolean; reason?: VisionUnavailableReason }> {
  if (typeof window === 'undefined') return { available: false, reason: 'not_native' };
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return { available: false, reason: 'not_native' };
  const p = plugin();
  // 有原生壳但没有这个插件 = 这次 IPA 构建里没带它,得重出一次。这句必须能传到 UI。
  if (!p) return { available: false, reason: 'plugin_missing' };
  try {
    const r = await p.isAvailable();
    if (r?.available) return { available: true };
    return { available: false, reason: r?.reason === 'ios_too_old' ? 'ios_too_old' : 'plugin_missing' };
  } catch (err) {
    logDropped('vision.is_available', err);
    return { available: false, reason: 'plugin_missing' };
  }
}

/** data URI / 裸 base64 都收,统一剥成裸 base64 交给原生。 */
export function stripDataUri(s: string): string {
  const i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 'base64,'.length) : s;
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 一次性 apply 大数组会爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * 端上识别一张图。
 * **只走端上**;端上不可用时返回 ok:false + 原因,由调用方给出人话和出路。
 */
export async function recognizeOnDevice(image: Blob | string): Promise<VisionResult> {
  const avail = await visionAvailability();
  if (!avail.available) {
    return { ok: false, reason: avail.reason || 'plugin_missing', message: unavailableMessage(avail.reason) };
  }
  const p = plugin();
  if (!p) return { ok: false, reason: 'plugin_missing', message: unavailableMessage('plugin_missing') };

  let imageBase64: string;
  try {
    imageBase64 = typeof image === 'string' ? stripDataUri(image) : await fileToBase64(image);
  } catch (err) {
    logDropped('vision.encode', err);
    return { ok: false, reason: 'failed', message: '这张图读不出来,换一张试试。' };
  }

  try {
    const race = await Promise.race([
      p.recognizeText({ imageBase64 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
    // 原生失败现在走 resolve 而不是 reject(见 VisionPlugin 的注释)——
    // 不显式判这一句的话,失败会静默变成「这张图上没有字」。
    if (race?.ok === false) {
      const known: VisionUnavailableReason[] = ['ios_too_old'];
      const reason = known.find((k) => k === race.reason);
      return reason
        ? { ok: false, reason, message: unavailableMessage(reason) }
        : { ok: false, reason: 'failed', message: race.message || '这张没认出来。拍近一点、把整张单子放平再试试。' };
    }
    const text = String(race?.text || '');
    return { ok: true, text, lines: race?.lines || [] };
  } catch (err) {
    if (err instanceof Error && err.message === 'timeout') {
      return { ok: false, reason: 'timeout', message: '识别用的时间有点久,先手填吧,或者拍近一点再试。' };
    }
    logDropped('vision.recognize', err);
    return { ok: false, reason: 'failed', message: '这张没认出来。拍近一点、把整张单子放平再试试。' };
  }
}

/** 把机器原因翻成一句人话。混着说会让人不知道下一步该干嘛。 */
export function unavailableMessage(reason?: VisionUnavailableReason): string {
  if (reason === 'not_native') return '拍化验单要在 iPhone 上的 Nesio 里用(网页版没有端上识别)。先手填也行。';
  if (reason === 'ios_too_old') return '这台设备的系统版本用不了端上识别,先手填吧。';
  return '这个版本的 App 还没带端上识别 —— 重新装一次新版本就有了。现在可以先手填。';
}
