/**
 * POST /api/portal/decompose-task
 * AI-decomposes a task into ordered, time-estimated subtasks.
 * Input: { taskName, context? }
 * Output: { ok, steps: [{name, emoji, durationMin}] }
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export interface DecomposeStep {
  name: string;
  emoji: string;
  durationMin: number;
}

function fallbackSteps(taskName: string): DecomposeStep[] {
  return [
    { name: `准备开始：${taskName}`, emoji: '📋', durationMin: 2 },
    { name: '执行主要步骤', emoji: '⚡', durationMin: 10 },
    { name: '完成收尾', emoji: '✅', durationMin: 2 },
  ];
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { taskName?: string; context?: string };
  const taskName = (body.taskName || '').trim();
  if (!taskName) return NextResponse.json({ ok: false, error: 'taskName required' }, { status: 400 });

  const apiKey = envValue('GEMINI_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ ok: true, steps: fallbackSteps(taskName) });
  }

  const prompt = `你是一个任务规划助手。把下面这个任务拆解成 3-6 个清晰的执行步骤，每步给出一个合适的 emoji 和预计耗时（分钟）。

任务：${taskName}${body.context ? `\n背景：${body.context}` : ''}

请用 JSON 数组回复，格式如下（只输出 JSON，不要解释）：
[
  {"name": "步骤名称", "emoji": "🔧", "durationMin": 5},
  ...
]

要求：
- 步骤名称简洁（10字以内）
- emoji 要贴合步骤内容
- 时间要现实合理
- 用中文`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }),
    });
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const steps = JSON.parse(match[0]) as DecomposeStep[];
      if (Array.isArray(steps) && steps.length > 0) {
        return NextResponse.json({ ok: true, steps: steps.slice(0, 6) });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ ok: true, steps: fallbackSteps(taskName) });
}
