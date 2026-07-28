/**
 * exercise-parts — 动作库的筛选轴(2026-07-28,用户标注 图5)。
 *
 * 两根轴:部位(BODY_PARTS,渲染成左侧竖栏)和器械(EQUIP_AXIS,横向 chip)。
 *
 * 动作库里本来有**两套**互不相干的部位分类:
 *   · 精选 18 动作(exercise-library.ts)按 MuscleTag 分:臀/髋/核心/背/胸/肩;
 *   · 扩展 1324 动作(exercise-catalog.ts)按 bodyPart 分:upper arms / upper legs /
 *     back / waist / chest / shoulders / lower legs / lower arms / cardio / neck。
 * 界面上就变成「一个肌群 chip 行 + 搜索出结果后又冒出一个部位 chip 行」——
 * 同一件事两个控件,选了这个不影响那个。侧栏只能有一根轴,所以这里把两套并成一套。
 *
 * 每一项声明:
 *   · muscles —— 该部位在**精选库**里对应哪些 MuscleTag(可以为空);
 *   · parts   —— 在**扩展库**里对应哪些 bodyPart;
 *   · targets —— 更细的目标肌(bodyPart 太粗时用)。臀就是靠这个:扩展库没有
 *     「臀」这个 bodyPart,glutes 混在 upper legs 里,只有 target 分得出来。
 *   · notTargets —— 排除项,保证「臀髋」和「腿」不互相吞(否则腿是臀的严格超集)。
 *
 * 两条不变量由 scripts/exercise-parts.test.mjs 压着:
 *   ① 没有点进去两个库都空的死项;
 *   ② 扩展库 1324 个动作,每一个都至少能从某一项里翻到(不许有翻不到的动作)。
 *
 * 纯数据 + 纯函数,不碰 DOM/存储。
 */

import type { MuscleTag, Equip } from './exercise-library';

export interface BodyPartEntry {
  key: string;
  zh: string;
  en: string;
  /** 精选库的肌群标签;空数组 = 精选库里没有这个部位的动作(正常,18 个动作覆盖不全)。 */
  muscles: MuscleTag[];
  /** 扩展库的 bodyPart。 */
  parts: string[];
  /** 扩展库的 target(bodyPart 分不出来时用)。与 parts 是「或」的关系。 */
  targets?: string[];
  /** 命中 parts 但 target 在这里的排除掉 —— 用来切开臀和腿。 */
  notTargets?: string[];
}

/** 顺序 = 侧栏从上到下的顺序。由躯干到四肢,和体感一致。 */
export const BODY_PARTS: readonly BodyPartEntry[] = [
  { key: 'chest', zh: '胸', en: 'Chest', muscles: ['chest'], parts: ['chest'] },
  { key: 'back', zh: '背', en: 'Back', muscles: ['back'], parts: ['back'] },
  { key: 'shoulder', zh: '肩', en: 'Shoulders', muscles: ['shoulder'], parts: ['shoulders'] },
  { key: 'core', zh: '核心', en: 'Core', muscles: ['core'], parts: ['waist'] },
  { key: 'glute', zh: '臀髋', en: 'Glutes', muscles: ['glute', 'hip'], parts: [], targets: ['glutes', 'abductors', 'adductors'] },
  { key: 'legs', zh: '腿', en: 'Legs', muscles: [], parts: ['upper legs', 'lower legs'], notTargets: ['glutes', 'abductors', 'adductors'] },
  { key: 'arms', zh: '手臂', en: 'Arms', muscles: [], parts: ['upper arms', 'lower arms'] },
  { key: 'cardio', zh: '有氧', en: 'Cardio', muscles: [], parts: ['cardio'] },
  { key: 'neck', zh: '颈', en: 'Neck', muscles: [], parts: ['neck'] },
];

export const bodyPartByKey = (key: string): BodyPartEntry | undefined => BODY_PARTS.find((p) => p.key === key);

/** 一条扩展库动作属不属于这一项。'all' 一律为真。 */
export function catalogInPart(e: { bodyPart: string; target: string }, key: string): boolean {
  if (key === 'all') return true;
  const p = bodyPartByKey(key);
  if (!p) return true;
  if (p.notTargets && p.notTargets.includes(e.target)) return false;
  if (p.parts.includes(e.bodyPart)) return true;
  return Boolean(p.targets && p.targets.includes(e.target));
}

/** 精选库的肌群过滤条件。返回 'all' 表示不筛;返回数组表示只要这几个肌群。 */
export function musclesOfPart(key: string): MuscleTag[] | 'all' {
  if (key === 'all') return 'all';
  return bodyPartByKey(key)?.muscles ?? 'all';
}

// ── 器械轴 ────────────────────────────────────────────────────────────────────
// 和部位一模一样的毛病:精选库 4 类器械(徒手/哑铃/凳台/墙)、扩展库 28 类,
// 界面上就出现两行都叫「全部器械」的 chip。这里并成一根轴 —— 扩展库那 28 类里
// 一多半是长尾(hammer/tire/trap bar 各 1 个),按用户实际会问的方式归堆。

export interface EquipEntry {
  key: string;
  zh: string;
  en: string;
  /** 精选库的 Equip;空 = 精选 18 个里没有这类器械的动作。 */
  equips: Equip[];
  /** 扩展库的 equipment 原值。 */
  gear: string[];
}

export const EQUIP_AXIS: readonly EquipEntry[] = [
  { key: 'bodyweight', zh: '徒手', en: 'Bodyweight', equips: ['bodyweight'], gear: ['body weight', 'assisted'] },
  { key: 'dumbbell', zh: '哑铃', en: 'Dumbbell', equips: ['dumbbell'], gear: ['dumbbell', 'kettlebell', 'weighted', 'medicine ball'] },
  { key: 'barbell', zh: '杠铃', en: 'Barbell', equips: [], gear: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'] },
  { key: 'machine', zh: '器械', en: 'Machine', equips: [], gear: ['cable', 'leverage machine', 'smith machine', 'sled machine', 'upper body ergometer', 'skierg machine', 'stationary bike', 'elliptical machine', 'stepmill machine'] },
  { key: 'band', zh: '弹力带', en: 'Band', equips: [], gear: ['band', 'resistance band'] },
  { key: 'ball', zh: '球 / 滚轮', en: 'Ball / roller', equips: [], gear: ['stability ball', 'bosu ball', 'roller', 'wheel roller'] },
  { key: 'bench', zh: '凳台', en: 'Bench', equips: ['bench'], gear: [] },
  { key: 'wall', zh: '墙', en: 'Wall', equips: ['wall'], gear: [] },
  { key: 'other', zh: '其他', en: 'Other', equips: [], gear: ['rope', 'hammer', 'tire'] },
];

export const equipEntryByKey = (key: string): EquipEntry | undefined => EQUIP_AXIS.find((e) => e.key === key);

/** 一条扩展库动作用不用这类器械。'all' / 未知 key 一律为真(宁可全放,不许白屏)。 */
export function catalogInEquip(e: { equipment: string }, key: string): boolean {
  if (key === 'all') return true;
  const g = equipEntryByKey(key);
  if (!g) return true;
  return g.gear.includes(e.equipment);
}

/** 精选库的器械过滤条件。'all' = 不筛。 */
export function equipsOfKey(key: string): Equip[] | 'all' {
  if (key === 'all') return 'all';
  return equipEntryByKey(key)?.equips ?? 'all';
}
