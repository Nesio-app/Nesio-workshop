/**
 * POST /api/portal/meeting-notes
 * Generates structured meeting notes from transcript using Gemini.
 */
import { NextRequest, NextResponse } from 'next/server';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export async function POST(req: NextRequest) {
  const { transcript, duration, calendarEvent } = await req.json() as {
    transcript: string;
    duration: string;
    calendarEvent?: string;
  };

  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey) {
    return NextResponse.json({ ok: false, error: 'no_gemini_key' }, { status: 503 });
  }

  const prompt = `你是一个专业的会议助理。根据以下会议转录内容，生成结构化会议笔记。

会议时长：${duration}
${calendarEvent ? `日历事件：${calendarEvent}` : ''}

转录内容：
${transcript || '（无转录内容）'}

输出 JSON 格式：
{
  "title": "会议标题（从内容推断，或用日历事件名）",
  "date": "${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}",
  "duration": "${duration}",
  "summary": "一句话总结（不超过50字）",
  "keyPoints": ["关键点1", "关键点2", "关键点3"],
  "actions": ["待办1（如有）", "待办2（如有）"],
  "people": ["提到的人名1", "人名2"],
  "linkedEvent": "${calendarEvent || ''}"
}

如果转录内容为空，根据日历事件名生成一个基础模板。
只输出 JSON，不要其他文字。`;

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();

  try {
    const note = JSON.parse(jsonStr);
    return NextResponse.json(note);
  } catch {
    return NextResponse.json({ ok: false, error: 'parse_error' }, { status: 500 });
  }
}
