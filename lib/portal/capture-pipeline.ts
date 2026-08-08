/**
 * 统一拍摄管线(2026-08-08 用户定案:「任何一个入口拍摄,包括衣帽间,应该都是主相机的
 * 一个便捷入口,各种模式都是一致的」)。
 *
 * 一条链路:入口派 OPEN_MODE_CAMERA_EVENT → Portal 关掉压在相机上面的全屏 sheet
 * (相机 z=400 < 洞察浮层 901,同进货模式踩过的坑)→ CameraSheet 以该模式打开
 * (取景框/相册/压缩全复用)→ 拍完压缩成 dataURL 放进这里的「交接匣」→ Portal 重开
 * 来源 sheet → 来源 sheet 挂载时取走照片,继续自己的后处理(记一餐认菜品/衣帽间认衣物)。
 *
 * 落库/上云:**必须与主相机 CameraSheet 同构**,三步缺一不可:
 *   ① putLocalImage(本机)
 *   ② uploadCloudAsset(purpose:'memory' → Supabase Storage 得 storagePath)
 *   ③ saveCloudMemorySnapshot({ nodes, assets:[{... , nodeId}] }) 写入 memory_assets
 * 服务端 sanitizeMemoryNode 会剥掉 node.assets;只 updateLifeNode / 只塞 IDB
 * → 换端永远只有文字。主相机能同步、别的入口不能 = 以前漏了 ③。
 */
import { compressToDataUrl, getLocalImage, putLocalImage } from './local-image-store';
import type { LifeNode, LifeNodeAsset } from './life-graph';

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
  assets: LifeNodeAsset[];
}

/**
 * 本机存 + 云 Storage 上传(与主相机同构,purpose 固定 memory —— 那是唯一验证过能跨端的桶路径)。
 * 本机失败 → null;云失败 → 仍返回本机结果(离线可用)。
 * **注意**:这一步还没把 asset 写进 memory_assets —— 必须再调 attachPhotoToMemoryNode /
 * pushNodeAssetsToCloud,否则换端看不见。
 */
export async function persistCapturedPhoto(opts: {
  dataUrl: string;
  /** 仅用于本地 assetId 前缀;云上传一律 purpose=memory(与主相机一致)。 */
  kind?: 'wardrobe' | 'meal' | 'memory' | 'attachment';
  assetId?: string;
  label?: string;
}): Promise<PersistedCapture | null> {
  const kind = opts.kind || 'memory';
  const assetId = opts.assetId || newAssetId(kind === 'meal' ? 'meal' : kind === 'wardrobe' ? 'wardrobe' : 'asset');
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
      // purpose 必须是 memory —— 主相机唯一验证过的跨端路径;契约也锁这个。
      const upload = await createAppApiClient().uploadCloudAsset({ file, purpose: 'memory' });
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

  if (kind === 'wardrobe') kickWardrobeImageSync();
  return { assetId, dataUrl: opts.dataUrl, mimeType, storagePath, assets };
}

/**
 * 把照片挂到记忆节点并**立刻**推 memory_assets(主相机收尾三步里的 ③)。
 * 这是换端能看见的关键一步 —— 漏了就只剩本机图。
 */
export async function attachPhotoToMemoryNode(opts: {
  nodeId: string;
  dataUrl: string;
  kind?: 'wardrobe' | 'meal' | 'memory';
  assetId?: string;
  label?: string;
}): Promise<PersistedCapture | null> {
  const persisted = await persistCapturedPhoto({
    dataUrl: opts.dataUrl,
    kind: opts.kind,
    assetId: opts.assetId,
    label: opts.label,
  });
  if (!persisted) return null;

  const { getLifeGraph, updateLifeNode } = await import('./life-graph');
  const live = getLifeGraph().find((n) => n.id === opts.nodeId);
  if (!live) return persisted;

  const mergedAssets = [...(live.assets || [])];
  for (const a of persisted.assets) {
    if (!mergedAssets.some((x) => x.id === a.id || (a.storagePath && x.storagePath === a.storagePath))) {
      mergedAssets.push(a);
    }
  }
  updateLifeNode(opts.nodeId, { assets: mergedAssets });

  // 显式推 memory_assets(与 CameraSheet.saveCloudMemorySnapshot 同构)。
  // syncLifeGraphUpsertToCloud 现在也会带 assets,这里再推一次:上传刚完成时
  // updateLifeNode 的异步 upsert 可能还在飞,且 cloud asset 必须带 nodeId。
  const cloudOnes = persisted.assets
    .filter((a) => a.storagePath)
    .map((a) => ({ ...a, nodeId: opts.nodeId }));
  if (cloudOnes.length) {
    try {
      const { createAppApiClient } = await import('./app-api-client');
      const node = getLifeGraph().find((n) => n.id === opts.nodeId);
      if (node) {
        await createAppApiClient().saveCloudMemorySnapshot({
          nodes: [node as LifeNode],
          assets: cloudOnes,
        });
      }
    } catch { /* best-effort;通用 upsert 仍是兜底 */ }
  }
  return persisted;
}

