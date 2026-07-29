/**
 * workout-generate — 「今天练什么」两问生成器(借 workout.lol 之形:器械先行 → 选部位 → 一键成套)。
 * 纯规则抽样,不是 AI:从 1324 动作目录按 已选器械 × 部位槽位计划 抽 4/6 个,主肌群在前、辅助在后。
 * 数据层零新增:目录来自 exercise-catalog,成套后走现有 nesio-start-workout / workout-store。
 * rng 可注入(契约测试用固定序列;运行时 Math.random)。
 */

import type { CatalogExercise } from './exercise-catalog';
import { reportStorageDropped } from './storage-health';

export type GenEquip = 'body' | 'dumbbell' | 'band' | 'kettlebell' | 'barbell' | 'gym';
export type GenFocus = 'balanced' | 'push' | 'pull' | 'legs' | 'core';
export type FocusBucket = Exclude<GenFocus, 'balanced'>;

/** 器械 chip → 目录 equipment 取值。'gym' = 不过滤(健身房全套)。 */
export const EQUIP_VALUES: Record<GenEquip, string[] | 'all'> = {
  body: ['body weight'],
  dumbbell: ['dumbbell'],
  band: ['band', 'resistance band'],
  kettlebell: ['kettlebell'],
  barbell: ['barbell', 'ez barbell', 'olympic barbell'],
  gym: 'all',
};

export const EQUIP_OPTIONS: Array<[GenEquip, string, string]> = [
  ['body', '徒手', 'Bodyweight'], ['dumbbell', '哑铃', 'Dumbbell'], ['band', '弹力带', 'Band'],
  ['kettlebell', '壶铃', 'Kettlebell'], ['barbell', '杠铃', 'Barbell'], ['gym', '健身房全套', 'Full gym'],
];

export const FOCUS_OPTIONS: Array<[GenFocus, string, string]> = [
  ['balanced', '均衡全身', 'Full body'], ['push', '推 · 胸肩', 'Push'], ['pull', '拉 · 背', 'Pull'],
  ['legs', '腿', 'Legs'], ['core', '核心', 'Core'],
];

/** 目录 target → 推/拉/腿/核心 桶(回溯归因与槽位计划共用)。 */
export const TARGET_BUCKET: Record<string, FocusBucket> = {
  pectorals: 'push', delts: 'push', triceps: 'push', 'serratus anterior': 'push',
  lats: 'pull', 'upper back': 'pull', biceps: 'pull', traps: 'pull', forearms: 'pull', 'levator scapulae': 'pull',
  glutes: 'legs', quads: 'legs', hamstrings: 'legs', calves: 'legs', adductors: 'legs', abductors: 'legs',
  abs: 'core', spine: 'core',
};

/** 目标肌中文标签(草稿行展示用;目录只有英文 target)。 */
export const TARGET_LABEL: Record<string, [string, string]> = {
  pectorals: ['胸', 'Chest'], delts: ['肩', 'Delts'], triceps: ['三头', 'Triceps'],
  'serratus anterior': ['前锯肌', 'Serratus'], lats: ['背阔肌', 'Lats'], 'upper back': ['中上背', 'Upper back'],
  biceps: ['二头', 'Biceps'], traps: ['斜方肌', 'Traps'], forearms: ['前臂', 'Forearms'],
  'levator scapulae': ['肩胛提肌', 'Lev. scap'], glutes: ['臀', 'Glutes'], quads: ['股四头', 'Quads'],
  hamstrings: ['腘绳肌', 'Hamstrings'], calves: ['小腿', 'Calves'], adductors: ['内收肌', 'Adductors'],
  abductors: ['外展肌', 'Abductors'], abs: ['腹', 'Abs'], spine: ['下背/竖脊', 'Spine'],
};

