/**
 * exercise-catalog — 扩展动作库(1324 个)。
 * 来源 hasaneyldrm/exercises-dataset 的 **MIT 元数据 + 中文分步指导**,
 * 由 scripts/import-exercise-catalog.mjs 生成 public/exercise-catalog.json。
 *
 * 与手工精选的 18 个 Verna 动作(exercise-library.ts)分开:
 * 那 18 个是配了完整暖教练文案的「质量核心」,这里是「广度扩展」,轻元数据。
 *
 * 媒体不含(© Gym visual)。每条带 `media` 链接键 —— 若用户把对应动作视频
 * 转成本地帧放到 public/exercise-anim/catalog/<media>/,动图即自动点亮;否则纯文字。
 */

export interface CatalogExercise {
  id: string;
  name: string;
  nameZh: string;
  category: string;
  bodyPart: string;
  equipment: string;
  target: string;
  secondary: string[];
  muscleGroup: string;
  media: string;
  cues: string[];
}

export interface ExerciseCatalog {
  source: string;
  dataLicense: string;
  mediaNote: string;
  count: number;
  exercises: CatalogExercise[];
}

// base-path 感知:treasurebox 若部署在子路径下,绝对 /exercise-catalog.json 会 404。
const CATALOG_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/exercise-catalog.json`;
let cache: Promise<ExerciseCatalog> | null = null;
let byId: Map<string, CatalogExercise> | null = null;

/** 懒加载扩展库(带缓存)。失败抛出,调用方负责显式失败态。 */
export function loadExerciseCatalog(): Promise<ExerciseCatalog> {
  if (cache) return cache;
  cache = fetch(CATALOG_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<ExerciseCatalog>;
    })
    .then((doc) => {
      if (!doc || !Array.isArray(doc.exercises) || doc.exercises.length === 0) {
        throw new Error('数据格式异常(缺 exercises)');
      }
      byId = new Map(doc.exercises.map((e) => [e.id, e]));
      return doc;
    })
    .catch((e) => { cache = null; throw e; }); // 失败不缓存,允许重试
  return cache;
}

/** 同步取扩展库动作(仅在 loadExerciseCatalog 成功后有值);供跟练播放器解析名称/要点。 */
export function catalogExerciseByIdSync(id: string): CatalogExercise | undefined {
  return byId?.get(id);
}

/** 本地动图目录约定:public/exercise-anim/catalog/<media>/ 。 */
export function catalogAnimDir(media: string): string {
  return `/exercise-anim/catalog/${media}`;
}

/** 若本地已放该动作的帧,返回 f00…fNN 路径;否则调用方自行判断存在性。 */
export function catalogAnimFrames(media: string, frames: number): string[] {
  if (!media || frames <= 0) return [];
  const dir = catalogAnimDir(media);
  return Array.from({ length: frames }, (_, i) => `${dir}/f${String(i).padStart(2, '0')}.webp`);
}

/** 关键词过滤(中英名/部位/器械/目标肌/中文要点,大小写不敏感)。 */
export function filterCatalog(list: CatalogExercise[], q: string): CatalogExercise[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((e) =>
    (e.nameZh && e.nameZh.toLowerCase().includes(s))
    || e.name.toLowerCase().includes(s)
    || e.category.toLowerCase().includes(s)
    || e.bodyPart.toLowerCase().includes(s)
    || e.equipment.toLowerCase().includes(s)
    || e.target.toLowerCase().includes(s)
    || (Array.isArray(e.cues) && e.cues.some((c) => c.toLowerCase().includes(s))),
  );
}

/** 从列表提取部位/器械分面(用于筛选 chip),按出现频次降序。 */
export function catalogFacets(list: CatalogExercise[]): { parts: string[]; equips: string[] } {
  const p = new Map<string, number>(); const q = new Map<string, number>();
  for (const e of list) {
    if (e.bodyPart) p.set(e.bodyPart, (p.get(e.bodyPart) || 0) + 1);
    if (e.equipment) q.set(e.equipment, (q.get(e.equipment) || 0) + 1);
  }
  const byFreq = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { parts: byFreq(p), equips: byFreq(q) };
}

/** 器械英文 → 中英标签。 */
export const CATALOG_EQUIP_LABEL: Record<string, string> = {
  'body weight': '徒手', dumbbell: '哑铃', barbell: '杠铃', cable: '绳索',
  'leverage machine': '固定器械', band: '弹力带', 'smith machine': '史密斯架',
  kettlebell: '壶铃', weighted: '负重', 'stability ball': '稳定球',
  'ez barbell': 'EZ 杠', assisted: '辅助', 'sled machine': '雪橇机',
  'medicine ball': '药球', rope: '绳', roller: '滚轮', 'resistance band': '阻力带',
  'bosu ball': 'BOSU 球', 'olympic barbell': '奥林匹克杠', 'wheel roller': '健腹轮',
};

/** 部位英文 → 中文。 */
export const CATALOG_PART_LABEL: Record<string, string> = {
  'upper arms': '上臂', 'upper legs': '大腿', back: '背', waist: '核心/腰',
  chest: '胸', shoulders: '肩', 'lower legs': '小腿', 'lower arms': '前臂',
  cardio: '有氧', neck: '颈',
};
