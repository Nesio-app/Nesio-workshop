/**
 * mail-badges —— 邮件行上的「状态一行」和「右下角标签」(2026-07-30 用户要求):
 *
 *   「识别我的在途订单状态,付款,退款,显到货时间。如果是银行的显示 payment、收款、扣款状态」
 *   「可以在每一个右下角显示一下标签,订单,账单,预约,私人,有附件等等」
 *
 * 这一层**只做映射,不做判断**。判断在 lib/portal/email-extract-local.ts 里做完了 ——
 * 而且只认发件人自己写在主题/正文开头的词。分成两层是有意的:
 * 抽取那层要保守到近乎吝啬,展示这层要能看懂,两件事搅在一起就会开始「补全」。
 *
 * 红线:**字段缺就什么都不给**。没有「未知」「其它」这类兜底标签 ——
 * 「凡是没被认出来的都算某某」是这个仓库反复踩的同一个坑。
 */

import { L } from './i18n';

/** 用现成的状态色 token,不新引入颜色。 */
export type MailTone = 'go' | 'gentle' | 'calm' | 'neutral';

/** 节点 attributes 里跟这两件事有关的那几个字段(都可能不存在)。 */
export interface MailBadgeSource {
  orderStatus?: unknown;
  moneyFlow?: unknown;
  kindHint?: unknown;
  hasAttachment?: unknown;
  eta?: unknown;
  amount?: unknown;
}

export interface MailBadge {
  /** 稳定 id,给 React key 和筛选用 */
  id: string;
  label: string;
  tone: MailTone;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const ORDER_LABEL: Record<string, [string, string, MailTone]> = {
  ordered: ['已下单', 'Ordered', 'calm'],
  shipped: ['已发货', 'Shipped', 'calm'],
  delivered: ['已送达', 'Delivered', 'go'],
  refunded: ['已退款', 'Refunded', 'gentle'],
  canceled: ['已取消', 'Canceled', 'neutral'],
};

const MONEY_LABEL: Record<string, [string, string, MailTone]> = {
  paid: ['已付款', 'Paid', 'go'],
  received: ['收款', 'Received', 'go'],
  charged: ['扣款', 'Charged', 'gentle'],
  refund: ['退款', 'Refund', 'gentle'],
  due: ['待付', 'Due', 'gentle'],
};

const KIND_LABEL: Record<string, [string, string, MailTone]> = {
  order: ['订单', 'Order', 'calm'],
  bill: ['账单', 'Bill', 'gentle'],
  booking: ['预约', 'Booking', 'go'],
  personal: ['私人', 'Personal', 'neutral'],
};

/**
 * 状态那一行:「已发货 · 预计 Aug 3 · $42.10」。
 *
 * 订单状态优先于资金方向 —— 一封「退款已处理」两个字段都会有,
 * 用户先想知道的是这笔订单走到哪了。两个都没有就返回 null(不显示这一行)。
 */
export function mailStatusLine(src: MailBadgeSource, dict: string): { text: string; tone: MailTone } | null {
  const order = ORDER_LABEL[str(src.orderStatus)];
  const money = MONEY_LABEL[str(src.moneyFlow)];
  const head = order || money;
  if (!head) return null;

  const parts = [L(dict, head[0], head[1])];
  // 到货时间只在订单类里说 —— 银行邮件里的日期是账单日,不是「到货」。
  const eta = str(src.eta).trim();
  if (order && eta) parts.push(L(dict, `预计 ${eta}`, `ETA ${eta}`));
  const amount = str(src.amount).trim();
  if (amount) parts.push(amount);

  return { text: parts.join(' · '), tone: head[2] };
}

/**
 * 右下角的标签。最多两个:类型(订单/账单/预约/私人)+ 有附件。
 * 认不出类型就只剩附件那个;两个都没有就是空数组 —— 那一行右下角干干净净,
 * 这比挂一个「其它」诚实。
 */
export function mailBadges(src: MailBadgeSource, dict: string): MailBadge[] {
  const out: MailBadge[] = [];
  const kind = KIND_LABEL[str(src.kindHint)];
  if (kind) out.push({ id: str(src.kindHint), label: L(dict, kind[0], kind[1]), tone: kind[2] });
  if (src.hasAttachment === true) {
    out.push({ id: 'attachment', label: L(dict, '有附件', 'Attachment'), tone: 'neutral' });
  }
  return out;
}

/** tone → 一对 CSS 变量(背景 / 前景)。组件里不许再写死色值。 */
export function toneVars(tone: MailTone): { bg: string; fg: string } {
  switch (tone) {
    case 'go': return { bg: 'var(--status-go-soft)', fg: 'var(--status-go)' };
    case 'gentle': return { bg: 'var(--status-gentle-soft)', fg: 'var(--status-gentle)' };
    case 'calm': return { bg: 'var(--status-calm-soft)', fg: 'var(--status-calm)' };
    default: return { bg: 'var(--portal-accent-soft)', fg: 'var(--portal-muted)' };
  }
}
