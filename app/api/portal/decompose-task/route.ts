/**
 * POST /api/portal/decompose-task
 * HTTP adapter for the Momentum Engine (lib/platform/momentum-engine).
 * Input:  { taskName, context?, drill?, previousAction?, completedActions? }
 * Output: { ok, steps: [{name, emoji, durationMin}] }
 * Primary: Claude Haiku. Fallback: Gemini 2.0 Flash.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  buildMomentumPrompt,
  fallbackMomentumSteps,
  extractStepsFromText,
  type MomentumParams,
  type MomentumStep,
} from '@/lib/platform/momentum-engine';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

async function callClaude(apiKey: string, p: MomentumParams): Promise<MomentumStep[]> {
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
      messages: [{ role: 'user', content: buildMomentumPrompt(p) }],
    }),
  });
  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  const text = (data.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  const steps = extractStepsFromText(text);
  if (!steps) throw new Error('no JSON');
  return steps;
}

async function callGemini(apiKey: string, p: MomentumParams): Promise<MomentumStep[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildMomentumPrompt(p) }] }],
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
  const steps = extractStepsFromText(text);
  if (!steps) throw new Error('no JSON');
  return steps;
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
  if (!taskName) {
    return NextResponse.json({ ok: false, error: 'taskName required' }, { status: 400 });
  }

  const p: MomentumParams = {
    taskName,
    context: body.context,
    drill: body.drill ?? false,
    previousAction: body.previousAction,
    completedActions: body.completedActions,
  };

  const claudeKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  const geminiKey = envValue('GEMINI_API_KEY');

  if (!claudeKey && !geminiKey) {
    return NextResponse.json({ ok: true, steps: fallbackMomentumSteps(taskName, p.drill ?? false) });
  }

  if (claudeKey) {
    try {
      const steps = await callClaude(claudeKey, p);
      if (steps.length > 0) return NextResponse.json({ ok: true, steps });
    } catch (err) {
      console.error('[momentum] Claude error:', err instanceof Error ? err.message : err);
    }
  }

  if (geminiKey) {
    try {
      const steps = await callGemini(geminiKey, p);
      if (steps.length > 0) return NextResponse.json({ ok: true, steps });
    } catch (err) {
      console.error('[momentum] Gemini error:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, steps: fallbackMomentumSteps(taskName, p.drill ?? false) });
}
