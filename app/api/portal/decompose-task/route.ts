/**
 * POST /api/portal/decompose-task
 * HTTP adapter for the Momentum Engine (lib/platform/momentum-engine).
 * Input:  { taskName, context?, drill?, previousAction?, completedActions? }
 * Output: { ok, steps: [{name, emoji, durationMin}] }
 * AI 走共享 completeText(Claude→Gemini 多模型兜底);解析不出步骤 → 确定性兜底。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText } from '@/lib/portal/ai-complete';
import {
  buildMomentumPrompt,
  fallbackMomentumSteps,
  extractStepsFromText,
  type MomentumParams,
} from '@/lib/platform/momentum-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'decompose_task', { limit: 20 });
  if (guard) return guard;

  const body = await req.json() as {
    taskName?: string;
    context?: string;
    drill?: boolean;
    previousAction?: string;
    completedActions?: string[];
    locale?: string;
  };
  const taskName = (body.taskName ?? '').trim();
  if (!taskName) {
    return NextResponse.json({ ok: false, error: 'taskName required' }, { status: 400 });
  }

  const p: MomentumParams = {
    // 修实 bug:客户端一直传 locale,路由此前把它丢了 → 英文用户也拿中文步骤
    locale: body.locale,
    taskName,
    context: body.context,
    drill: body.drill ?? false,
    previousAction: body.previousAction,
    completedActions: body.completedActions,
  };

  try {
    const { text } = await completeText({ prompt: buildMomentumPrompt(p), maxTokens: 600, route: 'decompose-task' });
    const steps = extractStepsFromText(text);
    if (steps && steps.length > 0) return NextResponse.json({ ok: true, steps });
  } catch (err) {
    console.error('[momentum] AI error:', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true, steps: fallbackMomentumSteps(taskName, p.drill ?? false, p.locale) });
}
