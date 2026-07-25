/**
 * workout-name — 用真实动作名给训练命名(单一真源)。
 * 修「选好动作后卡片/跟练页头名字对不上,只显示『自定义·N动作』」。
 * 精选 18 从核心库拿名;扩展库(1324)从已载入内存的 catalog 拿 nameZh。
 * 存训练时(ExerciseLibrary)和渲染/开练时(TrainingPlan)都用这里,新旧训练一致。
 */

import { exerciseById } from './exercise-library';
import { catalogExerciseByIdSync } from './exercise-catalog';

export function resolveExerciseName(id: string): string {
  const core = exerciseById(id);
  if (core) return core.name;
  const cat = catalogExerciseByIdSync(id);
  if (cat) return cat.nameZh || cat.name;
  return '';
}

/**
 * 从动作列表整合出训练名。1 个→用它的名字;2 个→「名1 · 名2」;3+→「名1 · 名2 等 N 个」。
 * 只要有任一动作名解析不出(如扩展库还没载进内存)就返回 fallback,避免显示半截/编号。
 */
export function workoutDisplayName(
  items: Array<{ exerciseId: string }>,
  fallback: string,
  locale: 'zh' | 'en' = 'zh',
): string {
  if (!items || items.length === 0) return fallback;
  const names = items.map((it) => resolveExerciseName(it.exerciseId));
  if (names.some((n) => !n)) return fallback; // 有解析不出的 → 用兜底名,不显示半截
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} · ${names[1]}`;
  return locale === 'en'
    ? `${names[0]} · ${names[1]} +${names.length - 2}`
    : `${names[0]} · ${names[1]} 等 ${names.length} 个`;
}
