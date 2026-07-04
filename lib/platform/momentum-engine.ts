/**
 * Momentum Engine — platform-layer core for task decomposition.
 *
 * Philosophy: show only the next 3 physical actions, never a full plan.
 * Each wave of 3 maintains momentum; completing all 3 unlocks the next wave.
 * "太难" on any action triggers a recursive drill into 3 micro-actions.
 *
 * This module is pure business logic: no HTTP, no Next.js, no side effects.
 * API routes and other surfaces import from here.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MomentumStep {
  name: string;
  emoji: string;
  durationMin: number;
}

export interface MomentumParams {
  /** 界面语言(zh/en)— 动作名随语言生成(批次 14) */
  locale?: string;
  taskName: string;
  context?: string;
  drill?: boolean;
  previousAction?: string;    // last completed action from prior wave
  completedActions?: string[]; // full history — gives AI context only, never shown to user
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildMomentumPrompt(p: MomentumParams): string {
  const { taskName, context, drill = false, previousAction, completedActions, locale = 'zh' } = p;
  // 批次 14:动作名跟随界面语言;文案要求「自然、具体、不生硬」
  const langRule = locale === 'en'
    ? 'Write action names in natural, concrete English (verb-first, ≤6 words).'
    : '动作名用自然、具体的中文口语,动词开头,10 字以内,不要生硬的模板腔(如「打开/找到入口」)。';

  if (drill) {
    return `你是动量。把这个动作拆成恰好3个物理微动作，每个30秒到1分钟内完成。

动作：${taskName}
${context ? `背景任务：${context}` : ''}

规则：${langRule} 只有一个物理步骤，10秒内可开始。
只输出JSON数组恰好3条，不要解释：
[{"name":"action","emoji":"⚡","durationMin":1},...]`;
  }

  const isFirstWave = !previousAction && (!completedActions || completedActions.length === 0);
  const historyHint = completedActions?.length
    ? `\n刚完成：${completedActions.slice(-3).join(' → ')}` : '';
  const prevHint = previousAction ? `\n上一步：${previousAction}，接下来：` : '';

  return `你不是规划者。你是动量。
你的唯一职责：让用户保持移动。${historyHint}${prevHint}

目标：${taskName}
${context ? `背景：${context}` : ''}

生成恰好3个物理动作：
- 每个动作不超过1分钟
- 只有一个物理步骤（不包含"和"字连接的两个动作）
- ${langRule}
- 10秒内可以立即开始${isFirstWave ? '\n- 第1步：最低门槛启动动作，5秒内能做' : ''}
- 不解释，不计划，不透露未来步骤

只输出JSON数组恰好3条，不要任何其他文字：
[{"name":"动词动作","emoji":"⚡","durationMin":1},...]`;
}

// ── Fallback (no API keys) ────────────────────────────────────────────────────

export function fallbackMomentumSteps(taskName: string, drill: boolean, locale: string = 'zh'): MomentumStep[] {
  const en = locale === 'en';
  if (drill) {
    return [
      { name: en ? 'Clarify the goal' : '想清楚目标', emoji: '🎯', durationMin: 1 },
      { name: en ? 'Do the first bit' : '动手第一步', emoji: '✏️', durationMin: 2 },
      { name: en ? 'Wrap it up' : '完成收尾',   emoji: '✅', durationMin: 1 },
    ];
  }
  return [
    { name: en ? 'Get set up' : '摆好东西,准备开始', emoji: '🚪', durationMin: 1 },
    { name: en ? `Start: ${taskName.slice(0, 20)}` : `开始:${taskName.slice(0, 8)}`, emoji: '⚡', durationMin: 10 },
    { name: en ? 'Check it off' : '收尾检查一遍', emoji: '✅', durationMin: 2 },
  ];
}

// ── JSON extraction helper ────────────────────────────────────────────────────

export function extractStepsFromText(text: string): MomentumStep[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    return (JSON.parse(match[0]) as MomentumStep[]).slice(0, 3);
  } catch {
    return null;
  }
}
