/**
 * ingredient-normalize — 食材归一化**纯核心**(无 import,可 node 单测)。
 *
 * 焊点(设计文档强调):一个食材名要贯穿 recipes ↔ 成分表 ↔ GI ↔ 库存 ↔ 购物。
 * 这里把「原始词 → 标准名 + 是否常备」的判定做成纯函数,标准名集合由上层(food-catalog)
 * 从 eat-well ingredients.json 传入 —— 核心不 import 数据,方便测试。
 *
 * 关键判定:**调料/常备按 staple 处理,不算进「缺料」**(家里默认有油盐酱醋)。菜谱食材词
 * 直接命中 eat-well 标准名只 ~14%,缺口几乎全是调料 —— staple 集合补上这块,on-hand 匹配才准。
 */

/** 供应商/备注注解:去掉 （…）()【】[] 里的内容(如「虾滑馄饨（老乡鸡中央厨房）」→「虾滑馄饨」)。 */
export function stripSupplier(raw: string): string {
  return (raw || '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')  // 成对括号内注解
    .replace(/[（(【\[].*$/g, '')            // 只剩左括号的残缺注解
    .replace(/\s+/g, ' ')
    .trim();
}

// 常备调料:别名 → 规范名。菜谱里这些不算「缺料」。
const STAPLE_ALIASES: Record<string, string> = {
  // 油
  大豆油: '油', 菜籽油: '油', 熟猪油: '油', 起酥油: '油', 色拉油: '油', 花生油: '油',
  调和油: '油', 食用调和油: '油', 猪油: '油', 食用油: '油', 玉米油: '油', 葵花籽油: '油',
  芝麻香油: '香油', 芝麻油: '香油',
  // 盐 / 糖
  食盐: '盐', 精盐: '盐',
  白砂糖: '糖', 白糖: '糖', 绵白糖: '糖', 冰糖: '糖', 细砂糖: '糖', 红糖: '糖',
  // 酱 / 醋 / 酒
  味极鲜: '生抽', 味极鲜酱油: '生抽', 鲜味酱油: '生抽',
  香醋: '醋', 陈醋: '醋', 米醋: '醋', 白醋: '醋', 镇江香醋: '醋',
  黄酒: '料酒', 花雕酒: '料酒',
  // 增鲜 / 勾芡
  生粉: '淀粉', 水淀粉: '淀粉', 玉米淀粉: '淀粉', 红薯淀粉: '淀粉', 土豆淀粉: '淀粉', 木薯淀粉: '淀粉',
  // 香辛料
  白胡椒粉: '胡椒粉', 黑胡椒粉: '胡椒粉', 胡椒: '胡椒粉',
  葱花: '葱', 小葱: '葱', 大葱: '葱', 香葱: '葱', 葱段: '葱', 葱末: '葱',
  生姜: '姜', 姜片: '姜', 姜末: '姜', 姜丝: '姜', 老姜: '姜',
  蒜子: '蒜', 蒜花: '蒜', 蒜末: '蒜', 蒜蓉: '蒜', 大蒜: '蒜', 蒜瓣: '蒜',
  青花椒: '花椒', 麻椒: '花椒', 大料: '八角',
  辣椒面: '辣椒粉', 辣椒粉: '辣椒粉',
  // 水 / 高汤 / 卤料(准备物,匹配时视为常备,不提示缺)
  清水: '水', 热水: '水', 温水: '水', 凉水: '水', 纯净水: '水', 开水: '水',
  老鸡汤: '高汤', 鸡汤: '高汤', 老母鸡汤: '高汤', 骨汤: '高汤', 高汤: '高汤',
  卤水: '卤料', 香料: '卤料', 卤料包: '卤料',
};
// 规范名本身也算常备
const STAPLE_CANON = new Set<string>([
  '油', '香油', '盐', '糖', '生抽', '老抽', '酱油', '醋', '料酒', '鸡精', '味精', '蚝油',
  '淀粉', '胡椒粉', '葱', '姜', '蒜', '花椒', '八角', '桂皮', '香叶', '辣椒粉', '干辣椒',
  '水', '高汤', '卤料', '孜然', '五香粉', '十三香',
]);

/** 是否常备(调料/水/高汤等,匹配时不计入缺料)。 */
export function isStaple(name: string): boolean {
  return STAPLE_CANON.has(name) || name in STAPLE_ALIASES;
}

// 菜料名字变体 → eat-well 标准名(仅非调料的归并;标准名本身不必列)。
const ALIAS: Record<string, string> = {
  猪里脊: '里脊肉', 大排: '猪排骨', 肋排: '猪排骨', 排骨: '猪排骨',
  土鸡: '鸡肉', 老母鸡: '鸡肉', 鸡腿肉: '鸡腿', 琵琶腿: '鸡腿', 鸡全翅: '鸡翅', 翅根: '鸡翅', 翅尖: '鸡翅',
  牛腩: '牛肉', 牛腱: '牛肉', 肥牛: '牛肉',
  基围虾: '虾', 河虾: '虾', 明虾: '虾', 虾仁: '虾', 大虾: '虾',
  土豆: '马铃薯', 洋芋: '马铃薯', 西红柿: '番茄', 圆白菜: '卷心菜', 包菜: '卷心菜', 莲花白: '卷心菜',
  青菜: '小白菜', 上海青: '小白菜', 鸡蛋液: '鸡蛋', 土鸡蛋: '鸡蛋',
};

export interface NormalizedIngredient {
  name: string;      // 归一化后的名(标准名 / 规范调料名 / 去注解原名)
  isStaple: boolean; // 常备(不算缺料)
  matched: boolean;  // 是否命中标准名或已知别名/常备(false = 词表外)
}

/**
 * 归一化一个原始食材词。standardNames = eat-well 标准名集合(上层传入)。
 * 顺序:去注解 → 常备判定 → 标准名直命中 → 别名映射 → 兜底(原名,未命中)。
 */
export function classifyIngredient(raw: string, standardNames: Set<string>): NormalizedIngredient {
  const name0 = stripSupplier(raw);
  if (!name0) return { name: '', isStaple: false, matched: false };
  // 常备(别名→规范名 或 本就是规范调料)
  if (name0 in STAPLE_ALIASES) return { name: STAPLE_ALIASES[name0], isStaple: true, matched: true };
  if (STAPLE_CANON.has(name0)) return { name: name0, isStaple: true, matched: true };
  // 标准名直命中
  if (standardNames.has(name0)) return { name: name0, isStaple: false, matched: true };
  // 菜料别名
  if (name0 in ALIAS) {
    const std = ALIAS[name0];
    return { name: std, isStaple: false, matched: standardNames.has(std) || true };
  }
  // 兜底:词表外,保留去注解原名(仍可用于展示/购物,只是没接上营养/GI)
  return { name: name0, isStaple: false, matched: false };
}