/** 槽位计划:每套 6 槽(轻量取前 4),主肌群 4 + 辅助 2 的配比写死在这里。 */
const SLOT_PLAN: Record<GenFocus, string[][]> = {
  push: [['pectorals'], ['delts'], ['triceps'], ['pectorals', 'delts'], ['triceps', 'delts'], ['serratus anterior', 'pectorals']],
  pull: [['lats'], ['upper back'], ['biceps'], ['traps', 'upper back'], ['lats', 'upper back'], ['forearms', 'biceps']],
  legs: [['quads'], ['glutes'], ['hamstrings'], ['calves'], ['glutes', 'adductors', 'abductors'], ['quads', 'hamstrings']],
  core: [['abs'], ['abs'], ['spine'], ['abs'], ['spine', 'abs'], ['abs']],
  balanced: [['pectorals', 'delts'], ['lats', 'upper back'], ['quads', 'glutes'], ['abs'], ['triceps', 'biceps'], ['hamstrings', 'calves', 'glutes']],
};

export interface GeneratedItem {
  exercise: CatalogExercise;
  sets: number;
  reps: number;
  unit: 'reps' | 'sec';
}

/** 静态/等长动作按秒计(平板撑/靠墙蹲/各种 hold)。 */
export function isTimedExercise(e: Pick<CatalogExercise, 'name' | 'nameZh'>): boolean {
  return /plank|hold|isometric|wall sit|静态|支撑|保持/i.test(`${e.name} ${e.nameZh || ''}`);
}

function doseFor(e: CatalogExercise): Pick<GeneratedItem, 'sets' | 'reps' | 'unit'> {
  if (isTimedExercise(e)) return { sets: 3, reps: 30, unit: 'sec' };
  if (e.target === 'abs') return { sets: 3, reps: 12, unit: 'reps' };
  return { sets: 3, reps: 10, unit: 'reps' };
}

/** 按已选器械过滤目录(多选取并集;含 gym 则全量)。 */
export function equipPool(list: CatalogExercise[], equips: GenEquip[]): CatalogExercise[] {
  if (equips.includes('gym')) return list;
  const allow = new Set(equips.flatMap((k) => (EQUIP_VALUES[k] === 'all' ? [] : (EQUIP_VALUES[k] as string[]))));
  if (allow.size === 0) return [];
  return list.filter((e) => allow.has(e.equipment));
}

/**
 * 生成一套:按槽位计划逐槽抽样,不重复;某槽在当前器械下无可选动作则如实跳过
 * (返回可能少于 count —— 诚实呈现,不硬凑不相干动作)。
 */
export function generateWorkout(
  list: CatalogExercise[],
  opts: { equips: GenEquip[]; focus: GenFocus; count: 4 | 6; rng?: () => number },
): GeneratedItem[] {
  const rng = opts.rng ?? Math.random;
  const pool = equipPool(list, opts.equips);
  const slots = SLOT_PLAN[opts.focus].slice(0, opts.count);
  const used = new Set<string>();
  const out: GeneratedItem[] = [];
  for (const targets of slots) {
    const tset = new Set(targets);
    let cands = pool.filter((e) => tset.has(e.target) && !used.has(e.id));
    if (cands.length === 0) {
      // 放宽到该 focus 的全部目标肌,仍空则跳过这一槽
      const wide = new Set(SLOT_PLAN[opts.focus].flat());
      cands = pool.filter((e) => wide.has(e.target) && !used.has(e.id));
    }
    if (cands.length === 0) continue;
    const pick = cands[Math.floor(rng() * cands.length) % cands.length];
    used.add(pick.id);
    out.push({ exercise: pick, ...doseFor(pick) });
  }
  return out;
}

