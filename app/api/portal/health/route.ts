/**
 * POST /api/portal/health
 * Accepts Apple Health export XML (or manual data) and extracts health nodes.
 * Apple Health exports as export.xml inside a .zip.
 * We accept the raw XML text and parse key records with Gemini.
 */
import { NextRequest, NextResponse } from 'next/server';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

// Extract key health data from Apple Health XML
function parseHealthXmlSummary(xml: string): string {
  const lines: string[] = [];

  // Steps
  const stepsMatch = xml.match(/type="HKQuantityTypeIdentifierStepCount"[^>]*value="(\d+)"/g);
  if (stepsMatch?.length) {
    const recent = stepsMatch.slice(-7);
    lines.push(`最近步数记录：${recent.map((m) => m.match(/value="(\d+)"/)?.[1] || '0').join(', ')} 步`);
  }

  // Sleep
  const sleepMatch = xml.match(/type="HKCategoryTypeIdentifierSleepAnalysis"[^>]*startDate="([^"]+)"[^>]*endDate="([^"]+)"/g);
  if (sleepMatch?.length) {
    lines.push(`睡眠记录 ${sleepMatch.length} 条（最近一条：${sleepMatch[sleepMatch.length - 1]?.match(/startDate="([^"]+)"/)?.[1] || ''}）`);
  }

  // Heart rate
  const hrMatch = xml.match(/type="HKQuantityTypeIdentifierHeartRate"[^>]*value="([\d.]+)"/g);
  if (hrMatch?.length) {
    const recent = hrMatch.slice(-5).map((m) => m.match(/value="([\d.]+)"/)?.[1] || '0');
    lines.push(`最近心率：${recent.join(', ')} bpm`);
  }

  // Workouts
  const workoutMatch = xml.match(/workoutActivityType="([^"]+)"[^>]*duration="([\d.]+)"/g);
  if (workoutMatch?.length) {
    lines.push(`锻炼记录 ${workoutMatch.length} 条`);
  }

  // Weight
  const weightMatch = xml.match(/type="HKQuantityTypeIdentifierBodyMass"[^>]*value="([\d.]+)"/g);
  if (weightMatch?.length) {
    const last = weightMatch[weightMatch.length - 1]?.match(/value="([\d.]+)"/)?.[1];
    if (last) lines.push(`体重：${last} kg`);
  }

  return lines.join('\n') || xml.slice(0, 3000);
}

async function extractHealthNodes(text: string): Promise<object[]> {
  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey) {
    // Rule-based fallback
    return parseHealthFallback(text);
  }

  const prompt = `从以下 Apple Health 数据中提取健康状态节点，用于 Nesio Life Graph。

输出 JSON 数组：
[{
  "type": "health_state",
  "name": "简短名称（如：每日步数 8500 步）",
  "attributes": { "metric": "步数", "value": "8500", "unit": "步", "date": "日期", "trend": "上升/下降/稳定" },
  "relations": [],
  "tags": ["Apple Health", "步数"],
  "confidence": 0.95,
  "rawInput": "原始数据摘要"
}]

关注：步数、睡眠、心率、体重、锻炼。输出纯 JSON 数组。

健康数据：
${text.slice(0, 4000)}`;

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]';
  const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.trim();

  try { return JSON.parse(jsonStr) as object[]; }
  catch { return parseHealthFallback(text); }
}

function parseHealthFallback(text: string): object[] {
  const nodes: object[] = [];
  const lower = text.toLowerCase();

  if (lower.includes('stepcount') || lower.includes('步数')) {
    nodes.push({ type: 'health_state', name: '步数记录', attributes: { metric: '步数', source: 'Apple Health' }, relations: [], tags: ['Apple Health'], confidence: 0.8, rawInput: text.slice(0, 100) });
  }
  if (lower.includes('sleepanalysis') || lower.includes('睡眠')) {
    nodes.push({ type: 'health_state', name: '睡眠记录', attributes: { metric: '睡眠', source: 'Apple Health' }, relations: [], tags: ['Apple Health', '睡眠'], confidence: 0.8, rawInput: text.slice(0, 100) });
  }
  if (lower.includes('heartrate') || lower.includes('心率')) {
    nodes.push({ type: 'health_state', name: '心率记录', attributes: { metric: '心率', unit: 'bpm', source: 'Apple Health' }, relations: [], tags: ['Apple Health', '心率'], confidence: 0.8, rawInput: text.slice(0, 100) });
  }

  if (!nodes.length) {
    nodes.push({ type: 'health_state', name: '健康数据导入', attributes: { source: 'Apple Health' }, relations: [], tags: ['Apple Health'], confidence: 0.6, rawInput: text.slice(0, 80) });
  }
  return nodes;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let xmlText = '';

    if (contentType.includes('application/json')) {
      const body = await req.json() as { xml?: string; text?: string };
      xmlText = body.xml || body.text || '';
    } else {
      // Raw text body (XML)
      xmlText = await req.text();
    }

    if (!xmlText) {
      return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 });
    }

    // Parse XML summary for efficient AI extraction
    const summary = xmlText.includes('<HealthData') ? parseHealthXmlSummary(xmlText) : xmlText;
    const nodes = await extractHealthNodes(summary);

    return NextResponse.json({ ok: true, nodes, count: nodes.length, summary });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'parse_error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description: 'POST Apple Health export.xml to extract health nodes',
    usage: 'POST /api/portal/health with Content-Type: text/xml and raw export.xml body',
  });
}
