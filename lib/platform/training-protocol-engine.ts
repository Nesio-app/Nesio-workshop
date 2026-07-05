/**
 * training-protocol-engine — 训练计划「结构」(不是分析引擎)。批次 40。
 *
 * 这是一份纯数据模型 + 存储:把「训练计划」表达成可执行的层级结构
 *   Protocol(计划)→ Phase(阶段/周期)→ SessionTemplate(单次训练)→ ExercisePrescription(动作处方)
 * 以及用户的执行日志(哪天做了哪个 session)。不做任何 AI/分析判断 —— 分析层(体能状态/负荷)
 * 是另一件事,建在这份结构之上。
 *
 * 动作(exercise)先用轻量引用(id + 名称);未来若建 life-domain/assets 的「动作库/skill
 * inventory」,exerciseId 可指向那里。当前内置一份最小 seed 动作表。
 */

// ── 动作库:单一事实源在 life-domain/assets 的 skill-inventory(批次 40 迁出)──
import { SKILL_INVENTORY, skillById, type Skill } from '@/lib/life-domain/assets/skill-inventory';

export type Exercise = Skill;
export const EXERCISE_LIBRARY = SKILL_INVENTORY;
export function exerciseById(id: string): Exercise | undefined {
  return skillById(id);
}

// ── 计划结构 ──
export interface ExercisePrescription {
  exerciseId: string;
  sets: number;
  /** 次数(力量)或分钟(有氧,用 unit 'min') */
  reps: number;
  unit?: 'reps' | 'min';
  restSec?: number;
  /** 强度参考:RPE 6-10 或 %1RM,或配速 */
  intensity?: string;
  notes?: { zh: string; en: string };
}

export interface SessionTemplate {
  id: string;
  name: { zh: string; en: string };
  items: ExercisePrescription[];
}

export interface Phase {
  name: { zh: string; en: string };
  weeks: number;
  /** 该阶段每周按顺序循环的训练日 */
  sessions: SessionTemplate[];
}

export interface TrainingProtocol {
  id: string;
  name: { zh: string; en: string };
  goal: 'strength' | 'hypertrophy' | 'endurance' | 'general';
  sessionsPerWeek: number;
  phases: Phase[];
}

/** 计划总周数。 */
export function protocolWeeks(p: TrainingProtocol): number {
  return p.phases.reduce((s, ph) => s + ph.weeks, 0);
}

// ── 两个种子计划 ──
export const PROTOCOL_LIBRARY: readonly TrainingProtocol[] = [
  {
    id: 'strength_3day',
    name: { zh: '力量 · 每周三练', en: 'Strength · 3-day' },
    goal: 'strength',
    sessionsPerWeek: 3,
    phases: [
      {
        name: { zh: '基础期', en: 'Base' },
        weeks: 4,
        sessions: [
          { id: 'a', name: { zh: '下肢 A', en: 'Lower A' }, items: [
            { exerciseId: 'squat', sets: 3, reps: 5, restSec: 180, intensity: 'RPE 7' },
            { exerciseId: 'row', sets: 3, reps: 8, restSec: 120 },
            { exerciseId: 'plank', sets: 3, reps: 1, unit: 'min' },
          ] },
          { id: 'b', name: { zh: '上肢 B', en: 'Upper B' }, items: [
            { exerciseId: 'bench', sets: 3, reps: 5, restSec: 180, intensity: 'RPE 7' },
            { exerciseId: 'pullup', sets: 3, reps: 6, restSec: 120 },
            { exerciseId: 'ohp', sets: 3, reps: 8, restSec: 120 },
          ] },
          { id: 'c', name: { zh: '全身 C', en: 'Full C' }, items: [
            { exerciseId: 'deadlift', sets: 3, reps: 5, restSec: 210, intensity: 'RPE 7' },
            { exerciseId: 'lunge', sets: 3, reps: 10, restSec: 90 },
            { exerciseId: 'pushup', sets: 3, reps: 12, restSec: 90 },
          ] },
        ],
      },
    ],
  },
  {
    id: 'run_base',
    name: { zh: '跑步 · 打基础', en: 'Running · base build' },
    goal: 'endurance',
    sessionsPerWeek: 3,
    phases: [
      {
        name: { zh: '有氧基础', en: 'Aerobic base' },
        weeks: 6,
        sessions: [
          { id: 'easy', name: { zh: '轻松跑', en: 'Easy run' }, items: [{ exerciseId: 'run', sets: 1, reps: 30, unit: 'min', intensity: '轻松配速' }] },
          { id: 'tempo', name: { zh: '节奏跑', en: 'Tempo' }, items: [{ exerciseId: 'run', sets: 1, reps: 25, unit: 'min', intensity: '乳酸阈附近' }] },
          { id: 'long', name: { zh: '长距离', en: 'Long run' }, items: [{ exerciseId: 'run', sets: 1, reps: 50, unit: 'min', intensity: '轻松配速' }] },
        ],
      },
    ],
  },
];