/** 「换一个」:同目标肌 × 同器械池里换,不与整套里已有的重复;无可换返回 null。 */
export function swapAlternative(
  list: CatalogExercise[],
  current: GeneratedItem[],
  index: number,
  opts: { equips: GenEquip[]; rng?: () => number },
): GeneratedItem | null {
  const rng = opts.rng ?? Math.random;
  const target = current[index]?.exercise.target;
  if (!target) return null;
  const used = new Set(current.map((it) => it.exercise.id));
  const cands = equipPool(list, opts.equips).filter((e) => e.target === target && !used.has(e.id));
  if (cands.length === 0) return null;
  const pick = cands[Math.floor(rng() * cands.length) % cands.length];
  return { exercise: pick, ...doseFor(pick) };
}

/** 粗略时长:每组约 1.5 分钟(动作 + 组间 45s),向上取 5 分钟粒度。 */
export function estimateMinutes(items: Array<{ sets: number }>): number {
  const sets = items.reduce((s, it) => s + it.sets, 0);
  return Math.max(5, Math.round((sets * 1.5) / 5) * 5);
}

// ── 回溯:上次练了什么 → 建议今天练什么 ──────────────────────────────

export interface LastWorkoutRecord {
  date: string;       // YYYY-MM-DD
  name: string;
  focus: FocusBucket | null;  // 归因不出来(纯有氧/未知动作)则 null
}

const LAST_KEY = 'nesio-workout-last-v1';

/** 精选 18(exercise-library)的肌群标签 → 目录 target,回溯归因对两套动作库一视同仁。 */
export const CURATED_TAG_TARGET: Record<string, string> = {
  chest: 'pectorals', shoulder: 'delts', back: 'lats', glute: 'glutes', hip: 'glutes', core: 'abs',
};

/** 从一次训练的目标肌列表归因主部位(多数票;全都归不了则 null)。 */
export function inferFocus(targets: string[]): FocusBucket | null {
  const votes = new Map<FocusBucket, number>();
  for (const t of targets) {
    const b = TARGET_BUCKET[t];
    if (b) votes.set(b, (votes.get(b) || 0) + 1);
  }
  let best: FocusBucket | null = null; let n = 0;
  for (const [b, c] of votes) if (c > n) { best = b; n = c; }
  return best;
}

/** 跟练完成时记一笔(任何来源:生成的 / 自定义 / 计划),给下次的回溯建议用。 */
export function recordWorkoutDone(name: string, targets: string[], now: Date = new Date()): void {
  if (typeof window === 'undefined') return;
  const rec: LastWorkoutRecord = { date: now.toISOString().slice(0, 10), name, focus: inferFocus(targets) };
  try { localStorage.setItem(LAST_KEY, JSON.stringify(rec)); } catch { reportStorageDropped(); }
}

export function loadLastWorkout(): LastWorkoutRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') as LastWorkoutRecord | null;
    return v && typeof v.date === 'string' && typeof v.name === 'string' ? v : null;
  } catch { return null; }
}

/** 轮换建议:推→拉,拉→腿,腿→推,核心→均衡;没历史 → 均衡。只是预选,不强推。 */
export function suggestNextFocus(last: FocusBucket | null): GenFocus {
  if (last === 'push') return 'pull';
  if (last === 'pull') return 'legs';
  if (last === 'legs') return 'push';
  return 'balanced';
}

// ── 器械偏好(答一次,长期复用)────────────────────────────────────

const EQUIP_KEY = 'nesio-workout-equip-v1';
const GEN_EQUIPS: readonly GenEquip[] = ['body', 'dumbbell', 'band', 'kettlebell', 'barbell', 'gym'];

export function loadEquipPref(): GenEquip[] {
  if (typeof window === 'undefined') return ['body'];
  try {
    const v = JSON.parse(localStorage.getItem(EQUIP_KEY) || 'null');
    const ok = Array.isArray(v) ? (v as string[]).filter((k): k is GenEquip => (GEN_EQUIPS as readonly string[]).includes(k)) : [];
    return ok.length ? ok : ['body'];
  } catch { return ['body']; }
}

export function saveEquipPref(equips: GenEquip[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(EQUIP_KEY, JSON.stringify(equips)); } catch { reportStorageDropped(); }
}
