/**
 * import-howtocook — 把 HowToCook(Anduin2017,Unlicense 公有领域)的家常菜谱
 * 解析并入 public/data/cooking/recipes.json。
 *
 * 用法:node scripts/import-howtocook.mjs <HowToCook 仓库克隆路径>
 *
 * 为什么值得吃进来:老乡鸡语料是餐厅出餐量(15 份起做),HowToCook 的「计算」节
 * 是每份家庭量,且带难度星级/卡路里 —— 正好补匹配管线展示克数的缺口。
 * 解析是确定性的(仓库有官方 template,节结构固定),不走 LLM。
 *
 * 幂等:重跑先剔除 source==='howtocook' 的旧行再并入;老乡鸡语料原样保留
 * (补 source='cooklikehoc' 标注)。封面图拷到 recipe-images/ 并加 htc- 前缀防撞名。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 目录名 → 中文分类(对齐老语料已有的 主食/汤/配料/饮品)。template 不是菜,排除。 */
export const CATEGORY_MAP = {
  aquatic: '水产',
  breakfast: '早餐',
  condiment: '配料',
  dessert: '甜品',
  drink: '饮品',
  meat_dish: '荤菜',
  'semi-finished': '半成品',
  soup: '汤',
  staple: '主食',
  vegetable_dish: '素菜',
};

