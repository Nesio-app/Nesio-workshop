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

function buildPrompt(taskName: string, context: string | undefined, drill: boolean): string {
  if (drill) {
    return `把以下步骤拆成2-4个更小的具体动作，每个动作30秒到3分钟内完成。

步骤：${taskName}
${context ? `背景任务：${context}` : ''}

只输出JSON数组，不要解释：
[{"name":"具体动作（8字内，动词开头）","emoji":"🔧","durationMin":1},...]`;
  }

  const cat = detectTaskHint(taskName, context);
  const stepCount = cat?.stepCount ?? '3-5';
  const categoryHint = cat ? `\n参考结构（可调整）：${cat.hint}` : '';

  return `你是 ADHD 友好的任务教练。把任务拆成${stepCount}个清晰步骤。
${categoryHint}

任务：${taskName}
${context ? `背景：${context}` : ''}

规则：
- 第1步必须是最低门槛的启动动作（1-2分钟内能立即做，减少拖延阻力）
- 步骤名10字内，中文，动词开头
- emoji 贴合该步内容，不要全用通用 emoji
- durationMin 根据实际估算，不要全写5
- 最后1步是"确认完成"或"收尾"

只输出JSON数组，不要任何解释：
[{"name":"步骤名","emoji":"📋","durationMin":5},...]`;
}

async function callClaude(
  apiKey: string, taskName: string, context: string | undefined, drill: boolean,
): Promise<DecomposeStep[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: buildPrompt(taskName, context, drill) }],
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
  return (JSON.parse(match[0]) as DecomposeStep[]).slice(0, 6);
}

async function callGemini(
  apiKey: string, taskName: string, context: string | undefined, drill: boolean,
): Promise<DecomposeStep[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(taskName, context, drill) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
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
  return (JSON.parse(match[0]) as DecomposeStep[]).slice(0, 6);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { taskName?: string; context?: string; drill?: boolean };
  const taskName = (body.taskName ?? '').trim();
  const drill = body.drill ?? false;

  if (!taskName) {
    return NextResponse.json({ ok: false, error: 'taskName required' }, { status: 400 });
  }

  const claudeKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  const geminiKey = envValue('GEMINI_API_KEY');

  if (!claudeKey && !geminiKey) {
    return NextResponse.json({ ok: true, steps: fallbackSteps(taskName, drill) });
  }

  if (claudeKey) {
    try {
      const steps = await callClaude(claudeKey, taskName, body.context, drill);
      if (steps.length > 0) return NextResponse.json({ ok: true, steps });
    } catch (err) {
      console.error('[decompose] Claude error:', err instanceof Error ? err.message : err);
    }
  }

  if (geminiKey) {
    try {
      const steps = await callGemini(geminiKey, taskName, body.context, drill);
      if (steps.length > 0) return NextResponse.json({ ok: true, steps });
    } catch (err) {
      console.error('[decompose] Gemini error:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, steps: fallbackSteps(taskName, drill) });
}
