/**
 * 资产照料附件图逐张同步 —— 修「换端照料列表在、发票/合同图没了」。
 *
 * 元数据 `nesio-asset-care-v1` 已走 module-sync;图在 nesio-images 的 `care-att-*`,
 * 此前无云路径 → 重装/换端附件空指。与地点封面 / 衣帽间照片同构(record-sync 工厂)。
 */
import { createRecordSync } from './cloud-record-sync';
import { collectLocalImages, putLocalImage } from './local-image-store';
import { CARE_IMAGE_MODULE_PREFIX } from './sync-ownership';

const CARE_ASSET_PREFIX = 'care-att-';

const sync = createRecordSync({
  name: 'care_image',
  prefix: CARE_IMAGE_MODULE_PREFIX,
  stateKey: 'nesio-care-image-sync-state-v1',
  load: async () => {
    const all = await collectLocalImages();
    const out: Record<string, string> = {};
    for (const [assetId, dataUrl] of Object.entries(all)) {
      if (assetId.startsWith(CARE_ASSET_PREFIX) && typeof dataUrl === 'string' && dataUrl) {
        out[assetId] = dataUrl;
      }
    }
    return out;
  },
  apply: async (records) => {
    for (const [assetId, dataUrl] of Object.entries(records)) await putLocalImage(assetId, dataUrl);
  },
  onApplied: () => {
    try { window.dispatchEvent(new CustomEvent('nesio-care-images-updated')); } catch { /* ignore */ }
  },
});

export const pushCareImagesToCloud = sync.push;
export const pullCareImagesFromCloud = sync.pull;
export const autoSyncCareImagesWithCloud = sync.autoSync;

let kickTimer: number | null = null;
/** 照料页拍完附件后轻推一次(与 kickWardrobeImageSync 同款)。 */
export function kickCareImageSync(): void {
  if (typeof window === 'undefined') return;
  if (kickTimer != null) window.clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => {
    kickTimer = null;
    void autoSyncCareImagesWithCloud({ force: true }).catch(() => {});
  }, 800);
}
