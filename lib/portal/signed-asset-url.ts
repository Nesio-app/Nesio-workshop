/**
 * signed-asset-url —— 云端图片的**签名 URL 会过期**,过期了得能自己换一张。
 *
 * ## 病灶
 *
 * 云端资产(头像、记忆附件、地点封面)存的都是**有时效的签名 URL**。
 * 过期之后 `<img>` 请求 403,渲染成浏览器那个破图图标 ——
 * 真机上看到的就是「照片时不时变成一个方块」。
 *
 * 头像这条 2026 批次 11 修过:`useProfileAvatar` 在 `<img onError>` 时
 * 用 `storagePath` 重新换一张签名。**但记忆附件没有** ——
 * `MemoryNodeDetail` 挂载时取一次 URL,之后再不管;签名一过期就一直破着,
 * 直到你关掉详情页再打开一次。用户说的「上传的照片附件也不稳定」就是这个。
 *
 * 这个模块把那套验证过的做法抽出来,让两边共用一份。
 *
 * ## 为什么先置空再换
 *
 * 直接把新 URL 塞回去的话,浏览器会**先渲染破图**,等新图加载完才恢复 ——
 * 中间那一下闪烁比不换更难看。先置空退回占位符,拿到新的再放上去。
 */

import { createAppApiClient } from './app-api-client';

/** 同一个 storagePath 短时间内只换一次 —— 一屏十几张图同时过期会打十几趟。 */
const inFlight = new Map<string, Promise<string>>();

/**
 * 换一张新的签名 URL。失败返回空串(调用方退回占位符,别摆着破图)。
 *
 * **同 path 并发去重**:一屏图片往往是同一批签的,会同时过期、同时 onError。
 * 不去重的话一瞬间十几趟请求 —— 而它们要的是同一个答案。
 */
export async function refreshSignedAssetUrl(storagePath: string): Promise<string> {
  if (!storagePath) return '';
  const pending = inFlight.get(storagePath);
  if (pending) return pending;

  const p = createAppApiClient()
    .fetchCloudAssetReadUrl({ storagePath })
    .then((r) => (r.ok && r.signedUrl ? r.signedUrl : ''))
    .catch(() => '')          // 离线/未登录:换不到就退占位符,不抛
    .finally(() => { inFlight.delete(storagePath); });

  inFlight.set(storagePath, p);
  return p;
}

/**
 * 给 `<img onError>` 用的一次性重试。
 *
 * **只重试一次**(靠 `dataset.retried` 标记)。签名过期换一张能好;
 * 但如果是资产真的没了 / 权限没了,换多少次都是 403 ——
 * 不设上限就会变成一个每帧打一次请求的死循环,而用户只看到图一直在闪。
 */
export function makeAssetErrorHandler(
  storagePath: string | undefined,
  onFresh: (url: string) => void,
): (e: { currentTarget: HTMLImageElement }) => void {
  return (e) => {
    const img = e.currentTarget;
    if (!storagePath || img.dataset.retried === '1') return;
    img.dataset.retried = '1';
    // 先摘掉坏的 —— 否则新图加载期间那个破图图标还杵在那儿。
    onFresh('');
    void refreshSignedAssetUrl(storagePath).then((url) => { if (url) onFresh(url); });
  };
}
