/**
 * POST /api/portal/meeting-notes
 * 从会议转录里抽结构化行动项。批次 154(用户带来的 prompt):
 * 显式指派的 To do(仅在承诺时带截止日、相对今天、按紧急排序)与隐含推断的
 * Inferred(不带截止日)分层;强制可执行 —— 不许放模糊或通用条目。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';

export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'meeting_notes', { limit: 15 });
  if (guard) return guard;

  const { transcript, duration, calendarEvent, meetingDate } = await req.json() as {
    transcript: string;
    duration: string;
    calendarEvent?: string;
    meetingDate?: string; // 批次 155:会议真实日期(ISO);截止日相对它算,不传用今天。
  };

  if (!aiProviderAvailable()) {
    return NextResponse.json({ ok: false, error: 'no_ai_provider' }, { status: 503 });
  }

  // 截止日锚点:优先会议真实日期(Granola 同步的历史会议),缺省用今天(现场录会)。
  const parsedMeetingDate = meetingDate ? new Date(meetingDate) : null;
  const now = parsedMeetingDate && !Number.isNaN(parsedMeetingDate.getTime()) ? parsedMeetingDate : new Date();
  const todayIso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const todayHuman = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  // 用户带来的行动项纪律,收敛成 JSON 输出:显式(To do,承诺才带截止日)/ 推断(Inferred,无日期),
  // 强制可执行、按紧急排序、宁缺毋滥。
  const prompt = `你是专业的会议助理。根据以下会议转录,列出我在这场会议里【被明确指派的行动项】(To do)和【隐含推断的行动项】(Inferred)。

会议基准日期:${todayHuman}(${todayIso})。会上说的「周五前」「下周」等相对时间,一律以这个基准日换算。

规则:
- To do:只放明确指派给我、我需要去做的行动项。仅当会上真的承诺了截止日期时才给 deadline,并把它换算成相对基准日的具体日期(ISO 格式 YYYY-MM-DD);没承诺就留 null。按紧急度从高到低排序。
- Inferred:隐含的、没明说但从上下文合理推断出我该做的事;一律不带截止日期。
- 必须可执行:不要放模糊或通用的条目(例如「跟进一下」「保持沟通」「关注进展」)。每条都要具体到做什么。宁可少,也不要凑数。
- 只从转录里提取,不要虚构没提到的人、事、日期。

会议时长:${duration}
${calendarEvent ? `日历事件:${calendarEvent}` : ''}

转录内容:
${transcript || '(无转录内容)'}

输出 JSON(只输出 JSON,不要任何其他文字):
{
  "title": "会议标题(从内容推断,或用日历事件名)",
  "date": "${todayHuman}",
  "duration": "${duration}",
  "summary": "一句话总结(不超过50字)",
  "todo": [{ "text": "具体行动项", "deadline": "YYYY-MM-DD 或 null" }],
  "inferred": ["具体的隐含行动项"],
  "people": ["提到的人名"]
}

如果转录内容为空或提炼不出任何可执行行动项,todo 和 inferred 返回空数组,不要硬凑。`;

  // 会议 JSON 可能较长,给足 token(避免被 1024 默认截断)。
  const { text: raw } = await completeText({ prompt, maxTokens: 2048, responseFormat: 'json', route: 'meeting_notes' });
  const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();

  try {
    const note = JSON.parse(jsonStr) as Record<string, unknown>;
    // 兜底归一:字段缺失/类型不对时给安全默认,消费端不必再防御。
    const todo = Array.isArray(note.todo)
      ? (note.todo as Array<Record<string, unknown>>)
          .map((t) => ({
            text: String(t?.text ?? '').trim(),
            deadline: typeof t?.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.deadline) ? t.deadline : null,
          }))
          .filter((t) => t.text)
      : [];
    const inferred = Array.isArray(note.inferred)
      ? (note.inferred as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean)
      : [];
    const people = Array.isArray(note.people)
      ? (note.people as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean)
      : [];
    return NextResponse.json({
      ok: true,
      title: String(note.title ?? (calendarEvent || '')),
      date: String(note.date ?? todayHuman),
      duration: String(note.duration ?? duration),
      summary: String(note.summary ?? ''),
      todo,
      inferred,
      people,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'parse_error' }, { status: 500 });
  }
}
