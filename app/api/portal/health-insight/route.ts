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
import {
  buildHealthInsightPrompt,
  fallbackHealthInsight,
  type HealthInsightInput,
} from '@/lib/portal/health-insight-prompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json() as { content?: Array<{ type: string; text?: string }>; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  const text = (data.content ?? []).find((c) => c.type === 'text')?.text?.trim() ?? '';
  if (!text) throw new Error('empty');
  return text;
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 600 } }),
    },
  );
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!text) throw new Error('empty');
  return text;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'health_insight', { limit: 10 });
  if (guard) return guard;

  const body = await req.json() as Partial<HealthInsightInput>;
  const input: HealthInsightInput = {
    locale: body.locale === 'en' ? 'en' : 'zh',
    relationships: Array.isArray(body.relationships) ? body.relationships.slice(0, 12) : [],
    summary: body.summary && typeof body.summary === 'object' ? body.summary : {},
    findings: Array.isArray(body.findings) ? body.findings.slice(0, 16) : [],
  };

  const prompt = buildHealthInsightPrompt(input);
  const claudeKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  const geminiKey = envValue('GEMINI_API_KEY');

  if (claudeKey) {
    try { return NextResponse.json({ ok: true, text: await callClaude(claudeKey, prompt), source: 'ai' }); }
    catch (err) { console.error('[health-insight] Claude error:', err instanceof Error ? err.message : err); }
  }
  if (geminiKey) {
    try { return NextResponse.json({ ok: true, text: await callGemini(geminiKey, prompt), source: 'ai' }); }
    catch (err) { console.error('[health-insight] Gemini error:', err instanceof Error ? err.message : err); }
  }

  // 无 key 或都失败 → 确定性兜底(按钮始终有产出,不静默失败)。
  return NextResponse.json({ ok: true, text: fallbackHealthInsight(input), source: 'fallback' });
}
