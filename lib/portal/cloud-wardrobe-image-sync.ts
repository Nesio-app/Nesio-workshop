/**
 * 衣帽间照片逐张同步(修「换端只见衣物条目、不见照片」)—— 薄封装,逻辑全走通用 record-sync 工厂。
 *
 * 衣物元数据(life-graph 节点/搭配 durable key)早已跨端,但照片本体只躺在 nesio-images IDB:
 *   · `wardrobe-<uuid>`           单品照片
 *   · `nesio-wardrobe-body`(+`-N`) 试穿用全身照(可多张)
 *   · `wardrobe-tryon-<id>`       搭配试穿结果图
 * 从不上云 → 换端只剩名字和属性,衣帽间一片灰。这里把这三类每张一行同步(并集补缺,不覆盖不删除)。
 * 与地点封面照(cloud-place-image-sync)完全同构。仅本人账号内、RLS 只本人可读、不进 AI。
 */
import { createRecordSync } from './cloud-record-sync';
import { collectLocalImages, putLocalImage } from './local-image-store';
import { WARDROBE_IMAGE_MODULE_PREFIX } from './sync-ownership';

/** 全身照:首张 `nesio-wardrobe-body`,其后 `nesio-wardrobe-body-2`… 都必须上云。 */
function isWardrobeAsset(assetId: string): boolean {
  return assetId.startsWith('wardrobe-') || assetId.startsWith('nesio-wardrobe-body');
}

const sync = createRecordSync({
  name: 'wardrobe_image',
  prefix: WARDROBE_IMAGE_MODULE_PREFIX,
  stateKey: 'nesio-wardrobe-image-sync-state-v1',
  // 只枚举衣帽间的三类照片;记忆照片另走 storagePath 上云、地点封面照走 place-image,不在此。
  load: async () => {
    const all = await collectLocalImages();
    const out: Record<string, string> = {};
    for (const [assetId, dataUrl] of Object.entries(all)) {
      if (isWardrobeAsset(assetId) && typeof dataUrl === 'string' && dataUrl) out[assetId] = dataUrl;
    }
    return out;
  },
  apply: async (records) => {
    for (const [assetId, dataUrl] of Object.entries(records)) await putLocalImage(assetId, dataUrl);
  },
  onApplied: () => {
    try { window.dispatchEvent(new CustomEvent('nesio-wardrobe-images-updated')); } catch { /* ignore */ }
  },
});

export const pushWardrobeImagesToCloud = sync.push;
export const pullWardrobeImagesFromCloud = sync.pull;
export const autoSyncWardrobeImagesWithCloud = sync.autoSync;