/** 去掉括号注解(同 ingredient-normalize.stripSupplier 的行为,脚本侧不 import TS)。 */
export function stripAnnotation(raw) {
  return String(raw || '')
    .replace(/[（(【[].*?[）)】\]]/g, '')
    .replace(/[（(【[].*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIT_RE = '(mg|kg|ml|g|l|克|千克|毫升|升|大卡|个|只|片|勺|汤匙|茶匙|根|瓣|颗|块|条|张|杯|斤|两|包|盒|袋|滴|支|头|粒|枚|段|把|听|罐|毫米|厘米|mm|cm)';

/**
 * 「必备原料和工具」节混着厨具(烤箱/打蛋器/模具…)。工具进 ingredients 会被
 * recipe-match 当「缺料」(戚风蛋糕永远「缺烤箱」),故只留在 ingredients_raw 展示。
 */
export const TOOL_RE = /锅$|锅[(（]|烤箱|打蛋器|模具|刮刀|筷子|案板|菜刀|保鲜膜|保鲜袋|油纸|锡纸|厨房秤|电子秤|温度计|擀面杖|蒸架|蒸笼|烤盘|烤网|烤架|料理机|破壁机|搅拌机|绞肉机|电饭煲|微波炉|空气炸锅|吸管|牙签|漏勺|滤网|筛网|过滤|纱布|裱花|刷子|剪刀|容器|碗$|盘子|杯子|勺子|铲子|夹子|手套|计时器|冰箱|燃气灶|电磁炉|饭盒|砧板|刀$/;

/**
 * 解析「计算」节一行 → {item, amount, unit} 或 null。
 * 形如「小米椒 20 个，根据个人口味加减」「盐 1-2g」「五花肉/瘦肉 200g」;
 * 区间取下界;「适量/少许」等无数字行跳过。
 */
export function parseQuantityLine(line) {
  const cleaned = stripAnnotation(line).replace(/^[-*•+]\s*/, '').split(/[，,。;；]/)[0].trim();
  if (!cleaned) return null;
  const m = cleaned.match(new RegExp(
    `^(.+?)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:[-~－至到]\\s*\\d+(?:\\.\\d+)?)?\\s*${UNIT_RE}?\\s*$`, 'i',
  ));
  if (!m) return null;
  const item = m[1].replace(/[:：]$/, '').trim();
  if (!item || /^\d+$/.test(item)) return null;
  return { amount: Number(m[2]), unit: m[3] || '', item };
}

/**
 * 解析一篇 HowToCook 菜谱 Markdown → recipes.json 行(不含 image,图由主流程拷贝后回填)。
 * 结构不完整(缺名字/原料/操作)返回 null,由主流程记数跳过 —— 不静默。
 */
export function parseDish(md, category) {
  const lines = String(md || '').split('\n');
  let name = '';
  let difficulty = 0;
  let calories = null;
  const sections = {};
  let current = '';
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    if (h1 && !name) { name = h1[1].replace(/的做法\s*$/, '').trim(); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { current = h2[1].trim(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
    const stars = line.match(/预估烹饪难度[:：]\s*(★+)/);
    if (stars) difficulty = stars[1].length;
    const cal = line.match(/预估卡路里[:：]\s*(\d+)/);
    if (cal) calories = Number(cal[1]);
  }

  const bullets = (sec) => (sections[sec] || [])
    .map((l) => l.match(/^\s*[-*•+]\s+(.+)/)?.[1]?.trim())
    .filter(Boolean);
  const ingredientsRaw = bullets('必备原料和工具');
  const steps = (sections['操作'] || [])
    .map((l) => l.match(/^\s*(?:\d+[.、)]\s*|[-*•+]\s+)(.+)/)?.[1]?.trim())
    .filter(Boolean);
  if (!name || !ingredientsRaw.length || !steps.length) return null;

  const quantities = bullets('计算').map(parseQuantityLine).filter(Boolean);
  return {
    name,
    category,
    image: null,
    ingredients: [...new Set(ingredientsRaw.map(stripAnnotation).filter((s) => s && !TOOL_RE.test(s)))],
    ingredients_raw: ingredientsRaw,
    steps,
    quantities,
    source: 'howtocook',
    ...(difficulty ? { difficulty } : {}),
    ...(calories != null ? { calories } : {}),
  };
}

/** md 里第一张真实存在的本地图片(封面);无则 null。 */
function findCoverImage(md, mdDir) {
  for (const m of String(md).matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = m[1].trim();
    if (/^https?:/i.test(ref)) continue;
    const abs = path.resolve(mdDir, decodeURIComponent(ref));
    if (fs.existsSync(abs) && /\.(jpe?g|png|webp)$/i.test(abs)) return abs;
  }
  return null;
}

function main() {
  const repoRoot = process.argv[2];
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, 'dishes'))) {
    console.error('用法: node scripts/import-howtocook.mjs <HowToCook 仓库克隆路径>');
    process.exit(1);
  }
  const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const recipesPath = path.join(projectRoot, 'public/data/cooking/recipes.json');
  const imagesDir = path.join(projectRoot, 'public/data/cooking/recipe-images');

  const parsed = [];
  const skipped = [];
  for (const [dir, category] of Object.entries(CATEGORY_MAP)) {
    const base = path.join(repoRoot, 'dishes', dir);
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) { stack.push(full); continue; }
        if (!entry.name.endsWith('.md')) continue;
        const md = fs.readFileSync(full, 'utf8');
        const dish = parseDish(md, category);
        if (!dish) { skipped.push(path.relative(repoRoot, full)); continue; }
        const cover = findCoverImage(md, path.dirname(full));
        if (cover) {
          const dest = `htc-${dish.name}${path.extname(cover).toLowerCase()}`;
          fs.copyFileSync(cover, path.join(imagesDir, dest));
          dish.image = dest;
        }
        parsed.push(dish);
      }
    }
  }

  const existing = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
  const kept = (existing.recipes || [])
    .filter((r) => r.source !== 'howtocook')
    .map((r) => ({ ...r, source: r.source || 'cooklikehoc' }));
  const recipes = [...kept, ...parsed];
  const out = {
    sources: [
      { id: 'cooklikehoc', name: 'CookLikeHOC (老乡鸡, unofficial)', license: '见仓库,源自《老乡鸡菜品溯源报告》,用前核实' },
      { id: 'howtocook', name: 'HowToCook (Anduin2017/HowToCook)', license: 'Unlicense (public domain)', url: 'https://github.com/Anduin2017/HowToCook' },
    ],
    count: recipes.length,
    recipes,
  };
  fs.writeFileSync(recipesPath, `${JSON.stringify(out, null, 1)}\n`);

  const withImg = parsed.filter((r) => r.image).length;
  const withQty = parsed.filter((r) => r.quantities.length).length;
  console.log(`✅ HowToCook 并入 ${parsed.length} 道(带图 ${withImg},带家庭份量 ${withQty});保留原语料 ${kept.length} 道;总计 ${recipes.length}。`);
  if (skipped.length) console.log(`⚠️ 结构不完整跳过 ${skipped.length} 篇:\n  ${skipped.join('\n  ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