/** 节点已有 assets(含 storagePath)时,立刻推 memory_assets —— 给 addGarment 创建时已带图用。 */
export async function pushNodeAssetsToCloud(nodeId: string): Promise<void> {
  try {
    const { getLifeGraph } = await import('./life-graph');
    const node = getLifeGraph().find((n) => n.id === nodeId);
    if (!node) return;
    const cloudOnes = (node.assets || [])
      .filter((a) => a.storagePath)
      .map((a) => ({ ...a, nodeId }));
    if (!cloudOnes.length) return;
    const { createAppApiClient } = await import('./app-api-client');
    await createAppApiClient().saveCloudMemorySnapshot({ nodes: [node], assets: cloudOnes });
  } catch { /* ignore */ }
}

/**
 * 衣帽间照片落地(兼容旧调用):本机 + 云 Storage。
 * 有节点时请改用 attachPhotoToMemoryNode / storeWardrobeImageFull + pushNodeAssetsToCloud。
 */
export async function storeWardrobeImage(assetId: string, dataUrl: string): Promise<boolean> {
  const r = await persistCapturedPhoto({ dataUrl, kind: 'wardrobe', assetId });
  return Boolean(r);
}

export async function storeWardrobeImageFull(assetId: string, dataUrl: string, label?: string): Promise<PersistedCapture | null> {
  return persistCapturedPhoto({ dataUrl, kind: 'wardrobe', assetId, label });
}

/**
 * 读图:本机 IDB 优先,没有就按 storagePath 换签名 URL(换端必经此路)。
 * 签名 URL 成功时 fetch 成 dataURL 缓存进本机。
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

/**
 * 补传:本机有图、节点上还没有 storagePath 的衣物/一餐 —— 上传并推 memory_assets。
 * 打开衣帽间/同步批次时跑;幂等(已有 storagePath 的跳过)。
 */
export async function backfillMissingPhotoUploads(opts?: { limit?: number }): Promise<{ uploaded: number }> {
  if (typeof window === 'undefined') return { uploaded: 0 };
  const limit = opts?.limit ?? 8;
  const { getLifeGraph } = await import('./life-graph');
  let uploaded = 0;
  for (const node of getLifeGraph()) {
    if (uploaded >= limit) break;
    const isGarment = node.type === 'Thing' && node.attributes?.garment === true;
    const isMeal = node.type === 'collection' && (node.tags || []).includes('一餐');
    if (!isGarment && !isMeal) continue;
    if ((node.assets || []).some((a) => a.storagePath)) continue;
    const local = (node.assets || []).find((a) => a.local && a.id);
    if (!local?.id) continue;
    const dataUrl = await getLocalImage(local.id);
    if (!dataUrl || !dataUrl.startsWith('data:')) continue;
    const r = await attachPhotoToMemoryNode({
      nodeId: node.id,
      dataUrl,
      kind: isMeal ? 'meal' : 'wardrobe',
      assetId: local.id,
      label: node.name,
    });
    if (r?.storagePath) uploaded += 1;
  }
  return { uploaded };
}

let kickTimer: number | null = null;
export function kickWardrobeImageSync(): void {
  if (typeof window === 'undefined') return;
  if (kickTimer != null) window.clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => {
    kickTimer = null;
    void import('./cloud-wardrobe-image-sync')
      .then((m) => m.autoSyncWardrobeImagesWithCloud({ force: true }))
      .catch(() => { /* ignore */ });
    // 顺手补传「有本机图、无 storagePath」的旧衣物/一餐。
    void backfillMissingPhotoUploads().catch(() => {});
  }, 800);
}
