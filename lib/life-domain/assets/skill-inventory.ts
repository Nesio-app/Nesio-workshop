/**
 * life-domain/assets · skill-inventory — 技能/动作清单(批次 40)。
 *
 * 「资产(assets)」域:用户可掌握/积累的能力条目。第一类资产是 fitness 动作库,
 * 但结构是通用的 —— 未来可放其它技能(乐器、语言、料理…)。训练计划引擎的动作处方
 * 通过 skillId 引用这里的条目。这是单一事实源,training-protocol-engine 从此处取。
 */

export type SkillDomain = 'fitness';
export type Muscle = 'legs' | 'push' | 'pull' | 'core' | 'fullbody' | 'cardio';
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'bodyweight' | 'kettlebell' | 'cardio' | 'band';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface Skill {
  id: string;
  domain: SkillDomain;
  name: { zh: string; en: string };
  muscle: Muscle;
  equipment: Equipment;
  difficulty: Difficulty;
}

export const SKILL_INVENTORY: readonly Skill[] = [
  { id: 'squat', domain: 'fitness', name: { zh: '深蹲', en: 'Back squat' }, muscle: 'legs', equipment: 'barbell', difficulty: 'intermediate' },
  { id: 'front_squat', domain: 'fitness', name: { zh: '前蹲', en: 'Front squat' }, muscle: 'legs', equipment: 'barbell', difficulty: 'advanced' },
  { id: 'deadlift', domain: 'fitness', name: { zh: '硬拉', en: 'Deadlift' }, muscle: 'pull', equipment: 'barbell', difficulty: 'intermediate' },
  { id: 'rdl', domain: 'fitness', name: { zh: '罗马尼亚硬拉', en: 'Romanian deadlift' }, muscle: 'pull', equipment: 'barbell', difficulty: 'intermediate' },
  { id: 'bench', domain: 'fitness', name: { zh: '卧推', en: 'Bench press' }, muscle: 'push', equipment: 'barbell', difficulty: 'intermediate' },
  { id: 'ohp', domain: 'fitness', name: { zh: '推举', en: 'Overhead press' }, muscle: 'push', equipment: 'barbell', difficulty: 'intermediate' },
  { id: 'row', domain: 'fitness', name: { zh: '划船', en: 'Barbell row' }, muscle: 'pull', equipment: 'barbell', difficulty: 'intermediate' },
  { id: 'db_press', domain: 'fitness', name: { zh: '哑铃卧推', en: 'DB bench press' }, muscle: 'push', equipment: 'dumbbell', difficulty: 'beginner' },
  { id: 'goblet_squat', domain: 'fitness', name: { zh: '高脚杯深蹲', en: 'Goblet squat' }, muscle: 'legs', equipment: 'dumbbell', difficulty: 'beginner' },
  { id: 'pullup', domain: 'fitness', name: { zh: '引体向上', en: 'Pull-up' }, muscle: 'pull', equipment: 'bodyweight', difficulty: 'intermediate' },
  { id: 'pushup', domain: 'fitness', name: { zh: '俯卧撑', en: 'Push-up' }, muscle: 'push', equipment: 'bodyweight', difficulty: 'beginner' },
  { id: 'lunge', domain: 'fitness', name: { zh: '箭步蹲', en: 'Lunge' }, muscle: 'legs', equipment: 'bodyweight', difficulty: 'beginner' },
  { id: 'plank', domain: 'fitness', name: { zh: '平板支撑', en: 'Plank' }, muscle: 'core', equipment: 'bodyweight', difficulty: 'beginner' },
  { id: 'hollow', domain: 'fitness', name: { zh: '空心支撑', en: 'Hollow hold' }, muscle: 'core', equipment: 'bodyweight', difficulty: 'intermediate' },
  { id: 'kb_swing', domain: 'fitness', name: { zh: '壶铃摆荡', en: 'Kettlebell swing' }, muscle: 'fullbody', equipment: 'kettlebell', difficulty: 'beginner' },
  { id: 'run', domain: 'fitness', name: { zh: '跑步', en: 'Run' }, muscle: 'cardio', equipment: 'cardio', difficulty: 'beginner' },
  { id: 'row_erg', domain: 'fitness', name: { zh: '划船机', en: 'Rowing erg' }, muscle: 'cardio', equipment: 'cardio', difficulty: 'beginner' },
  { id: 'bike', domain: 'fitness', name: { zh: '骑行', en: 'Cycling' }, muscle: 'cardio', equipment: 'cardio', difficulty: 'beginner' },
];

export function skillById(id: string): Skill | undefined {
  return SKILL_INVENTORY.find((s) => s.id === id);
}

export function skillsByMuscle(muscle: Muscle): Skill[] {
  return SKILL_INVENTORY.filter((s) => s.muscle === muscle);
}
