/**
 * POST /api/portal/daily-brief
 * Generates a podcast-host style daily briefing script (60-90 sec).
 * Returns: { ok: true, script: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { reportAiCall } from '@/lib/portal/ai-telemetry';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface BriefRequest {
  /** 设置→偏好→语气(warm/direct/minimal),同样作用于简报口吻 */
  coachStyle?: string;
  uiLocale?: string;
  displayName: string;
  weather?: { temperatureC?: number; condition?: string; forecastNote?: string; placeLabel?: string };
  /** Reverse-geocoded city label from the device, e.g. "Cary, NC" */
  location?: string;
  events?: Array<{ title: string; start: string; end?: string; location?: string; calendarName?: string }>;
  emailHighlights?: string[];
  memoryNotes?: string[];
  locale?: string;
}

// Keep exporting BriefSegment for any legacy consumers
export interface BriefSegment {
  id: string;
  type: 'greeting' | 'weather' | 'calendar' | 'email' | 'memory' | 'closing';
  text: string;
  voice: 'nova' | 'alloy' | 'echo';
  emoji: string;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'daily_brief', { limit: 15 });
  if (guard) return guard;

  const body = await req.json() as BriefRequest;
  const { displayName, weather, location, events, emailHighlights, memoryNotes } = body;

  const now = new Date();
  const hour = now.getHours();
  const timeGreeting = hour < 5 ? '凌晨好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');

  // ── Build context sections ──────────────────────────────────────────────────

  const placeLabel = location || weather?.placeLabel || '';
  const weatherText = weather
    ? `${weather.temperatureC}°C，${weather.condition}${weather.forecastNote ? '，' + weather.forecastNote : ''}${placeLabel ? '（' + placeLabel + '）' : ''}`
    : null;

  const todayEvents = (events || []).filter((e) => {
    const t = new Date(e.start).getTime();
    const dayEnd = new Date(now).setHours(23, 59, 59, 999);
    return t >= now.getTime() - 30 * 60_000 && t <= dayEnd;
  });
  const upcomingEvents = (events || []).filter((e) => {
    const t = new Date(e.start).getTime();
    const dayEnd = new Date(now).setHours(23, 59, 59, 999);
    return t > dayEnd;
  }).slice(0, 3);

  type EventItem = NonNullable<BriefRequest['events']>[0];
  const fmtEvent = (e: EventItem) => {
    const t = new Date(e.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `${t} ${e.title}${e.location ? '（' + e.location + '）' : ''}`;
  };

  // ── Fallback script (no Gemini) ─────────────────────────────────────────────

  function buildFallbackScript(): string {
    const parts: string[] = [`${timeGreeting}，${displayName || '你'}。今天是${dateStr}，现在${timeStr}。`];

    if (weatherText) {
      parts.push(`今天${weatherText}。${weather?.forecastNote ? '' : (weather?.temperatureC ?? 20) < 15 ? '记得多穿一件。' : ''}`);
    }

    if (todayEvents.length > 0) {
      if (todayEvents.length === 1) {
        parts.push(`今天有一个安排：${fmtEvent(todayEvents[0])}。`);
      } else {
        parts.push(`今天有${todayEvents.length}个安排。最近的是${fmtEvent(todayEvents[0])}，还有${todayEvents.slice(1).map((e) => e.title).join('、')}。`);
      }
    } else if (upcomingEvents.length > 0) {
      parts.push(`今天日历上没有安排，下一个是${fmtEvent(upcomingEvents[0])}。`);
    } else {
      parts.push('今天没有特别的日历安排，可以专注深度工作。');
    }

    if (emailHighlights?.length) {
      parts.push(`邮件方面，${emailHighlights.slice(0, 2).join('；另外，')}。`);
    }

    if (memoryNotes?.length) {
      parts.push(`另外，${memoryNotes[0]}。`);
    }

    parts.push('今天也是好好的一天，有任何事情告诉我。');
    return parts.join(' ');
  }

  if (!geminiKey) {
    const script = buildFallbackScript();
    return NextResponse.json({ ok: true, script });
  }

  // ── Gemini: podcast-host style script ──────────────────────────────────────

  const calendarSection = todayEvents.length > 0
    ? `今日日程（${todayEvents.length}个）：\n${todayEvents.map(fmtEvent).join('\n')}`
    : upcomingEvents.length > 0
      ? `今天无日程，即将到来：\n${upcomingEvents.map(fmtEvent).join('\n')}`
      : '今天没有日历安排';

  const emailSection = emailHighlights?.length
    ? `邮件摘要：\n${emailHighlights.slice(0, 3).map((h) => `• ${h}`).join('\n')}`
    : '';

  const memorySection = memoryNotes?.length
    ? `记忆提示：\n${memoryNotes.slice(0, 3).map((n) => `• ${n}`).join('\n')}`
    : '';

  const toneLine = ({
    warm: '温暖、自然、像熟悉你的朋友在说话。用"你"，不用"您"',
    direct: '直接、简短、信息密度高，先说结论不绕弯，不用客套话',
    minimal: '极简。只报关键事项，每件事一句话，不加修饰和过渡',
  } as Record<string, string>)[body.coachStyle ?? 'warm'] ?? '温暖、自然、像熟悉你的朋友在说话。用"你"，不用"您"';
  const langLine = body.uiLocale === 'en'
    ? '\n- Deliver the entire briefing in natural spoken English (the user\'s interface language).'
    : '';
  const prompt = `你是 Nesio，用户的私人 AI 助理。现在用播客主持人的口吻，给用户播报今天的早/晚间简报。${langLine}

【用户信息】
姓名：${displayName || '你'}
当前时间：${dateStr} ${timeStr}
${location ? `所在位置：${location}` : ''}
${weatherText ? `天气：${weatherText}` : ''}
${calendarSection}
${emailSection}
${memorySection}

【播报要求】
- 语气：${toneLine}
- 长度：纯文字 120-180 字，适合朗读 40-60 秒
- 结构：开场问候 → 天气一句（如有）→ 最重要的 1-2 个日程细说 → 邮件/记忆亮点（如有） → 一句暖心收尾
- 注意：如果没有日程，用积极的方式说"今天是自由时间"；不要机械列举，要自然串联
- 输出：直接输出说话的文字，不要任何标题、括号、标注

直接开始说，不要说"好的"或"以下是"。`;

  const startedAt = Date.now();
  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 400 },
      }),
    });
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const script = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || '';
    if (script) {
      reportAiCall('daily_brief', true, startedAt);
      return NextResponse.json({ ok: true, script });
    }
  } catch { /* fall through */ }

  reportAiCall('daily_brief', false, startedAt, { fallback: true });
  return NextResponse.json({ ok: true, script: buildFallbackScript() });
}
