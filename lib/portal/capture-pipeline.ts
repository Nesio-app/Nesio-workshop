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
 *
 * 落库/上云:**与记忆照片同一条路** —— putLocalImage(本机) + uploadCloudAsset(云 Storage
 * 得 storagePath)。节点挂两条 asset(local + storagePath),跨端靠记忆图同步带上指针,
 * 别端用签名 URL 读图。此前衣帽间只塞 IDB、记一餐连图都不存 → 「文字同步了、图永远没有」。
 * module-data 的 wardrobe-image 同步仍作 IDB 补缺兜底(全身照/试穿图没有节点时)。
 */
import { compressToDataUrl, getLocalImage, putLocalImage } from './local-image-store';
import type { LifeNodeAsset } from './life-graph';

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

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType || 'image/jpeg' });
}

function newAssetId(prefix: string): string {
  try { return `${prefix}-${crypto.randomUUID()}`; } catch { return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}`; }
}

export interface PersistedCapture {
  assetId: string;
  dataUrl: string;
  mimeType: string;
  storagePath?: string;
  /** 挂到 life-graph 节点上的 asset 列表(本机 + 可选云孪生,同 CameraSheet 记忆路径)。 */
  assets: LifeNodeAsset[];
}

/**
 * 本机存 + 云 Storage 上传(与记忆照片同构)。
 * 本机失败 → 返回 null(调用方给可见错误);云上传失败 → 仍返回本机结果(离线可用,下次靠 module-sync / 重试)。
 */
export async function persistCapturedPhoto(opts: {
  dataUrl: string;
  purpose: 'wardrobe' | 'meal' | 'memory' | 'attachment';
  assetId?: string;
  label?: string;
}): Promise<PersistedCapture | null> {
  const assetId = opts.assetId || newAssetId(opts.purpose === 'meal' ? 'meal' : opts.purpose === 'wardrobe' ? 'wardrobe' : 'asset');
  const mimeType = 'image/jpeg';
  const ok = await putLocalImage(assetId, opts.dataUrl);
  if (!ok) return null;

  const localAsset: LifeNodeAsset = {
    id: assetId,
    kind: 'image',
    local: true,
    mimeType,
    label: opts.label,
    createdAt: new Date().toISOString(),
  };
  const assets: LifeNodeAsset[] = [localAsset];
  let storagePath: string | undefined;

  try {
    const file = dataUrlToFile(opts.dataUrl, `${assetId}.jpg`);
    if (file) {
      const { createAppApiClient } = await import('./app-api-client');
      const upload = await createAppApiClient().uploadCloudAsset({ file, purpose: opts.purpose });
      if (upload.ok && upload.storagePath) {
        storagePath = upload.storagePath;
        assets.push({
          id: `cloud-${assetId}`,
          kind: 'image',
          storagePath,
          mimeType: upload.mimeType || mimeType,
          label: opts.label,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch { /* 云上传 best-effort;本机副本已在 */ }

  if (opts.purpose === 'wardrobe') kickWardrobeImageSync();
  return { assetId, dataUrl: opts.dataUrl, mimeType, storagePath, assets };
}

/**
 * 衣帽间照片落地(兼容旧调用):本机 + 云 Storage + IDB 补缺同步。
 * 有 storagePath 时调用方应把它写进节点 assets,换端才能靠签名 URL 看见。
 */
export async function storeWardrobeImage(assetId: string, dataUrl: string): Promise<boolean> {
  const r = await persistCapturedPhoto({ dataUrl, purpose: 'wardrobe', assetId });
  return Boolean(r);
}

/** 同 storeWardrobeImage,但把 storagePath / assets 交还给调用方挂到节点上。 */
export async function storeWardrobeImageFull(assetId: string, dataUrl: string, label?: string): Promise<PersistedCapture | null> {
  return persistCapturedPhoto({ dataUrl, purpose: 'wardrobe', assetId, label });
}

/**
 * 读图:本机 IDB 优先,没有就按 storagePath 换签名 URL(换端必经此路)。
 * 签名 URL 成功时顺手写回本机,下次离线也能看。
 */
export async function resolveAssetDisplayUrl(opts: {
  assetId?: string | null;
  storagePath?: string | null;
}): Promise<string | null> {
  if (opts.assetId) {
    try {
      const local = await getLocalImage(opts.assetId);
      if (local) return local;
    } catch { /* ignore */ }
  }
  if (!opts.storagePath) return null;
  try {
    const { createAppApiClient } = await import('./app-api-client');
    const result = await createAppApiClient().fetchCloudAssetReadUrl({ storagePath: opts.storagePath });
    if (!result.ok || !result.signedUrl) return null;
    // 换端首次拉到 → fetch 成 dataURL 缓存进本机(signedUrl 会过期,不能直接塞 IDB)。
    void (async () => {
      if (!opts.assetId) return;
      try {
        const res = await fetch(result.signedUrl!);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await compressToDataUrl(blob);
        if (dataUrl) await putLocalImage(opts.assetId, dataUrl);
      } catch { /* ignore */ }
    })();
    return result.signedUrl;
  } catch { return null; }
}

let kickTimer: number | null = null;
/**
 * 存完立即推 / 打开衣帽间立即拉(force 绕开 30s 节流)。IDB 补缺通道的触发器;
 * 主路径已是 uploadCloudAsset,这条兜底全身照/试穿图和未拿到 storagePath 的旧图。
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
