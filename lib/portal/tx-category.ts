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

/** 常用支出类 PFC(纠正按钮/筛选备选用,顺序=常用度)。财务⑨:补全到全部支出相关 PFC。 */
export const COMMON_EXPENSE_CATEGORIES = [
  'FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'TRAVEL', 'TRANSPORTATION',
  'ENTERTAINMENT', 'GENERAL_SERVICES', 'MEDICAL', 'PERSONAL_CARE',
  'RENT_AND_UTILITIES', 'HOME_IMPROVEMENT', 'BANK_FEES', 'LOAN_PAYMENTS',
  'GOVERNMENT_AND_NON_PROFIT', 'OTHER',
] as const;

/* ---------- 财务⑨:PFC detailed 细分类(展示细化,统计仍按 primary) ---------- */

/** 常见 detailed → [zh, en](覆盖不到的走「去前缀 prettify」兜底;*_OTHER_* 无信息量,不展示)。 */
const DETAIL_META: Record<string, [string, string]> = {
  FOOD_AND_DRINK_COFFEE: ['咖啡', 'Coffee'],
  FOOD_AND_DRINK_FAST_FOOD: ['快餐', 'Fast food'],
  FOOD_AND_DRINK_GROCERIES: ['超市买菜', 'Groceries'],
  FOOD_AND_DRINK_RESTAURANT: ['餐厅', 'Restaurant'],
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: ['酒水', 'Beer, wine & liquor'],
  TRANSPORTATION_GAS: ['加油', 'Gas'],
  TRANSPORTATION_PARKING: ['停车', 'Parking'],
  TRANSPORTATION_PUBLIC_TRANSIT: ['公共交通', 'Public transit'],
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: ['打车', 'Taxis & ride shares'],
  TRANSPORTATION_TOLLS: ['过路费', 'Tolls'],
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: ['网购平台', 'Online marketplaces'],
  GENERAL_MERCHANDISE_SUPERSTORES: ['综合超市', 'Superstores'],
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: ['服饰', 'Clothing & accessories'],
  GENERAL_MERCHANDISE_ELECTRONICS: ['电子产品', 'Electronics'],
  GENERAL_MERCHANDISE_CONVENIENCE_STORES: ['便利店', 'Convenience stores'],
  GENERAL_MERCHANDISE_DEPARTMENT_STORES: ['百货', 'Department stores'],
  GENERAL_MERCHANDISE_DISCOUNT_STORES: ['折扣店', 'Discount stores'],
  GENERAL_MERCHANDISE_PET_SUPPLIES: ['宠物用品', 'Pet supplies'],
  GENERAL_MERCHANDISE_SPORTING_GOODS: ['体育用品', 'Sporting goods'],
  ENTERTAINMENT_TV_AND_MOVIES: ['影视', 'TV & movies'],
  ENTERTAINMENT_MUSIC_AND_AUDIO: ['音乐', 'Music & audio'],
  ENTERTAINMENT_VIDEO_GAMES: ['游戏', 'Video games'],
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: ['演出/乐园/博物馆', 'Events, parks & museums'],
  RENT_AND_UTILITIES_RENT: ['房租', 'Rent'],
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: ['网络/有线', 'Internet & cable'],
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: ['燃气电力', 'Gas & electricity'],
  RENT_AND_UTILITIES_TELEPHONE: ['话费', 'Telephone'],
  RENT_AND_UTILITIES_WATER: ['水费', 'Water'],
  TRAVEL_FLIGHTS: ['机票', 'Flights'],
  TRAVEL_LODGING: ['住宿', 'Lodging'],
  TRAVEL_RENTAL_CARS: ['租车', 'Rental cars'],
  MEDICAL_PRIMARY_CARE: ['门诊', 'Primary care'],
  MEDICAL_DENTAL_CARE: ['牙科', 'Dental care'],
  MEDICAL_EYE_CARE: ['眼科', 'Eye care'],
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: ['药房/保健品', 'Pharmacies & supplements'],
  MEDICAL_VETERINARY_SERVICES: ['宠物医疗', 'Veterinary'],
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: ['健身房', 'Gyms & fitness'],
  PERSONAL_CARE_HAIR_AND_BEAUTY: ['美发美容', 'Hair & beauty'],
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: ['洗衣', 'Laundry & dry cleaning'],
  GENERAL_SERVICES_AUTOMOTIVE: ['汽车养护', 'Automotive'],
  GENERAL_SERVICES_CHILDCARE: ['育儿', 'Childcare'],
  GENERAL_SERVICES_EDUCATION: ['教育', 'Education'],
  GENERAL_SERVICES_INSURANCE: ['保险', 'Insurance'],
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: ['邮寄', 'Postage & shipping'],
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: ['信用卡还款', 'Credit card payment'],
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: ['房贷', 'Mortgage'],
  LOAN_PAYMENTS_CAR_PAYMENT: ['车贷', 'Car payment'],
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: ['学贷', 'Student loan'],
  BANK_FEES_ATM_FEES: ['ATM 手续费', 'ATM fees'],
  BANK_FEES_OVERDRAFT_FEES: ['透支费', 'Overdraft fees'],
  BANK_FEES_FOREIGN_TRANSACTION_FEES: ['外币手续费', 'Foreign transaction fees'],
  BANK_FEES_INTEREST_CHARGE: ['利息', 'Interest charge'],
  INCOME_WAGES: ['工资', 'Wages'],
  INCOME_INTEREST_EARNED: ['利息收入', 'Interest earned'],
  INCOME_DIVIDENDS: ['分红', 'Dividends'],
  INCOME_TAX_REFUND: ['退税', 'Tax refund'],
  // bug2(收入来源那一列出现「Contractor / Salary / Transfer From Apps」英文):
  // 中文界面下未命中 DETAIL_META 的键会被 prettify 兜成 Title Case 英文,读起来像半拉子。
  // Plaid income / transfer_in 的其余枚举在此补齐中文。
  INCOME_OTHER_INCOME: ['其他收入', 'Other income'],
  INCOME_RETIREMENT_PENSION: ['退休金', 'Pension'],
  INCOME_UNEMPLOYMENT: ['失业金', 'Unemployment'],
  INCOME_RENTAL: ['租金收入', 'Rental income'],
  TRANSFER_IN_CASH_ADVANCES_AND_LOANS: ['借入', 'Cash advance / loan'],
  TRANSFER_IN_DEPOSIT: ['存入', 'Deposit'],
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: ['投资转入', 'Investment transfer in'],
  TRANSFER_IN_SAVINGS: ['储蓄转入', 'Savings transfer in'],
  TRANSFER_IN_ACCOUNT_TRANSFER: ['账户互转', 'Account transfer'],
};

