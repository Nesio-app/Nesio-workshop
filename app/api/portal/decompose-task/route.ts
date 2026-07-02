/**
 * POST /api/portal/decompose-task
 * AI-decomposes a task into ordered, time-estimated subtasks.
 * Input: { taskName, context?, drill?: boolean }
 * Output: { ok, steps: [{name, emoji, durationMin}] }
 * Primary: Claude Haiku. Fallback: Gemini 1.5 Flash.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export interface DecomposeStep {
  name: string;
  emoji: string;
  durationMin: number;
}

// Task category hints for contextually appropriate decomposition
const TASK_CATEGORY_HINTS: Array<{ regex: RegExp; hint: string; stepCount: string }> = [
  { regex: /会议|meeting|视频|电话会|interview|面试|1on1|周会|同步/i, stepCount: '3', hint: '提前检查设备→准备议题/问题→会议中记录要点' },
  { regex: /学习|复习|背|读|看书|课|homework|作业|study|预习|复盘/i, stepCount: '4', hint: '明确今天目标→分段学习（番茄钟）→练习/做题→回顾确认' },
  { regex: /买|购|超市|送|取|拿|快递|采购/i, stepCount: '3', hint: '列清单/检查存量→出发执行→确认完成' },
  { regex: /写|报告|文章|总结|draft|文档|ppt|汇报|邮件/i, stepCount: '4', hint: '理清要点/列提纲→写初稿→检查修改→定稿发送' },
  { regex: /代码|coding|debug|bug|fix|feature|pr|开发|测试/i, stepCount: '5', hint: '理清问题→本地搭环境/复现→实现→测试→提交' },
  { regex: /清理|整理|打扫|归纳|收拾|断舍离/i, stepCount: '4', hint: '按区域规划→清出所有物品→分类处置→归位整洁' },
  { regex: /健身|运动|跑步|锻炼|workout|瑜伽|游泳/i, stepCount: '3', hint: '热身5分钟→主训练→拉伸放松' },
  { regex: /申请|填表|材料|手续|预约|注册|办理/i, stepCount: '4', hint: '确认所需材料→准备/扫描文件→填写提交→确认收到' },
  { regex: /计划|规划|制定|思考|想清楚|决策/i, stepCount: '3', hint: '收集现有信息→梳理核心问题→做出决定/输出结论' },
];

function detectTaskHint(taskName: string, context?: string): { hint: string; stepCount: string } | null {
  const text = `${taskName} ${context || ''}`;
  for (const cat of TASK_CATEGORY_HINTS) {
    if (cat.regex.test(text)) return { hint: cat.hint, stepCount: cat.stepCount };
  }
  return null;
}

function fallbackSteps(taskName: string, drill: boolean): DecomposeStep[] {
  if (drill) {
    return [
      { name: '想清楚目标', emoji: '🎯', durationMin: 1 },
      { name: '动手第一步', emoji: '✏️', durationMin: 2 },
      { name: '完成收尾', emoji: '✅', durationMin: 1 },
    ];
  }
  return [
    { name: '打开/找到入口', emoji: '🚪', durationMin: 1 },
    { name: `开始执行：${taskName.slice(0, 10)}`, emoji: '⚡', durationMin: 10 },
    { name: '检查完成', emoji: '✅', durationMin: 2 },
  ];
}

function buildPrompt(
  taskName: string,
  context: string | undefined,
  drill: boolean,
  previousAction?: string,
  completedActions?: string[],
): string {
  // ── Drill mode: recursively decompose one action that's still too hard ──
  if (drill) {
    return `你是动量。把这个动作拆成恰好3个物理微动作，每个30秒到1分钟内完成。

动作：${taskName}
${context ? `背景任务：${context}` : ''}

规则：动词开头，8字以内，只有一个物理步骤，10秒内可开始。
只输出JSON数组恰好3条，不要解释：
[{"name":"动词动作","emoji":"⚡","durationMin":1},...]`;
  }

  // ── Momentum mode: always exactly 3, never reveal beyond these 3 ──
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
- 动词开头，10字以内，中文
- 10秒内可以立即开始${isFirstWave ? '\n- 第1步：最低门槛启动动作（打开/找到/拿出），5秒内能做' : ''}
- 不解释，不计划，不透露未来步骤

只输出JSON数组恰好3条，不要任何其他文字：
[{"name":"动词动作","emoji":"⚡","durationMin":1},...]`;
}

interface MomentumParams {
  taskName: string;
  context: string | undefined;
  drill: boolean;
  previousAction?: string;
  completedActions?: string[];
}

async function callClaude(apiKey: string, p: MomentumParams): Promise<DecomposeStep[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPrompt(p.taskName, p.context, p.drill, p.previousAction, p.completedActions) }],
    }),
  });
  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  const text = (data.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('no JSON');
  return (JSON.parse(match[0]) as DecomposeStep[]).slice(0, 3);
}

async function callGemini(apiKey: string, p: MomentumParams): Promise<DecomposeStep[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(p.taskName, p.context, p.drill, p.previousAction, p.completedActions) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
      }),
    },
  );
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('no JSON');
  return (JSON.parse(match[0]) as DecomposeStep[]).slice(0, 3);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    taskName?: string;
    context?: string;
    drill?: boolean;
    previousAction?: string;
    completedActions?: string[];
  };
  const taskName = (body.taskName ?? '').trim();
  const drill = body.drill ?? false;

  if (!taskName) {
    return NextResponse.json({ ok: false, error: 'taskName required' }, { status: 400 });
  }

  const p: MomentumParams = {
    taskName,
    context: body.context,
    drill,
    previousAction: body.previousAction,
    completedActions: body.completedActions,
  };

  const claudeKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  const geminiKey = envValue('GEMINI_API_KEY');

  if (!claudeKey && !geminiKey) {
    return NextResponse.json({ ok: true, steps: fallbackSteps(taskName, drill) });
  }

  if (claudeKey) {
    try {
      const steps = await callClaude(claudeKey, p);
      if (steps.length > 0) return NextResponse.json({ ok: true, steps });
    } catch (err) {
      console.error('[decompose] Claude error:', err instanceof Error ? err.message : err);
    }
  }

  if (geminiKey) {
    try {
      const steps = await callGemini(geminiKey, p);
      if (steps.length > 0) return NextResponse.json({ ok: true, steps });
    } catch (err) {
      console.error('[decompose] Gemini error:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, steps: fallbackSteps(taskName, drill) });
}
