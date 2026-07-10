/**
 * Momentum Engine — platform-layer core for task decomposition.
 *
 * 哲学修订(QA 参考竞品实测):完整的诚实计划 > 挤牙膏式微动作。
 *  - 主拆解:3–6 个**覆盖全程**的具体物理步骤,每步给**诚实时长**
 *    (等待也算步骤:「等待洗衣机洗完 · 35 min」),用户一眼看到全貌和总时长。
 *  - 「太难」钻取:把某一步拆成 2–4 个 ≤3 分钟的微动作 —— 微动作只出现在钻取层。
 *  - 严禁废话步骤:「摆好东西/想清楚目标/收尾检查」这类不含具体动作的模板腔一律不许。
 *
 * This module is pure business logic: no HTTP, no Next.js, no side effects.
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
  const en = locale === 'en';
  const langRule = en
    ? 'Write step names in natural, concrete English: verb-first, ≤8 words, one physical action each.'
    : '步骤名用自然具体的中文:动词开头,14 字以内,每步只含一个具体动作。';

  if (drill) {
    // 钻取:把一步拆成微动作(参考竞品:分类衣物 → 准备篮子/集中衣物/查标签/按颜色分堆)
    return en
      ? `Break this single step into 2-4 concrete micro-actions, each doable in ≤3 minutes.

Step: ${taskName}
${context ? `Parent task: ${context}` : ''}

Rules: ${langRule} Each micro-action must be physically specific (what to grab, where to put it). NEVER output filler like "get ready" / "clarify the goal" / "wrap up".
Output ONLY a JSON array (2-4 items), nothing else:
[{"name":"action","emoji":"🧺","durationMin":2},...]`
      : `把下面这一步拆成 2-4 个具体微动作,每个 3 分钟内能做完。

这一步:${taskName}
${context ? `所属任务:${context}` : ''}

规则:${langRule} 每个微动作要有具体的物(拿什么、放哪里),像"准备一个空篮子用于分类"、"把所有衣物集中到一起"这种。**严禁**"想清楚目标/摆好东西/完成收尾"这类没有具体动作的废话。
只输出 JSON 数组(2-4 条),不要任何其他文字:
[{"name":"动作","emoji":"🧺","durationMin":2},...]`;
  }

  const historyHint = completedActions?.length
    ? (en ? `\nAlready done: ${completedActions.slice(-3).join(' → ')}` : `\n已完成:${completedActions.slice(-3).join(' → ')}`) : '';
  const prevHint = previousAction ? (en ? `\nJust finished: ${previousAction}. Plan what remains.` : `\n刚做完:${previousAction}。只拆剩下的部分。`) : '';

  // 主拆解:完整诚实计划(参考竞品:洗衣服 → 分类3min/放入洗衣机2min/选程序1min/等待35min/取出晾晒4min,共45min)
  return en
    ? `Break this task into 3-6 concrete physical steps that cover the WHOLE task in order, each with an honest duration in minutes.${historyHint}${prevHint}

Task: ${taskName}
${context ? `Context: ${context}` : ''}

Rules:
- ${langRule}
- Honest durations — waiting counts as a step (e.g. "Wait for the washer to finish" 35 min).
- Steps must be specific to THIS task. NEVER output filler ("get set up", "check it over") or restate the task name as a step.
- Pick a fitting emoji per step.
Output ONLY a JSON array (3-6 items), nothing else:
[{"name":"Sort clothes by color","emoji":"🧺","durationMin":3},...]`
    : `把这个任务按顺序拆成 3-6 个覆盖全程的具体步骤,每步给出诚实的分钟数。${historyHint}${prevHint}

任务:${taskName}
${context ? `背景:${context}` : ''}

规则:
- ${langRule}
- 时长要诚实 —— 等待也是一步(如「等待洗衣机洗涤完成」35 分钟)。
- 步骤必须针对这个具体任务。**严禁**输出"摆好东西/准备开始/收尾检查一遍"这类通用废话,也不许把任务名本身当一步。
- 每步配一个贴切的 emoji。
只输出 JSON 数组(3-6 条),不要任何其他文字:
[{"name":"分类衣物(按颜色、材质)","emoji":"🧺","durationMin":3},...]`;
}

// ── Fallback (no API keys) ────────────────────────────────────────────────────

export function fallbackMomentumSteps(taskName: string, drill: boolean, locale: string = 'zh'): MomentumStep[] {
  const en = locale === 'en';
  const short = taskName.length > 12 ? taskName.slice(0, 12) + '…' : taskName;
  if (drill) {
    return en
      ? [
          { name: 'Set a 2-minute timer', emoji: '⏲', durationMin: 1 },
          { name: 'Put what you need within reach', emoji: '🫳', durationMin: 2 },
          { name: 'Do the smallest first piece', emoji: '⚡', durationMin: 3 },
        ]
      : [
          { name: '定一个 2 分钟计时器', emoji: '⏲', durationMin: 1 },
          { name: '把要用的东西放到手边', emoji: '🫳', durationMin: 2 },
          { name: '做完最小的第一块', emoji: '⚡', durationMin: 3 },
        ];
  }
  // AI 不在线的诚实兜底:起步脚手架(与 lib/portal/local-decompose 同款语气),不假装懂任务
  return en
    ? [
        { name: `Lay out what "${short}" needs`, emoji: '▶', durationMin: 2 },
        { name: 'Do just the smallest step', emoji: '◆', durationMin: 5 },
        { name: 'Check progress, decide next round', emoji: '✓', durationMin: 1 },
      ]
    : [
        { name: `把「${short}」需要的东西摊在面前`, emoji: '▶', durationMin: 2 },
        { name: '只做最小的一步,做完就算赢', emoji: '◆', durationMin: 5 },
        { name: '看看进度,决定要不要再来一轮', emoji: '✓', durationMin: 1 },
      ];
}

// ── JSON extraction helper ────────────────────────────────────────────────────

export function extractStepsFromText(text: string): MomentumStep[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const arr = (JSON.parse(match[0]) as Array<Partial<MomentumStep>>).slice(0, 6);
    const steps = arr
      .filter((x): x is Partial<MomentumStep> & { name: string } => typeof x?.name === 'string' && x.name.trim().length > 0)
      .map((x) => ({
        name: x.name.trim(),
        emoji: typeof x.emoji === 'string' && x.emoji ? x.emoji : '·',
        durationMin: Number.isFinite(x.durationMin) && (x.durationMin as number) > 0 ? Math.round(x.durationMin as number) : 0,
      }));
    return steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}
