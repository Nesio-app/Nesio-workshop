/**
 * 国名归一化 —— 反查/导入拿回的国家名不统一(「美国」/「United States」/「US」/「USA」
 * 甚至带空格大小写差异)会把同一个国家算成好几个(用户实锤:国别识别错误、去过 N 国虚高)。
 *
 * 这里把任意别名(中文名/英文名/ISO2/ISO3/常见简称)归一到一个稳定 canonical key(ISO2),
 * 计数/分组一律按 key 去重;显示时按 locale 取干净国名。未知国家降级为「归一化后的原串」
 * 作 key(大小写/空格差异仍能并),显示回退到原串首段,不丢信息。
 */

interface CountryDef {
  key: string;   // 稳定 canonical key(ISO2 大写)
  zh: string;    // 中文显示名
  en: string;    // 英文显示名
  aliases: string[]; // 归一进来的别名(中/英/码/简称)。key/zh/en 自动纳入,无需重复列。
}

// 覆盖常见到访国 + 与 places-share COUNTRY_CONTINENT 对齐的集合。未列出的国家走降级归一。
const COUNTRIES: CountryDef[] = [
  { key: 'US', zh: '美国', en: 'United States', aliases: ['USA', 'U.S.', 'U.S.A.', 'America', 'United States of America'] },
  { key: 'CA', zh: '加拿大', en: 'Canada', aliases: [] },
  { key: 'MX', zh: '墨西哥', en: 'Mexico', aliases: [] },
  { key: 'CU', zh: '古巴', en: 'Cuba', aliases: [] },
  { key: 'BR', zh: '巴西', en: 'Brazil', aliases: [] },
  { key: 'AR', zh: '阿根廷', en: 'Argentina', aliases: [] },
  { key: 'CL', zh: '智利', en: 'Chile', aliases: [] },
  { key: 'PE', zh: '秘鲁', en: 'Peru', aliases: [] },
  { key: 'CO', zh: '哥伦比亚', en: 'Colombia', aliases: [] },
  { key: 'BO', zh: '玻利维亚', en: 'Bolivia', aliases: [] },
  { key: 'GB', zh: '英国', en: 'United Kingdom', aliases: ['UK', 'Britain', 'Great Britain', 'England'] },
  { key: 'FR', zh: '法国', en: 'France', aliases: [] },
  { key: 'DE', zh: '德国', en: 'Germany', aliases: ['Deutschland'] },
  { key: 'IT', zh: '意大利', en: 'Italy', aliases: ['Italia'] },
  { key: 'ES', zh: '西班牙', en: 'Spain', aliases: ['España'] },
  { key: 'PT', zh: '葡萄牙', en: 'Portugal', aliases: [] },
  { key: 'NL', zh: '荷兰', en: 'Netherlands', aliases: ['Holland'] },
  { key: 'CH', zh: '瑞士', en: 'Switzerland', aliases: [] },
  { key: 'SE', zh: '瑞典', en: 'Sweden', aliases: [] },
  { key: 'NO', zh: '挪威', en: 'Norway', aliases: [] },
  { key: 'FI', zh: '芬兰', en: 'Finland', aliases: [] },
  { key: 'DK', zh: '丹麦', en: 'Denmark', aliases: [] },
  { key: 'GR', zh: '希腊', en: 'Greece', aliases: [] },
  { key: 'AT', zh: '奥地利', en: 'Austria', aliases: [] },
  { key: 'IE', zh: '爱尔兰', en: 'Ireland', aliases: [] },
  { key: 'BE', zh: '比利时', en: 'Belgium', aliases: [] },
  { key: 'PL', zh: '波兰', en: 'Poland', aliases: [] },
  { key: 'CZ', zh: '捷克', en: 'Czechia', aliases: ['Czech Republic'] },
  { key: 'RU', zh: '俄罗斯', en: 'Russia', aliases: ['Russian Federation'] },
  { key: 'IS', zh: '冰岛', en: 'Iceland', aliases: [] },
  { key: 'EG', zh: '埃及', en: 'Egypt', aliases: [] },
  { key: 'MA', zh: '摩洛哥', en: 'Morocco', aliases: [] },
  { key: 'ZA', zh: '南非', en: 'South Africa', aliases: [] },
  { key: 'KE', zh: '肯尼亚', en: 'Kenya', aliases: [] },
  { key: 'TZ', zh: '坦桑尼亚', en: 'Tanzania', aliases: [] },
  { key: 'NG', zh: '尼日利亚', en: 'Nigeria', aliases: [] },
  { key: 'CN', zh: '中国', en: 'China', aliases: ['PRC', "People's Republic of China", '中华人民共和国'] },
  { key: 'JP', zh: '日本', en: 'Japan', aliases: [] },
  { key: 'KR', zh: '韩国', en: 'South Korea', aliases: ['Korea', 'Republic of Korea', '大韩民国'] },
  { key: 'TH', zh: '泰国', en: 'Thailand', aliases: [] },
  { key: 'VN', zh: '越南', en: 'Vietnam', aliases: ['Viet Nam'] },
  { key: 'SG', zh: '新加坡', en: 'Singapore', aliases: [] },
  { key: 'MY', zh: '马来西亚', en: 'Malaysia', aliases: [] },
  { key: 'ID', zh: '印度尼西亚', en: 'Indonesia', aliases: ['印尼'] },
  { key: 'IN', zh: '印度', en: 'India', aliases: [] },
  { key: 'PH', zh: '菲律宾', en: 'Philippines', aliases: [] },
  { key: 'AE', zh: '阿联酋', en: 'United Arab Emirates', aliases: ['UAE'] },
  { key: 'TR', zh: '土耳其', en: 'Turkey', aliases: ['Türkiye'] },
  { key: 'IL', zh: '以色列', en: 'Israel', aliases: [] },
  { key: 'NP', zh: '尼泊尔', en: 'Nepal', aliases: [] },
  { key: 'KH', zh: '柬埔寨', en: 'Cambodia', aliases: [] },
  { key: 'LK', zh: '斯里兰卡', en: 'Sri Lanka', aliases: [] },
  { key: 'AU', zh: '澳大利亚', en: 'Australia', aliases: ['澳洲'] },
  { key: 'NZ', zh: '新西兰', en: 'New Zealand', aliases: [] },
  { key: 'FJ', zh: '斐济', en: 'Fiji', aliases: [] },
  { key: 'HK', zh: '香港', en: 'Hong Kong', aliases: ['Hong Kong SAR'] },
  { key: 'TW', zh: '台湾', en: 'Taiwan', aliases: [] },
  { key: 'BS', zh: '巴哈马', en: 'Bahamas', aliases: ['The Bahamas'] },
  { key: 'CR', zh: '哥斯达黎加', en: 'Costa Rica', aliases: [] },
  { key: 'HR', zh: '克罗地亚', en: 'Croatia', aliases: [] },
  { key: 'HU', zh: '匈牙利', en: 'Hungary', aliases: [] },
  { key: 'MC', zh: '摩纳哥', en: 'Monaco', aliases: [] },
  { key: 'LU', zh: '卢森堡', en: 'Luxembourg', aliases: [] },
];

