/**
 * POST /api/portal/insights
 * Generates a warm AI narrative ("Nesio 的洞察") from the user's life-graph stats.
 * Input: { period, stats, topDomains, recentNames, feedbackCount }
 * Output: { ok, narrative }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { resolveAiKey } from '@/lib/portal/ai-keys';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface InsightsRequest {
  period: 'week' | 'month' | 'all';
  stats: {
    memoryCount: number;
    completedTasks: number;
    topDomains: Array<{ label: string; count: number }>;
    activeHourLabel?: string;
  };
  recentNames: string[];
  feedbackCount: number;
  displayName?: string;
}

function fallbackNarrative(body: Partial<InsightsRequest>): string {
  const period = body.period === 'week' ? '这周' : body.period === 'month' ? '这个月' : '到目前为止';
  const count = body.stats?.memoryCount ?? 0;
  if (count === 0) return `${period}我还没有看到太多记录。多存一件事，我会越来越懂你。`;
  const top = body.stats?.topDomains?.[0]?.label;
  return `${period}你存了 ${count} 件事${top ? `，最常出现的是「${top}」相关的内容` : ''}。我在慢慢摸清你的节奏。`;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'insights', { limit: 15 });
  if (guard) return guard;

  const body = await req.json() as InsightsRequest;
  const apiKey = resolveAiKey('gemini');

  if (!apiKey) {
    return NextResponse.json({ ok: true, narrative: fallbackNarrative(body) });
  }

  const { period, stats, recentNames, feedbackCount, displayName } = body;
  const periodLabel = period === 'week' ? '这周' : period === 'month' ? '这个月' : '到目前为止';
  const nameStr = displayName ? `用户叫 ${displayName}，` : '';
  const domainStr = stats.topDomains.slice(0, 3).map((d) => `${d.label}(${d.count}条)`).join('、');
  const sampleStr = recentNames.slice(0, 4).join('、');

  const prompt = `你是 Nesio，一个温暖的个人助手。${nameStr}请用第一人称（"我注意到…"）写一段 2-3 句的中文洞察，描述你对用户${periodLabel}的观察和理解。

数据：
- ${periodLabel}新增了 ${stats.memoryCount} 条记忆
- 完成了 ${stats.completedTasks} 件承诺/任务
- 最活跃的领域：${domainStr || '暂无'}
- 部分内容：${sampleStr || '暂无'}
- 历史互动次数：${feedbackCount}

要求：
- 口吻温暖、像老朋友而非报告
- 不要列数字清单，用叙述句
- 结尾可以说一句鼓励或小发现
- 50字以内
- 只输出这段话，不加引号`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
      }),
    });
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (text) return NextResponse.json({ ok: true, narrative: text });
  } catch { /* fall through */ }

  return NextResponse.json({ ok: true, narrative: fallbackNarrative(body) });
}
