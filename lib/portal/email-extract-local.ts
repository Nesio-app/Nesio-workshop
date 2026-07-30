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
  /**
   * 在途订单走到哪一步了(2026-07-30 用户:「识别我的在途订单状态…显到货时间」)。
   * 只认**商家自己写在主题里**的那几个词 —— 这不是在猜用户的意图,
   * 是在读发件人已经明说的事实,和「把邮件标题里的『健身』猜成健康打卡」是两回事。
   */
  orderStatus?: 'ordered' | 'shipped' | 'delivered' | 'refunded' | 'canceled';
  /**
   * 钱往哪个方向走(用户:「如果是银行的显示 payment、收款、扣款状态」)。
   * 同样只认明写的动词,认不准就不给。
   */
  moneyFlow?: 'paid' | 'received' | 'charged' | 'refund' | 'due';
  /** 这封大致属于哪一类 —— 给列表右下角那个标签用(订单/账单/预约/私人)。 */
  kindHint?: 'order' | 'bill' | 'booking' | 'personal';
}

const AMOUNT_RE = /(?:[$￥¥€£]|USD|CNY|RMB)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{2})\s?(?:USD|美元|元|CNY|RMB)/;
const ORDER_RE = /(?:order(?:\s*(?:no|number|#))?|订单(?:号|编号)?)[\s:#]*([A-Z0-9][A-Z0-9-]{4,24})/i;
const TRACKING_RE = /(?:tracking(?:\s*(?:no|number|#))?|物流单号|快递单号|运单号)[\s:#]*([A-Z0-9]{8,30})/i;
// 预计到货/送达:抓关键词后面的日期/星期片段(英文月日 或 YYYY-MM-DD 或 中文月日 或 星期)
const ETA_RE = /(?:arriv\w*|deliver\w*|expected|estimated|预计(?:送达|到货|收到)?|送达|到货)[^.\n]{0,40}?((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s*)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日?)/i;
const TODO_RE = /(?:please\s+(?:reply|respond|confirm|rsvp)|action\s+required|reply\s+by|respond\s+by|需(?:要)?回复|请回复|请确认|截止|deadline|逾期|due\s+(?:by|date)|尽快回复)/i;

/* ── 2026-07-30 新增:订单状态 / 资金方向 / 类型标签 ───────────────────────────
   共同的分寸:**只读发件人自己写明的词**,而且优先看主题(商家把状态写在主题里是行业惯例)。
   一条命中不了就返回 undefined —— 宁可没有标签,也不要一个错标签。          */

/** 订单状态。顺序即优先级:越靠后的状态越「终态」,同时出现时取终态。 */
const ORDER_STATUS_RES: Array<[EmailLocalFields['orderStatus'], RegExp]> = [
  ['ordered', /\border(?:\s+)?(?:confirm\w*|placed|received)\b|thanks?\s+for\s+your\s+order|订单(?:已)?(?:确认|提交|成功)|下单成功/i],
  ['shipped', /\bshipped\b|\bon\s+the\s+way\b|\bout\s+for\s+delivery\b|has\s+shipped|已发货|已出库|运输中|派送中/i],
  ['delivered', /\bdelivered\b|was\s+delivered|已(?:送达|签收|妥投)/i],
  ['canceled', /\bcancel(?:l)?ed\b|订单(?:已)?取消|已取消/i],
  ['refunded', /\brefund(?:ed)?\b|refund\s+(?:issued|processed)|已退款|退款(?:成功|已处理)/i],
];

/** 资金方向。同样只认明写的动词。 */
const MONEY_FLOW_RES: Array<[EmailLocalFields['moneyFlow'], RegExp]> = [
  ['refund', /\brefund(?:ed)?\b|已退款|退款/i],
  ['received', /\b(?:you\s+received|sent\s+you|payment\s+received|deposit(?:ed)?)\b|收到(?:一笔)?(?:付款|转账|退款)?|入账/i],
  ['charged', /\b(?:charged|debit(?:ed)?|withdraw(?:al|n)?|auto-?pay)\b|扣款|已扣|支出/i],
  ['paid', /\b(?:payment\s+(?:sent|posted|made)|you\s+paid|paid\b)|已(?:付款|支付)|付款成功/i],
  ['due', /\b(?:payment\s+due|amount\s+due|due\s+(?:on|by|date)|statement\s+(?:is\s+)?(?:ready|available)|minimum\s+payment)\b|应还|待还|账单(?:已)?出(?:账|来)?|还款日/i],
];

/**
 * 预约类(看诊/预定/日程确认)。
 *
 * 注意中文分支**不能**放进 `\b(...)\b` 里:JS 的 \b 是「\w 与非 \w 的交界」,
 * 而汉字本身就是非 \w —— 主题开头的「预约成功」前面没有 \w,\b 断言不成立,
 * 整条中文分支会永远匹配不上。所以英文用 \b 包住、中文另起分支。
 */
const BOOKING_RE = /\b(?:appointment|reservation|booked|booking\s+confirm\w*|check-?in\s+(?:time|reminder))\b|预约|已预订|订座|预定成功/i;
/** 账单类(与资金方向的 due 有重叠,但这里判的是「这封是不是一张账单」)。 */
const BILL_RE = /\b(?:statement|invoice|bill(?:ing)?\s+(?:statement|reminder)?|autopay|balance\s+due)\b|账单|发票|缴费|水电|物业费/i;

/**
 * 状态词只在**主题 + 正文开头**这段里找,不扫全文。
 *
 * 商家把「已发货 / 已退款 / 账单已出」写在主题或正文头几行,是行业惯例;
 * 而再往下,页脚的「退款政策」「如需取消订单请…」「关于账单」用的是**同一批词**。
 * 在全文里搜,等于让页脚决定这封邮件的状态 —— 一封发货通知会因为底部的退款条款
 * 被标成「已退款」。窗口本身就是这里的正向约束。
 */
const STATUS_SCAN_BODY_CHARS = 600;

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

  /* ── 状态 / 资金方向 / 类型(2026-07-30)──────────────────────────────
     干草堆比上面窄:只看主题 + 正文开头(见 STATUS_SCAN_BODY_CHARS)。 */
  const statusHay = `${subject || ''}\n${(text || '').slice(0, STATUS_SCAN_BODY_CHARS)}`;

  // 订单状态:同时命中多条时取**更终态**的那一条(数组顺序就是从早到晚,
  // 所以不 break —— 后面的会覆盖前面的)。一封「您的退款已处理(原订单已发货)」
  // 该显示的是退款,不是发货。
  for (const [status, re] of ORDER_STATUS_RES) if (re.test(statusHay)) out.orderStatus = status;

  // 资金方向:取**第一条**命中(数组顺序即从具体到笼统:退款 > 收款 > 扣款 > 付款 > 待还)。
  for (const [flow, re] of MONEY_FLOW_RES) {
    if (re.test(statusHay)) { out.moneyFlow = flow; break; }
  }

  // 类型:只在有**正面证据**时给,而且证据越具体的排越前。
  // 这里**没有兜底分支** —— 「凡是没被认出来的都算私人」正是这个仓库反复踩的坑
  // (「健身」被认成健康打卡是同一族)。私人与否由 Gmail 自己的 CATEGORY_PERSONAL
  // 说了算,在 gmail 路由里补,不在这里猜。
  if (BOOKING_RE.test(statusHay)) out.kindHint = 'booking';           // 「预约/reservation」是极具体的词
  else if (out.orderStatus || out.orderNo || out.trackingNo) out.kindHint = 'order';
  else if (BILL_RE.test(statusHay) || out.moneyFlow) out.kindHint = 'bill';

  return out;
}
