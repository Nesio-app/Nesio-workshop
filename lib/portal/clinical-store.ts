/**
 * 临床记录存储(批次 48 / D2)—— export_cda.xml 解析出的化验单/用药/诊断,存本机。
 * 单独的 key(与 nesio-health-v1 隔离),仅 lab 模式读取渲染;属敏感数据,不上云。
 */
import type { ClinicalRecords } from './cda-parse';
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const CLINICAL_KEY = 'nesio-clinical-v1';

export interface StoredClinical extends ClinicalRecords {
  importedAt: string;
}

// 批次 57:挪 IndexedDB(与健康同策略,腾 localStorage 配额;老数据水合时迁移)。
const store = createBlobStore<StoredClinical>({
  key: CLINICAL_KEY,
  updateEvent: 'nesio-clinical-updated',
  validate: (v) => !!v && Array.isArray((v as StoredClinical).labs),
  onWriteError: reportStorageDropped,
});

export function saveClinical(rec: ClinicalRecords): void {
  // 全空不写(避免用户没有临床数据时留个空壳)。
  if (!rec.labs.length && !rec.medications.length && !rec.conditions.length) return;
  store.save({ ...rec, importedAt: new Date().toISOString() });
}

export function loadClinical(): StoredClinical | null {
  return store.load();
}
