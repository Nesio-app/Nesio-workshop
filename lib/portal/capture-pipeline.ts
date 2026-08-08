/**
 * 统一拍摄管线(2026-08-08 用户定案:「任何一个入口拍摄,包括衣帽间,应该都是主相机的
 * 一个便捷入口,各种模式都是一致的」)。
 *
 * 一条链路:入口派 OPEN_MODE_CAMERA_EVENT → Portal 关掉压在相机上面的全屏 sheet
 * (相机 z=400 < 洞察浮层 901,同进货模式踩过的坑)→ CameraSheet 以该模式打开
 * (取景框/相册/压缩全复用)→ 拍完压缩成 dataURL 放进这里的「交接匣」→ Portal 重开
 * 来源 sheet → 来源 sheet 挂载时取走照片,继续自己的后处理(记一餐认菜品/衣帽间认衣物)。
 *
 * 为什么是交接匣不是回调/事件:来源 sheet 在拍摄期间是**卸载**的(z 序所迫),
 * 回调没有挂着的接收方;交接匣 + 重开 + 挂载时取,时序上永远成立。
 */
import { compressToDataUrl, putLocalImage } from './local-image-store';

export type ModeCameraMode = 'meal' | 'wardrobe';
export interface CapturedPhoto { file: File; dataUrl: string }

export const OPEN_MODE_CAMERA_EVENT = 'nesio-open-mode-camera';

/** 入口调这个:带模式调起主相机(Portal 监听,负责关洞察/做饭再开相机)。 */
export function openModeCamera(mode: ModeCameraMode): void {
  try { window.dispatchEvent(new CustomEvent(OPEN_MODE_CAMERA_EVENT, { detail: { mode } })); } catch { /* ignore */ }
}

/** 拍摄/选图统一压缩(1400px/0.82,与记忆识别、本机存储同参)。失败返回 null,调用方给可见错误。 */
export async function prepareCapturedPhoto(file: File): Promise<CapturedPhoto | null> {
  try {
    const dataUrl = await compressToDataUrl(file);
    return dataUrl ? { file, dataUrl } : null;
  } catch { return null; }
}

// ── 交接匣(单格):相机拍完放进来,来源 sheet 重开挂载后取走。 ──
let pending: { mode: ModeCameraMode; photo: CapturedPhoto } | null = null;

export function setPendingCapture(mode: ModeCameraMode, photo: CapturedPhoto): void {
  pending = { mode, photo };
}

/** 取走并清空(只认同模式的)。没有就 null —— 来源 sheet 正常打开时就是这个分支。 */
export function takePendingCapture(mode: ModeCameraMode): CapturedPhoto | null {
  if (!pending || pending.mode !== mode) return null;
  const p = pending.photo;
  pending = null;
  return p;
}

/**
 * 衣帽间照片落地:本机图库 + 立即推云(cloud-wardrobe-image-sync)。
 * 存储与同步是同一件事 —— 别在各个调用方自己拼「存完记得推」。
 */
export async function storeWardrobeImage(assetId: string, dataUrl: string): Promise<boolean> {
  const ok = await putLocalImage(assetId, dataUrl);
  if (ok) kickWardrobeImageSync();
  return ok;
}

let kickTimer: number | null = null;
/**
 * 存完立即推 / 打开衣帽间立即拉(force 绕开 30s 节流)。不加这个的话推送要等下一次
 * 「切后台再切回」的同步批次 —— 两台设备来回看,体感就是「怎么都不同步」。
 * 尾沿去抖 800ms:批量上传 20 张不该触发 20 次并发同步。best-effort,批次的离线队列仍是兜底。
 */
export function kickWardrobeImageSync(): void {
  if (typeof window === 'undefined') return;
  if (kickTimer != null) window.clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => {
    kickTimer = null;
    void import('./cloud-wardrobe-image-sync')
      .then((m) => m.autoSyncWardrobeImagesWithCloud({ force: true }))
      .catch(() => { /* ignore */ });
  }, 800);
}
