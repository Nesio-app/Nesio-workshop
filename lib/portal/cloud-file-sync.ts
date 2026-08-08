/**
 * 文件附件逐份同步(修「换端看不到 pdf/凭证/聊天文件」)—— 薄封装,逻辑全走通用 record-sync 工厂。
 *
 * nesio-files IDB 此前是「唯一副本(不上传)」:财务凭证(tx-att-*)、对账原件、聊天/今天页收的
 * pdf/docx(localfile-*)、按人附件(pr-att-*)只在收它的那台设备上。挂它们的节点/分录元数据
 * 早已跨端 → 别的端点开附件是空的。这里把每份文件一行同步(JSON{name,mimeType,size,dataUrl},
 * gz 压缩,并集补缺)。
 *
 * 体积纪律:单行 gz 后 >4MB(约对应原文件 3-5MB+)会被工厂跳过并 logDropped —— 大文件仍只在
 * 收它的设备(Vercel 函数体 4.5MB 上限,硬约束)。绝大多数小票/凭证/文档远小于此。
 * 仅本人账号内、RLS 只本人可读、不进 AI。
 */
import { createRecordSync } from './cloud-record-sync';
import { collectLocalFiles, restoreLocalFiles } from './local-file-store';
import { LOCAL_FILE_MODULE_PREFIX } from './sync-ownership';

interface FileRecord { name: string; mimeType: string; size: number; dataUrl: string }

const sync = createRecordSync({
  name: 'local_file',
  prefix: LOCAL_FILE_MODULE_PREFIX,
  stateKey: 'nesio-file-sync-state-v1',
  load: async () => {
    const all = await collectLocalFiles();
    const out: Record<string, string> = {};
    for (const [assetId, rec] of Object.entries(all)) {
      if (rec?.dataUrl) out[assetId] = JSON.stringify(rec);
    }
    return out;
  },
  apply: async (records) => {
    const map: Record<string, FileRecord> = {};
    for (const [assetId, json] of Object.entries(records)) {
      try {
        const rec = JSON.parse(json) as FileRecord;
        if (rec?.dataUrl) map[assetId] = rec;
      } catch { /* 单条坏了不拖垮整批 */ }
    }
    if (Object.keys(map).length) await restoreLocalFiles(map);
  },
  onApplied: () => {
    try { window.dispatchEvent(new CustomEvent('nesio-local-files-updated')); } catch { /* ignore */ }
  },
});

export const pushLocalFilesToCloud = sync.push;
export const pullLocalFilesFromCloud = sync.pull;
export const autoSyncLocalFilesWithCloud = sync.autoSync;