/**
 * 自由文本收入来源的中文映射。Plaid 除枚举外还会给自由文本(Contractor / Salary /
 * Transfer From Apps),中文界面下 prettify 会把它变成 Title Case 英文 —— 半拉子。
 * 这里按关键词给中文名;**不能**统一压成「其他收入」,否则不同来源会显示成同名两行。
 */
const FREE_TEXT_INCOME: Array<[RegExp, string]> = [
  [/contractor|freelance|1099/i, '劳务收入'],
  [/payroll|salary|wage/i, '工资'],
  [/bonus/i, '奖金'],
  [/commission/i, '佣金'],
  [/transfer\s*from|from\s*apps|zelle|venmo|paypal|cash\s*app/i, '转入'],
  [/refund|rebate|cashback/i, '退款 / 返现'],
  [/interest/i, '利息收入'],
  [/dividend/i, '分红'],
  [/rent/i, '租金收入'],
  [/reimburse/i, '报销'],
];

/** 中文界面下给自由文本收入来源一个中文名;认不出来的保留原文(信息不能丢)。 */
function localizeFreeTextIncome(detail: string, dict: string): string {
  const pretty = prettify(detail);
  if (dict === 'en') return pretty;
  for (const [re, zh] of FREE_TEXT_INCOME) if (re.test(detail)) return zh;
  return pretty; // 认不出的保留原文 —— 压成「其他收入」会让多个来源显示成同名行
}

/**
 * detailed 细分类显示名:命中表 → 友好名;*_OTHER_*(如 FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK)
 * 对 primary 零增量,返回 ''(UI 据此不展示);其余去 primary 前缀 prettify 兜底。
 */
export function categoryDetailLabel(detail: string, dict: string = 'zh'): string {
  const d = (detail || '').trim();
  if (!d) return '';
  const meta = DETAIL_META[d];
  if (meta) return dict === 'en' ? meta[1] : meta[0];
  if (/_OTHER_/.test(d)) return '';
  for (const p of Object.keys(PFC_META)) {
    if (d.startsWith(`${p}_`)) return prettify(d.slice(p.length + 1));
  }
  // 收入来源列表把 detail 直接当标题展示,自由文本在中文界面下要有中文名
  return localizeFreeTextIncome(d, dict);
}
