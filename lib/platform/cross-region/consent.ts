/**
 * 跨区主动投递 · 同意存储(cross-region-reasoning.md §2.2 同意门)。
 *
 * 敏感域(health/finance/location)的跨区关联要**主动推到 Today** 需用户显式同意
 * (§4 同意必需域)。默认关:未同意 → 只在洞察 tab 明细里能看(那是本人看自己的数据),
 * 不主动打扰。存 IDB blob,进备份/删除收口。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';

const STORE_KEY = 'nesio-cross-region-consent-v1';
export const CROSS_REGION_CONSENT_UPDATED = `${STORE_KEY}-updated`;

/** 可授权的敏感域(与 deliver-core SENSITIVE_DOMAINS 对齐)。 */
export const SENSITIVE_DELIVERY_DOMAINS = ['health', 'finance', 'location'] as const;

const blob = createBlobStore<string[]>({
  key: STORE_KEY,
  updateEvent: CROSS_REGION_CONSENT_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

/** 已同意主动推送的敏感域集合(默认空)。 */
export function getConsentedDomains(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const v = blob.load();
  return new Set(Array.isArray(v) ? v : []);
}

export function isDomainConsented(domain: string): boolean {
  return getConsentedDomains().has(domain);
}

/** 打开/关闭某敏感域的主动推送同意。 */
export function setDomainConsent(domain: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  const cur = getConsentedDomains();
  if (on) cur.add(domain); else cur.delete(domain);
  blob.save([...cur]);
}
