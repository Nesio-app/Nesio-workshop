/**
 * 地点封面照逐张同步(修「换端封面照丢失,退回渐变占位」)—— **薄封装**,逻辑全走通用 record-sync 工厂。
 *
 * 地点封面照存 nesio-images IDB 的 `placephoto-*` 键(记忆照片同库,但那些走 storagePath 上云,这里只管
 * 手动设的封面覆盖图)。覆盖映射 nesio-place-photos-v1 是普通 durable key、已随 module-sync 跨端,但图本身
 * 从不上云 → 换端只剩映射、图没了。这里把 placephoto-* 每张一行同步。
 *
 * 这是「一套系统」的示范:新增一个 per-record 同步 = 一份 config,不再各写一份引擎。
 */
import { createRecordSync } from './cloud-record-sync';
import { collectLocalImages, putLocalImage } from './local-image-store';
import { PLACE_IMAGE_MODULE_PREFIX } from './sync-ownership';

const PLACE_PHOTO_ASSET_PREFIX = 'placephoto-';

const sync = createRecordSync({
  name: 'place_image',
  prefix: PLACE_IMAGE_MODULE_PREFIX,
  stateKey: 'nesio-place-image-sync-state-v1',
  // 只枚举 placephoto-*(封面覆盖图);记忆照片另走 storagePath 上云,不在此。
  load: async () => {
    const all = await collectLocalImages();
    const out: Record<string, string> = {};
    for (const [assetId, dataUrl] of Object.entries(all)) {
      if (assetId.startsWith(PLACE_PHOTO_ASSET_PREFIX) && typeof dataUrl === 'string' && dataUrl) out[assetId] = dataUrl;
    }
    return out;
  },
  apply: async (records) => {
    for (const [assetId, dataUrl] of Object.entries(records)) await putLocalImage(assetId, dataUrl);
  },
  onApplied: () => {
    try { window.dispatchEvent(new CustomEvent('nesio-place-photos-updated')); } catch { /* ignore */ }
  },
});

export const pushPlaceImagesToCloud = sync.push;
export const pullPlaceImagesFromCloud = sync.pull;
export const autoSyncPlaceImagesWithCloud = sync.autoSync;
