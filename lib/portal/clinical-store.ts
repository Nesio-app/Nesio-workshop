/**
 * 临床记录存储(批次 48 / D2)—— export_cda.xml 解析出的化验单/用药/诊断,存本机。
 * 单独的 key(与 nesio-health-v1 隔离),仅 lab 模式读取渲染;属敏感数据,不上云。
 */
import type { ClinicalRecords } from './cda-parse';

export const CLINICAL_KEY = 'nesio-clinical-v1';

export interface StoredClinical extends ClinicalRecords {
  importedAt: string;
}

export function saveClinical(rec: ClinicalRecords): void {
  if (typeof window === 'undefined') return;
  // 全空不写(避免用户没有临床数据时留个空壳)。
  if (!rec.labs.length && !rec.medications.length && !rec.conditions.length) return;
  try {
    const payload: StoredClinical = { ...rec, importedAt: new Date().toISOString() };
    localStorage.setItem(CLINICAL_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('nesio-clinical-updated'));
  } catch { /* quota — ignore */ }
}

export function loadClinical(): StoredClinical | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CLINICAL_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as StoredClinical;
    return Array.isArray(c.labs) ? c : null;
  } catch { return null; }
}
