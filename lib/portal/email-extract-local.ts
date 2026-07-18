/**
 * 邮件本地深抽取(邮件全链路 Phase 2)—— 纯正则/规则,零 API、零云成本。
 *
 * 免费=端上/确定性:免费用户的邮件不走云 LLM 抽取,但也不该只剩一条裸标题。
 * 这里从主题+正文里用规则抽出**金额 / 预计到货 / 订单号 / 快递单号 / 商家 / 待办信号**,
 * 挂到记忆节点 attributes,让今天页/记忆卡/搜索都能用到。纯函数,服务端/客户端都可跑。
 *
 * 保守优先:抽不准就不抽(宁缺毋滥),避免噪声;抽出的当「线索」用,不做硬断言。
 */

export interface EmailLocalFields {
  amount?: string;      // 金额(带符号,如 $12.99 / ¥88)
  eta?: string;         // 预计到货/送达日期(原文片段)
  orderNo?: string;     // 订单号
  trackingNo?: string;  // 快递/物流单号
  store?: string;       // 商家(发件人域名推断)
  todoHint?: boolean;   // 是否含「需回复/有截止」等待办信号
}

const AMOUNT_RE = /(?:[$￥¥€£]|USD|CNY|RMB)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{2})\s?(?:USD|美元|元|CNY|RMB)/;
const ORDER_RE = /(?:order(?:\s*(?:no|number|#))?|订单(?:号|编号)?)[\s:#]*([A-Z0-9][A-Z0-9-]{4,24})/i;
const TRACKING_RE = /(?:tracking(?:\s*(?:no|number|#))?|物流单号|快递单号|运单号)[\s:#]*([A-Z0-9]{8,30})/i;
// 预计到货/送达:抓关键词后面的日期/星期片段(英文月日 或 YYYY-MM-DD 或 中文月日 或 星期)
const ETA_RE = /(?:arriv\w*|deliver\w*|expected|estimated|预计(?:送达|到货|收到)?|送达|到货)[^.\n]{0,40}?((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s*)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日?)/i;
const TODO_RE = /(?:please\s+(?:reply|respond|confirm|rsvp)|action\s+required|reply\s+by|respond\s+by|需(?:要)?回复|请回复|请确认|截止|deadline|逾期|due\s+(?:by|date)|尽快回复)/i;

/** 从发件人推断商家名:优先显示名,退到域名主体(去 www/mail 前缀、去 TLD)。 */
function merchantFromSender(from: string): string {
  if (!from) return '';
  const nameMatch = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  const display = nameMatch?.[1]?.trim();
  if (display && !/@/.test(display) && display.length <= 40) return display;
  const domainMatch = /@([a-z0-9.-]+)/i.exec(from);
  const domain = domainMatch?.[1] || '';
  if (!domain) return '';
  const core = domain.replace(/^(www|mail|email|e|no-?reply|notifications?)\./i, '').split('.')[0];
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : '';
}

/**
 * 从主题 + 正文抽结构化线索。text 传全文(或够长的正文),subject/from 补充。
 * 全部保守:命中才给,清洗掉多余空白。
 */
export function extractEmailLocal(subject: string, from: string, text: string): EmailLocalFields {
  const hay = `${subject || ''}\n${text || ''}`;
  const out: EmailLocalFields = {};

  const amount = AMOUNT_RE.exec(hay)?.[0]?.trim();
  if (amount) out.amount = amount.replace(/\s+/g, ' ');

  const order = ORDER_RE.exec(hay)?.[1]?.trim();
  if (order) out.orderNo = order;

  const tracking = TRACKING_RE.exec(hay)?.[1]?.trim();
  // 单号别把纯数字年份/短码误抓;要求含字母或 ≥10 位
  if (tracking && (/[A-Z]/i.test(tracking) || tracking.length >= 10) && tracking !== out.orderNo) out.trackingNo = tracking;

  const eta = ETA_RE.exec(hay)?.[0]?.replace(/\s+/g, ' ').trim();
  if (eta && eta.length <= 60) out.eta = eta;

  const store = merchantFromSender(from);
  if (store) out.store = store;

  if (TODO_RE.test(hay)) out.todoHint = true;

  return out;
}
