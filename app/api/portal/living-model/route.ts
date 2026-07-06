/**
 * POST /api/portal/living-model
 *
 * Generates the 7-layer Living Cognitive Model — AI's world model of the user.
 * Uses Claude Sonnet (not Haiku) because this requires deep reasoning from
 * sparse behavioral evidence, not just language rewriting.
 *
 * Design principles:
 * - Behavioral inference > self-declaration (Oura Advisor / AI Identity Framework)
 * - Each insight must include confidence + evidenceRefs (traceable)
 * - Blind Spots only if confidence >= 90
 * - Previous insights + user corrections are injected into prompt for continuity
 * - Falls back gracefully if no API key
 */
import { NextRequest, NextResponse } from 'next/server';
import type { LivingModelLayer, LivingModelLayerId } from '@/lib/platform/living-model';
import { LAYER_META } from '@/lib/platform/living-model';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface LivingModelRequest {
  nodeCount: number;
  typeBreakdown: Record<string, number>;
  topDomains: Array<{ domain: string; count: number }>;
  recentSample: string[];
  completionRate: number;
  topHour: number;
  feedbackCount: number;
  dominantDomains: string[];
  previousInsights: Array<{ layerId: string; content: string; verified: boolean | null }>;
  userName?: string;
  perspectiveId?: string;
  perspectiveName?: string;
  perspectivePrompt?: string;
}

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function buildFallbackModel(): LivingModelLayer[] {
  const layerIds: LivingModelLayerId[] = ['identity', 'motivation', 'principles', 'patterns', 'blind_spots', 'evolution', 'prediction'];
  return layerIds.map((id, i) => ({
    id,
    label: LAYER_META[id].label,
    icon: LAYER_META[id].icon,
    insights: [],
    minConfidenceToShow: LAYER_META[id].minConfidence,
  }));
}

async function generateWithClaude(apiKey: string, body: LivingModelRequest): Promise<LivingModelLayer[]> {
  const typeStr = Object.entries(body.typeBreakdown)
    .map(([t, c]) => `${t}:${c}`)
    .join(', ');
  const domainStr = body.topDomains.slice(0, 6).map((d) => `${d.domain}(${d.count})`).join('、');
  const sampleStr = body.recentSample.slice(0, 20).join('、');
  const dominantStr = body.dominantDomains.join('、') || '暂无明显偏好';
  const prevStr = body.previousInsights.length > 0
    ? body.previousInsights.map((p) => `[${p.layerId}] ${p.content}${p.verified === false ? '（用户否定）' : p.verified === true ? '（用户确认）' : ''}`).join('\n')
    : '无历史洞察';

  const perspectiveSection = body.perspectivePrompt
    ? `\n\n## 当前分析视角\n你需要从"${body.perspectiveName}"的视角进行分析：${body.perspectivePrompt}\n请用这个框架来解读下方的行为数据，生成的洞察要体现该视角的独特切入点。`
    : '';

  const prompt = `你是 Nesio，一个深度了解用户的个人 AI 助手。请基于以下行为数据，推断用户的认知模型。${perspectiveSection}

## 用户行为数据
- 总记录数：${body.nodeCount} 条
- 类型分布：${typeStr}
- 最活跃领域：${domainStr}
- 最近记录样本：${sampleStr || '暂无'}
- 承诺完成率：${body.completionRate}%
- 最活跃时段：${body.topHour}点前后
- 交互反馈次数：${body.feedbackCount}
- 偏好领域：${dominantStr}

## 历史洞察（上次生成，请参考并演化）
${prevStr}

## 任务
根据以上行为数据，生成用户的认知模型。每层输出 1-2 条洞察。

**重要约束：**
1. 结论必须来自行为证据，不是自我声明推断
2. confidence 反映证据充分程度（样本少→低；一致性高→高）
3. blind_spots 只在 confidence >= 90 时出现（发现的反而是好事）
4. evolution 层描述3个月内的变化 delta（如无历史数据，可说"刚开始了解"）
5. prediction 层附 reason 说明预测依据
6. 每条 evidenceRefs 写 1-3 个具体行为描述，让用户能理解为什么

## 输出格式（严格 JSON）
{
  "identity": [{"content":"...","confidence":75,"evidenceRefs":["..."],"evidenceCount":8}],
  "motivation": [...],
  "principles": [...],
  "patterns": [...],
  "blind_spots": [...],
  "evolution": [...],
  "prediction": [{"content":"...","confidence":68,"evidenceRefs":["..."],"evidenceCount":5}]
}

只输出 JSON，不加解释。如果某层证据不足，返回空数组 []。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}`);

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);

  const raw = (data.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in response');

  const parsed = JSON.parse(match[0]) as Record<string, Array<{
    content: string;
    confidence: number;
    evidenceRefs: string[];
    evidenceCount: number;
  }>>;

  const layerIds: LivingModelLayerId[] = ['identity', 'motivation', 'principles', 'patterns', 'blind_spots', 'evolution', 'prediction'];
  const now = new Date().toISOString();

  return layerIds.map((id) => {
    const raw = parsed[id] ?? [];
    const meta = LAYER_META[id];
    return {
      id,
      label: meta.label,
      icon: meta.icon,
      minConfidenceToShow: meta.minConfidence,
      insights: raw
        .filter((ins) => ins.confidence >= (id === 'blind_spots' ? 90 : 50))
        .map((ins, i) => ({
          id: `${id}-${i}-${Date.now()}`,
          content: ins.content,
          confidence: Math.min(100, Math.max(0, ins.confidence)),
          evidenceRefs: Array.isArray(ins.evidenceRefs) ? ins.evidenceRefs.slice(0, 3) : [],
          evidenceCount: ins.evidenceCount ?? ins.evidenceRefs?.length ?? 0,
          lastUpdatedAt: now,
          userVerified: null,
        })),
    };
  });
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'living_model', { limit: 10 });
  if (guard) return guard;

  const body = await req.json() as LivingModelRequest;

  const fallback = buildFallbackModel();

  // 至少 10 条记录才生成认知模型 —— 与客户端空态"已记录 N/10 条,记满后开始推断"一致;
  // 此前 <3 就生成 7 层带置信度画像,3-4 条杂项的新用户会拿到一份看似笃定却是编造的模型。
  if (body.nodeCount < 10) {
    return NextResponse.json({ ok: true, layers: fallback, reason: 'insufficient_data' });
  }

  const apiKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ ok: true, layers: fallback, reason: 'no_api_key' });
  }

  try {
    const layers = await generateWithClaude(apiKey, body);
    return NextResponse.json({ ok: true, layers });
  } catch (err) {
    console.error('[living-model] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, layers: fallback, reason: 'api_error' });
  }
}
