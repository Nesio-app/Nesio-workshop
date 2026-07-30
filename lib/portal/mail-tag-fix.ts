/**
 * mail-tag-fix —— 邮件右下角那个标签分错了,我自己改(2026-07-30 用户:
 * 「邮件里,某个 tag 分错了,我怎么改,系统会学习到么?」)。
 *
 * ── 「学习」拆成两半,而且第二半必须你自己勾 ──────────────────────────
 * 会做的:
 *   ① **这一封**的修正 —— 永久记住,永远盖过自动判定;
 *   ② 改完多问一句「这个发件人以后都算 X 吗」,**你说是才写发件人规则**。
 *
 * **不做的:隐式泛化。** 也就是「你改了一封 Chase 的,系统自动把所有 Chase 都改掉」。
 * 听起来聪明,后果是:你改一次,几十封信悄悄跟着变,而你不知道发生了什么、
 * 也不知道去哪儿撤销。这和「把邮件标题里的『健身』猜成健康打卡」是同一类错 ——
 * 系统替你做了一个你没同意的推广。
 * 改一封就是一封;要推广,你自己勾。勾过的规则看得见、删得掉。
 *
 * ── 为什么是 durable ──────────────────────────────────────────────────
 * 这是**你的判断**,不是算出来的缓存。换台设备后从头开始 = 你纠正过的又全错回去。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const MAIL_TAG_FIX_KEY = 'nesio-mail-tag-fix-v1';
export const MAIL_TAG_FIX_EVENT = 'nesio-mail-tag-fix-updated';

/** 和 email-extract-local 的 kindHint 同一套值。 */
export type MailTagKind = 'order' | 'bill' | 'booking' | 'personal';
/** 'none' = 用户说「这封不该有标签」。和「没改过」(undefined)是两回事。 */
export type MailTagFix = MailTagKind | 'none';

export const MAIL_TAG_KINDS: MailTagKind[] = ['order', 'bill', 'booking', 'personal'];

const isFix = (v: unknown): v is MailTagFix =>
  v === 'none' || (typeof v === 'string' && (MAIL_TAG_KINDS as string[]).includes(v));

export interface MailTagFixStore {
  /** emailId → 这一封的修正 */
  byEmail: Record<string, MailTagFix>;
  /** 发件人邮箱(小写)→ 以后都这样。**只在用户显式勾选时才写**。 */
  bySender: Record<string, MailTagFix>;
}

const EMPTY: MailTagFixStore = { byEmail: {}, bySender: {} };

const store = createBlobStore<MailTagFixStore>({
  key: MAIL_TAG_FIX_KEY,
  updateEvent: MAIL_TAG_FIX_EVENT,
  validate: (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function mailTagFixReady(): Promise<void> {
  return store.ready().then(() => undefined);
}

export function loadMailTagFix(): MailTagFixStore {
  const raw = store.load();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY;
  const pick = (o: unknown): Record<string, MailTagFix> => {
    const out: Record<string, MailTagFix> = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) if (k && isFix(v)) out[k] = v;
    }
    return out;
  };
  return { byEmail: pick(raw.byEmail), bySender: pick(raw.bySender) };
}

/** 从 From 头抠出邮箱地址(小写)—— 发件人规则的键。 */
export function senderKeyOf(from: string): string {
  const m = /<([^>]+)>/.exec(from || '') || /([^\s<>@]+@[^\s<>@]+)/.exec(from || '');
  return (m ? m[1] : '').trim().toLowerCase();
}

/**
 * 记一条修正。
 * @param alsoSender true = 用户**显式勾了**「这个发件人以后都这样」。
 *   缺省 false —— 绝不替他做这个决定。
 */
export function fixMailTag(
  emailId: string,
  verdict: MailTagFix,
  opts: { from?: string; alsoSender?: boolean } = {},
): void {
  if (!emailId) return;
  const cur = loadMailTagFix();
  const byEmail = { ...cur.byEmail, [emailId]: verdict };
  const bySender = { ...cur.bySender };
  if (opts.alsoSender) {
    const key = senderKeyOf(opts.from || '');
    if (key) bySender[key] = verdict;
  }
  // 上限护栏:只留最近一批 byEmail。发件人规则条数天然少,不设限。
  const keys = Object.keys(byEmail);
  if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 3000)) delete byEmail[k];
  store.save({ byEmail, bySender });
}

/** 撤销这一封的修正(回到自动判定)。 */
export function clearMailTagFix(emailId: string): void {
  const cur = loadMailTagFix();
  if (!(emailId in cur.byEmail)) return;
  const byEmail = { ...cur.byEmail };
  delete byEmail[emailId];
  store.save({ ...cur, byEmail });
}

/** 删掉一条发件人规则(设置里能看见、能删)。 */
export function removeSenderRule(senderKey: string): void {
  const cur = loadMailTagFix();
  if (!(senderKey in cur.bySender)) return;
  const bySender = { ...cur.bySender };
  delete bySender[senderKey];
  store.save({ ...cur, bySender });
}

/* ── 纯判定(可单测,不碰存储)────────────────────────────────────────── */

/**
 * 这封邮件最终该显示哪个标签。
 *
 * 优先级 **这一封 > 发件人规则 > 自动判定**,而且是硬的:
 * 用户亲手改过的那一封,不管发件人规则怎么写、自动判定多有把握,都以他改的为准。
 * 反过来写(自动判定盖过人工)就是「我知道你说了什么,但我觉得我更对」。
 *
 * 返回 null = 不显示类型标签(自动判定没给,或用户说了「去掉」)。
 */
export function resolveMailKind(
  auto: string | undefined,
  emailId: string,
  from: string,
  fixes: MailTagFixStore,
): MailTagKind | null {
  const mine = emailId ? fixes.byEmail[emailId] : undefined;
  if (mine) return mine === 'none' ? null : mine;
  const rule = fixes.bySender[senderKeyOf(from)];
  if (rule) return rule === 'none' ? null : rule;
  return auto && (MAIL_TAG_KINDS as string[]).includes(auto) ? (auto as MailTagKind) : null;
}
