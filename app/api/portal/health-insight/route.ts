/**
 * POST /api/portal/health-insight
 * 在客户端已算好的确定性关系(mineRelationships)+ 健康概况之上,让 AI 生成人话叙事 + 温和建议。
 * Input:  HealthInsightInput（relationships + summary + locale）
 * Output: { ok, text }
 * Primary: Claude Haiku. Fallback: Gemini 2.0 Flash. 无 key → 确定性兜底文本。
 *
 * 花钱(AI)且碰私有健康数据 → 过 guardAiRoute(见 docs/api-routes.md）。数据围进 <data>,不当指令。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText } from '@/lib/portal/ai-complete';
import {
  buildHealthInsightPrompt,
  fallbackHealthInsight,
  type HealthInsightInput,
} from '@/lib/portal/health-insight-prompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'health_insight', { limit: 10, requirePaidCloudAi: true });
  if (guard) return guard;

  const body = await req.json() as Partial<HealthInsightInput>;
  const input: HealthInsightInput = {
    locale: body.locale === 'en' ? 'en' : 'zh',
    relationships: Array.isArray(body.relationships) ? body.relationships.slice(0, 12) : [],
    summary: body.summary && typeof body.summary === 'object' ? body.summary : {},
    findings: Array.isArray(body.findings) ? body.findings.slice(0, 16) : [],
  };

  const prompt = buildHealthInsightPrompt(input);
  // 共享单发客户端(Claude→Gemini 多模型兜底 + 429 重试 + 统一别名解析),不再各写一遍 fetch。
  try {
    const { text } = await completeText({ prompt, maxTokens: 600 });
    if (text) return NextResponse.json({ ok: true, text, source: 'ai' });
  } catch (err) {
    console.error('[health-insight] AI error:', err instanceof Error ? err.message : err);
  }

  // 无 key 或都失败 → 确定性兜底(按钮始终有产出,不静默失败)。
  return NextResponse.json({ ok: true, text: fallbackHealthInsight(input), source: 'fallback' });
}
