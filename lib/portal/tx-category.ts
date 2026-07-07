/**
 * 交易分类词汇(财务②:分类体系统一)—— 单一真源。
 *
 * 此前两套词汇并存:总览/交易行直出 Plaid personal_finance_category 枚举
 * (MEDICAL / GENERAL_SERVICES / GOVERNMENT_AND_NON_PROFIT…),定期/建议/纠正用自家词汇
 * (Food / Shopping / Services…)——同一页面精神分裂,统计里同类被拆成两组。
 *
 * 统一:**规范值 = Plaid PFC 枚举**(数据自带的语言),UI 一律经 categoryLabel 显示中英文友好名;
 * 自家历史词汇经 normalizeCategory 归一进 PFC(用户已存的纠正规则不作废)。
 * 未知枚举 prettify 兜底(Plaid 新增枚举不会烂成 SOME_NEW_ENUM 直出)。纯函数,零依赖。
 */

/** Plaid PFC primary → [zh, en] 友好名。 */
const PFC_META: Record<string, [string, string]> = {
  INCOME: ['收入', 'Income'],
  TRANSFER_IN: ['转入', 'Transfer in'],
  TRANSFER_OUT: ['转出', 'Transfer out'],
  LOAN_PAYMENTS: ['贷款还款', 'Loan payments'],
  BANK_FEES: ['银行费用', 'Bank fees'],
  ENTERTAINMENT: ['娱乐', 'Entertainment'],
  FOOD_AND_DRINK: ['餐饮', 'Food & drink'],
  GENERAL_MERCHANDISE: ['购物', 'Shopping'],
  HOME_IMPROVEMENT: ['家居装修', 'Home improvement'],
  MEDICAL: ['医疗', 'Medical'],
  PERSONAL_CARE: ['个人护理', 'Personal care'],
  GENERAL_SERVICES: ['生活服务', 'Services'],
  GOVERNMENT_AND_NON_PROFIT: ['政府与公益', 'Government & non-profit'],
  TRANSPORTATION: ['交通', 'Transportation'],
  TRAVEL: ['旅行', 'Travel'],
  RENT_AND_UTILITIES: ['房租水电', 'Rent & utilities'],
  OTHER: ['其他', 'Other'],
};

/** 自家历史词汇 → PFC(用户已存的商户纠正规则/旧建议不作废)。 */
const LEGACY_TO_PFC: Record<string, string> = {
  food: 'FOOD_AND_DRINK',
  shopping: 'GENERAL_MERCHANDISE',
  travel: 'TRAVEL',
  services: 'GENERAL_SERVICES',
  entertainment: 'ENTERTAINMENT',
  transport: 'TRANSPORTATION',
  transportation: 'TRANSPORTATION',
  utilities: 'RENT_AND_UTILITIES',
  medical: 'MEDICAL',
  health: 'MEDICAL',
  other: 'OTHER',
  其他: 'OTHER',
};

/** 归一:自家词汇→PFC;PFC 原样;未知值原样保留(不吞用户自定义)。空→空。 */
export function normalizeCategory(cat: string): string {
  const c = (cat || '').trim();
  if (!c) return '';
  if (PFC_META[c]) return c;
  return LEGACY_TO_PFC[c.toLowerCase()] || c;
}

/** 未知枚举 prettify:SOME_NEW_ENUM → Some New Enum(不烂成大写下划线直出)。 */
function prettify(cat: string): string {
  if (!/^[A-Z0-9_]+$/.test(cat)) return cat; // 用户自定义文本原样
  return cat.toLowerCase().split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** UI 显示名:规范化 → 友好名(dict='zh'|'en');未知枚举 prettify。 */
export function categoryLabel(cat: string, dict: string = 'zh'): string {
  const norm = normalizeCategory(cat);
  if (!norm) return '';
  const meta = PFC_META[norm];
  if (meta) return dict === 'en' ? meta[1] : meta[0];
  return prettify(norm);
}

/** 常用支出类 PFC(纠正按钮/筛选备选用,顺序=常用度)。 */
export const COMMON_EXPENSE_CATEGORIES = [
  'FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'TRAVEL', 'TRANSPORTATION',
  'ENTERTAINMENT', 'GENERAL_SERVICES', 'MEDICAL', 'PERSONAL_CARE',
] as const;
