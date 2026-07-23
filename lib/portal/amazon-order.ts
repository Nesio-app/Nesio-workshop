/**
 * 亚马逊订单截图 → 一条物品。
 *
 * 「拍订单」模式下,视觉识别常把一张订单截图拆成多条(总计/税费/税前总计/订单号
 * 各一条 —— 用户实测)。这里确定性地合并成 ONE 产品节点,把订单号/买入价/税/商家/
 * 下单日/到货日 归到它的 attributes,并打「亚马逊」标签。模型返回一条还是五条都能收。
 *
 * 纯函数,不碰存储,可单测(见 scripts/amazon-order.test.mjs)。
 */

export interface RawNode {
  name?: string;
  type?: string;
  attributes?: Record<string, unknown> | null;
}

export interface ConsolidatedOrder {
  name: string;
  type: 'object';
  tags: string[];
  attributes: Record<string, string | number>;
}

const ORDER_NO_RE = /\b\d{3}-\d{7}-\d{7}\b/;
const MONEY_RE = /-?\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/;
const SUBTOTAL_RE = /(税前总计|税前小计|商品小计|item.?\s*subtotal|subtotal|小计)/i;
const TAX_RE = /(预估税费|税费|销售税|消费税|estimated tax|\btax\b)/i;
const TOTAL_RE = /(总计|合计|grand\s*total|order\s*total)/i;
const SELLER_RE = /(?:sold by|卖家|商家|店铺)[：:\s]*([A-Za-z0-9一-鿿][\w一-鿿 .&'-]{0,40})/i;
const ORDERED_RE = /(order placed|下单(?:日期|时间)?|订单日期|placed on)[：:\s]*([^\n·]{4,24})/i;
const ARRIVED_RE = /(delivered|delivery|arriv\w*|到货(?:日期|时间)?|送达)[：:\s]*([^\n·]{4,24})/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** 「July 23, 2026」/「2026-07-23」/「2026/7/23」/「7月23日」→ YYYY-MM-DD;认不出返 ''。 */
export function parseOrderDate(raw: string, fallbackYear?: number): string {
  const t = (raw || '').trim();
  if (!t) return '';
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})/.exec(t); // July 23, 2026
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(t); // 7月23日
  if (m) {
    const y = fallbackYear || new Date().getUTCFullYear();
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}

function money(text: string): number | null {
  const m = MONEY_RE.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** 把节点名/属性值/摘要拼成可扫描文本行数组。 */
function lines(nodes: RawNode[], summary: string): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.name) out.push(String(n.name));
    const a = n.attributes || {};
    for (const v of Object.values(a)) if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
  }
  if (summary) out.push(...summary.split(/\n+/));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 挑产品名:优先 object 节点;否则挑不像「金额/税/总计/订单号/日期」的最长名。 */
function pickProductName(nodes: RawNode[]): string {
  const obj = nodes.find((n) => n.type === 'object' && n.name && n.name.trim());
  if (obj?.name) return obj.name.trim();
  const cand = nodes
    .map((n) => (n.name || '').trim())
    .filter((s) => s && !ORDER_NO_RE.test(s) && !SUBTOTAL_RE.test(s) && !TAX_RE.test(s) && !TOTAL_RE.test(s) && !/^\$?\s*[0-9]/.test(s))
    .sort((a, b) => b.length - a.length);
  return cand[0] || '';
}

export function consolidateAmazonOrder(nodes: RawNode[], summary = ''): ConsolidatedOrder {
  const ls = lines(nodes, summary);
  const joined = ls.join('\n');

  const attrs: Record<string, string | number> = {};

  // ① 先收模型已结构化的字段(它可能已返一条干净的物品,attributes 里带 buyPrice/税/订单号…)。
  for (const n of nodes) {
    const a = n.attributes || {};
    for (const k of ['buyPrice', 'tax', 'rebate', 'resalePrice']) {
      if (attrs[k] == null && a[k] != null && a[k] !== '') {
        const v = Number(a[k]);
        if (Number.isFinite(v)) attrs[k] = v;
      }
    }
    for (const k of ['orderNo', 'seller', 'keywords', 'orderedAt', 'arrivedAt']) {
      if (attrs[k] == null && typeof a[k] === 'string' && (a[k] as string).trim()) attrs[k] = (a[k] as string).trim();
    }
  }

  // ② 行扫描补缺(模型把订单摘要拆成了多条时),已由 ① 填的不覆盖。
  if (attrs.orderNo == null) {
    const orderNo = ORDER_NO_RE.exec(joined)?.[0];
    if (orderNo) attrs.orderNo = orderNo;
  }

  let subtotal: number | null = attrs.buyPrice != null ? Number(attrs.buyPrice) : null;
  let tax: number | null = attrs.tax != null ? Number(attrs.tax) : null;
  let total: number | null = null;
  for (const line of ls) {
    // 顺序有讲究:税前总计 含「总计」,先判 subtotal 再判 total。
    if (subtotal == null && SUBTOTAL_RE.test(line)) subtotal = money(line);
    else if (tax == null && TAX_RE.test(line)) tax = money(line);
    else if (total == null && TOTAL_RE.test(line)) total = money(line);
  }
  // 缺买入价但有总计与税 → 反推(税前 = 总计 − 税)。
  if (subtotal == null && total != null && tax != null) subtotal = Math.round((total - tax) * 100) / 100;
  if (subtotal != null) attrs.buyPrice = subtotal;
  if (tax != null) attrs.tax = tax;

  if (attrs.seller == null) {
    const seller = SELLER_RE.exec(joined)?.[1]?.trim();
    if (seller) attrs.seller = seller.replace(/[，,。.]+$/, '');
  }
  if (attrs.orderedAt == null) {
    const ordered = parseOrderDate(ORDERED_RE.exec(joined)?.[2] || '');
    if (ordered) attrs.orderedAt = ordered;
  }
  if (attrs.arrivedAt == null) {
    const arrived = parseOrderDate(ARRIVED_RE.exec(joined)?.[2] || '');
    if (arrived) attrs.arrivedAt = arrived;
  }

  return {
    name: pickProductName(nodes) || (orderNo ? `订单 ${orderNo}` : '亚马逊订单'),
    type: 'object',
    tags: ['亚马逊'],
    attributes: attrs,
  };
}