export function protocolById(id: string): TrainingProtocol | undefined {
  return PROTOCOL_LIBRARY.find((p) => p.id === id);
}

// ── 跟练播放器接口(批次 46)──
export interface RunStep { exerciseId: string; sets: number; reps: number; unit: 'reps' | 'sec'; restSec?: number }

/** 把一个 session 的处方转成播放器步骤('min' 换算成秒)。 */
export function toRunSteps(items: ExercisePrescription[]): RunStep[] {
  return items.map((it) => ({
    exerciseId: it.exerciseId,
    sets: it.sets,
    reps: it.unit === 'min' ? it.reps * 60 : it.reps,
    unit: it.unit === 'min' ? 'sec' : 'reps',
    restSec: it.restSec,
  }));
}

/** 本周该做的下一个 session:用第一阶段的训练日按本周完成数轮换。 */
export function nextSessionOf(p: TrainingProtocol, doneThisWeek: number): SessionTemplate | undefined {
  const phase = p.phases[0];
  if (!phase?.sessions.length) return undefined;
  return phase.sessions[doneThisWeek % phase.sessions.length];
}

// ── 用户状态:选中的计划 + 执行日志 ──
export interface TrainingState {
  activeProtocolId: string | null;
  startedAt: string | null; // ISO
  /** 完成过的 session:key = 'YYYY-MM-DD', value = sessionId */
  log: Array<{ date: string; protocolId: string; sessionId: string }>;
}

const KEY = 'nesio-training-v1';

export function loadTrainingState(): TrainingState {
  if (typeof window === 'undefined') return { activeProtocolId: null, startedAt: null, log: [] };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as TrainingState | null;
    if (s && typeof s === 'object' && Array.isArray(s.log)) return s;
  } catch { /* ignore */ }
  return { activeProtocolId: null, startedAt: null, log: [] };
}

export function saveTrainingState(s: TrainingState): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export function startProtocol(protocolId: string): TrainingState {
  const s: TrainingState = { activeProtocolId: protocolId, startedAt: new Date().toISOString(), log: loadTrainingState().log };
  saveTrainingState(s);
  return s;
}

export function logSession(protocolId: string, sessionId: string, date = new Date().toISOString().slice(0, 10)): TrainingState {
  const s = loadTrainingState();
  s.log = [{ date, protocolId, sessionId }, ...s.log].slice(0, 500);
  saveTrainingState(s);
  return s;
}

/** 本周已完成的训练次数(周一为周初)。 */
export function sessionsThisWeek(s = loadTrainingState()): number {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一=0
  const monday = new Date(now); monday.setDate(now.getDate() - day); monday.setHours(0, 0, 0, 0);
  const mondayKey = monday.toISOString().slice(0, 10);
  return s.log.filter((e) => e.date >= mondayKey).length;
}
