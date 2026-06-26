/**
 * POST /api/portal/daily-brief
 * Generates a conversational podcast-style daily briefing script.
 * Covers: weather, calendar events, email highlights, Life Graph context.
 * Returns: { script: string, segments: Segment[] }
 * Each segment can be TTS'd independently for a natural conversational flow.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export interface BriefSegment {
  id: string;
  type: 'greeting' | 'weather' | 'calendar' | 'email' | 'memory' | 'closing';
  text: string;
  voice: 'nova' | 'alloy' | 'echo';
  emoji: string;
}

interface BriefRequest {
  displayName: string;
  weather?: { temperatureC?: number; condition?: string; forecastNote?: string; placeLabel?: string };
  events?: Array<{ title: string; start: string; location?: string }>;
  emailHighlights?: string[];
  memoryNotes?: string[];
  locale?: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as BriefRequest;
  const { displayName, weather, events, emailHighlights, memoryNotes } = body;
  const now = new Date();
  const hour = now.getHours();
  const timeGreeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');

  // Build context
  const weatherText = weather
    ? `当前天气：${weather.temperatureC}°C，${weather.condition}${weather.forecastNote ? '，' + weather.forecastNote : ''}，地点：${weather.placeLabel || '当前位置'}`
    : '暂无天气数据';

  const eventsText = events?.length
    ? events.slice(0, 3).map((e) => {
        const t = new Date(e.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `${t} ${e.title}${e.location ? '（' + e.location + '）' : ''}`;
      }).join('；')
    : '今天没有日历安排';

  const emailText = emailHighlights?.length
    ? emailHighlights.slice(0, 3).join('；')
    : '没有需要关注的邮件';

  const memoryText = memoryNotes?.length
    ? memoryNotes.slice(0, 2).join('；')
    : '';

  if (!geminiKey) {
    // Fallback: template-based script
    const segments: BriefSegment[] = [
      { id: 'greeting', type: 'greeting' as const, voice: 'nova' as const, emoji: '👋',
        text: `${timeGreeting}，${displayName}。今天是${dateStr}。` },
      { id: 'weather', type: 'weather' as const, voice: 'nova' as const, emoji: '🌤',
        text: weather ? `当前气温${weather.temperatureC}度，${weather.condition}。${weather.forecastNote ? weather.forecastNote + '，注意' + (weather.temperatureC! < 15 ? '保暖' : '防晒') + '。' : ''}` : '天气数据加载中。' },
      { id: 'calendar', type: 'calendar' as const, voice: 'nova' as const, emoji: '📅',
        text: events?.length ? `今天你有${events.length}个安排：${eventsText}。` : '今天日历没有特别安排，可以专注深度工作。' },
      { id: 'closing', type: 'closing' as const, voice: 'nova' as const, emoji: '✨',
        text: '今天也是好好的一天。有任何事情，告诉我。' },
    ];
    return NextResponse.json({ ok: true, segments, script: segments.map((s) => s.text).join(' ') });
  }

  const prompt = `你是 Nesio，一个私人 AI 助理。你要生成一段温暖、自然的播客风格日报，像一个熟悉用户的私人助理在跟用户讲话。

用户信息：
- 姓名：${displayName}
- 当前时间：${dateStr} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
- 天气：${weatherText}
- 今日日程：${eventsText}
- 邮件摘要：${emailText}
${memoryText ? '- 记忆提示：' + memoryText : ''}

要求：
1. 语气：温暖、简洁、像真人在说话，不用"您"，用"你"，不生硬
2. 长度：每段 1-2 句，总共不超过 150 字
3. 自然地融合信息，不要机械列举
4. 如果天气有变化，用一句话说清楚并给出建议
5. 如果有会议，说最重要的一个，其余带过
6. 结尾一句暖心的话

输出 JSON 数组，每个元素：
{
  "id": "greeting|weather|calendar|email|memory|closing",
  "type": "greeting|weather|calendar|email|memory|closing",
  "text": "这段的说话内容",
  "voice": "nova",
  "emoji": "对应 emoji"
}

只输出 JSON 数组，不要其他文字。`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();
    const segments = JSON.parse(jsonStr) as BriefSegment[];
    const script = segments.map((s) => s.text).join(' ');
    return NextResponse.json({ ok: true, segments, script });
  } catch {
    // Fallback
    const segments: BriefSegment[] = [
      { id: 'greeting', type: 'greeting' as const, voice: 'nova' as const, emoji: '👋',
        text: `${timeGreeting}，${displayName}。今天是${dateStr}。` },
      { id: 'weather', type: 'weather' as const, voice: 'nova' as const, emoji: '🌤',
        text: weather ? `气温${weather.temperatureC}度，${weather.condition}。` : '' },
      { id: 'calendar', type: 'calendar' as const, voice: 'nova' as const, emoji: '📅',
        text: events?.length ? `今天有${events.length}个安排，最重要的是${events[0].title}。` : '今天没有特别安排。' },
      { id: 'closing', type: 'closing' as const, voice: 'nova' as const, emoji: '✨',
        text: '有任何事情，告诉我。' },
    ].filter((s) => s.text);
    return NextResponse.json({ ok: true, segments, script: segments.map((s) => s.text).join(' ') });
  }
}