/** 归一化基础形:去首尾空格、压多空格、去尾点、小写。用于别名匹配与未知降级。 */
function normalizeForm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/\.+$/, '').toLowerCase();
}

// 别名(归一化形)→ canonical key
const ALIAS_TO_KEY = new Map<string, string>();
// key → 显示名
const KEY_TO_DEF = new Map<string, CountryDef>();
for (const def of COUNTRIES) {
  KEY_TO_DEF.set(def.key, def);
  for (const alias of [def.key, def.zh, def.en, ...def.aliases]) {
    const form = normalizeForm(alias);
    if (form) ALIAS_TO_KEY.set(form, def.key);
  }
}

/**
 * 任意国家名 → 稳定 canonical key。已知国家返回 ISO2(如 'US');
 * 未知返回归一化后的原串(大小写/空格差异仍能并),空串返回 ''。
 */
export function canonicalCountryKey(raw: string | null | undefined): string {
  if (!raw) return '';
  const form = normalizeForm(raw);
  if (!form) return '';
  return ALIAS_TO_KEY.get(form) ?? form;
}

/**
 * canonical key → 干净的本地化显示名。已知国家按 locale 取中/英名;
 * 未知 key 回退到 fallbackRaw 的首段(逗号/顿号前),再不行就回退 key 本身。
 */
export function countryDisplayName(
  key: string,
  dict: string = 'zh',
  fallbackRaw?: string,
): string {
  const def = KEY_TO_DEF.get(key);
  if (def) return dict === 'en' ? def.en : def.zh;
  const raw = (fallbackRaw ?? key).trim();
  const first = raw.split(/[，,·]/)[0].trim();
  return first || raw;
}

/** 便捷:原始国家名直接 → 本地化显示名(先归一再取显示)。 */
export function displayCountry(raw: string | null | undefined, dict: string = 'zh'): string {
  if (!raw) return '';
  return countryDisplayName(canonicalCountryKey(raw), dict, raw);
}

/** 去重计数:一组国家名里有多少个不同国家(按 canonical key)。 */
export function distinctCountryCount(names: Array<string | null | undefined>): number {
  const keys = new Set<string>();
  for (const n of names) { const k = canonicalCountryKey(n); if (k) keys.add(k); }
  return keys.size;
}
