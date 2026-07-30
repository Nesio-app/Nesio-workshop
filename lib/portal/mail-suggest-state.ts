/**
 * mail-suggest-state —— 邮件里认出的「安排」我处理过没有(2026-07-30)。
 *
 * 记的只有一件事:emailId → 我对这条建议做了什么(加进日程了 / 不用了)。
 * 有了它,同一封信不会每次进页面都再问一遍 —— 一个反复弹的确认框,
 * 弹三次之后用户就再也不看它了,那时它挡住的就不只是噪音。
 *
 * 为什么是 durable:「不用了」是一个**决定**。在手机上按掉的建议,换到电脑上
 * 又冒出来,等于这个决定没被记住。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const MAIL_SUGGEST_KEY = 'nesio-mail-suggest-v1';
export const MAIL_SUGGEST_EVENT = 'nesio-mail-suggest-updated';

export type SuggestVerdict = 'added' | 'dismissed';

const store = createBlobStore<Record<string, SuggestVerdict>>({
  key: MAIL_SUGGEST_KEY,
  updateEvent: MAIL_SUGGEST_EVENT,
  validate: (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function mailSuggestReady(): Promise<void> {
  return store.ready().then(() => undefined);
}

export function loadSuggestState(): Record<string, SuggestVerdict> {
  const raw = store.load();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SuggestVerdict> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k && (v === 'added' || v === 'dismissed')) out[k] = v;
  }
  return out;
}

export function markSuggest(emailId: string, verdict: SuggestVerdict): void {
  if (!emailId) return;
  const cur = loadSuggestState();
  // 上限护栏:只留最近的一批。超了就整体从头来 —— 那时最老的那些邮件早已不在
  // 30 天同步窗口里,不会再被问一遍。
  const next = { ...cur, [emailId]: verdict };
  const keys = Object.keys(next);
  if (keys.length > 4000) {
    for (const k of keys.slice(0, keys.length - 3000)) delete next[k];
  }
  store.save(next);
}
