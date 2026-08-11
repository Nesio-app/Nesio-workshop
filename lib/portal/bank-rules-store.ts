/**
 * bank-rules-store —— 银行规则类 map 迁出 localStorage → IDB blob。
 * 流水/账户已在 IDB;规则(分流/分类/标签/定期)此前仍占 LS,量大时易撑爆 5MB。
 * durable → 自动进 module-sync。
 */
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

function mapStore<T extends Record<string, string>>(key: string, event: string) {
  return createBlobStore<T>({
    key,
    updateEvent: event,
    validate: (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v)),
    onWriteError: reportStorageDropped,
  });
}

export const FLOW_RULE_KEY = 'nesio-bank-flow-rule-v1';
export const MERCHANT_RULE_KEY = 'nesio-bank-merchant-rule-v1';
export const RULE_LABEL_KEY = 'nesio-bank-rule-label-v1';
export const RECUR_RULE_KEY = 'nesio-bank-recur-v1';

const flowStore = mapStore<Record<string, string>>(FLOW_RULE_KEY, 'nesio-bank-flow-rules-updated');
const merchantStore = mapStore<Record<string, string>>(MERCHANT_RULE_KEY, 'nesio-bank-merchant-rules-updated');
const labelStore = mapStore<Record<string, string>>(RULE_LABEL_KEY, 'nesio-bank-rule-labels-updated');
const recurStore = mapStore<Record<string, string>>(RECUR_RULE_KEY, 'nesio-bank-recur-rules-updated');

export function loadFlowRuleMap(): Record<string, string> {
  return flowStore.load() ?? {};
}
export function saveFlowRuleMap(m: Record<string, string>): void {
  flowStore.save(m);
}

export function loadMerchantRuleMap(): Record<string, string> {
  return merchantStore.load() ?? {};
}
export function saveMerchantRuleMap(m: Record<string, string>): void {
  merchantStore.save(m);
}

export function loadRuleLabelMap(): Record<string, string> {
  return labelStore.load() ?? {};
}
export function saveRuleLabelMap(m: Record<string, string>): void {
  labelStore.save(m);
}

export function loadRecurRuleMap(): Record<string, string> {
  return recurStore.load() ?? {};
}
export function saveRecurRuleMap(m: Record<string, string>): void {
  recurStore.save(m);
}
