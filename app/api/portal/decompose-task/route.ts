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

function fallbackSteps(taskName: string, drill: boolean): DecomposeStep[] {
  if (drill) {
    return [
      { name: '想清楚目标', emoji: '🎯', durationMin: 1 },
      { name: '动手第一步', emoji: '✏️', durationMin: 2 },
      { name: '完成收尾', emoji: '✅', durationMin: 1 },
    ];
  }
  return [
    { name: `准备开始：${taskName}`, emoji: '📋', durationMin: 2 },
    { name: '执行主要步骤', emoji: '⚡', durationMin: 10 },
    { name: '完成收尾', emoji: '✅', durationMin: 2 },
  ];
}

function buildPrompt(taskName: string, context: string | undefined, drill: boolean): string {
  if (drill) {
    return `把以下步骤拆成3个更小的具体动作，每个动作30秒到2分钟内完成。只输出JSON数组。

步骤：${taskName}
${context ? `背景：${context}` : ''}

格式（只输出这个JSON，不要解释）：
[{"name":"具体动作","emoji":"🔧","durationMin":1},...]`;
  }

  return `把以下任务拆解成3-5个清晰的执行步骤，每步2分钟内能开始。只输出JSON数组。

任务：${taskName}
${context ? `背景：${context}` : ''}

格式（只输出这个JSON，不要解释）：
[{"name":"步骤名称","emoji":"🔧","durationMin":5},...]

要求：步骤名称10字内，emoji贴合内容，时间合理，用中文。`;
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
