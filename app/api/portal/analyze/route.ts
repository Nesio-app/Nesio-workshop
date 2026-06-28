/**
 * /api/portal/analyze
 * Unified AI analysis endpoint for Tell Nesio captures.
 * Accepts: { type: 'image' | 'text' | 'file', content: string, mimeType?: string }
 * Returns: { nodes: LifeNodeInput[], summary: string, intent: string }
 */

import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function getAnthropicKey(): string | undefined {
  return (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)?.trim();
}

function getGeminiKey(): string | undefined {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)?.trim();
}

function envValue(key: string): string {
  return (process.env[key] || '').trim();
}

function isAnalyzeAiAllowed(req: NextRequest): boolean {
  const stage5Secret = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const providedStage5Secret = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  if (stage5Secret && providedStage5Secret === stage5Secret) return true;

  const hasSignedInCookie = Boolean(req.cookies.get('baohe_auth_access')?.value);
  if (hasSignedInCookie) return true;

  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  const labEnabled = envValue('BAOHE_PERSONAL_LAB_AI_ENABLED').toLowerCase() === 'true';
  return labEnabled && accessMode === 'personal_lab';
}

const SYSTEM_PROMPT = `You are Nesio's Life Graph extractor. Given user input (text, image description, or document), extract structured life memory nodes.

For each piece of information, return a JSON array of nodes. Each node:
{
  "type": "person" | "object" | "place" | "event" | "commitment" | "health_state" | "preference",
  "name": "concise name",
  "attributes": { "key": "value" },
  "relations": [{ "targetId": "name or id", "relation": "relation type" }],
  "tags": ["tag1", "tag2"],
  "confidence": 0.0-1.0,
  "rawInput": "original text"
}

Also return:
- "summary": one sentence summary of what was captured
- "intent": "MEMORY_CAPTURE" | "REMINDER" | "COMMITMENT" | "HEALTH_LOG" | "EVENT_LOG" | "PREFERENCE"

Respond ONLY with valid JSON: { "nodes": [...], "summary": "...", "intent": "..." }
If input is in Chinese, extract Chinese names and keep attributes in Chinese.
`;

async function analyzeWithClaude(content: string, isImage: boolean, imageBase64?: string, mimeType?: string): Promise<string> {
  const key = getAnthropicKey();
  if (!key) throw new Error('no_anthropic_key');

  const messages: unknown[] = [];

  if (isImage && imageBase64) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 },
        },
        { type: 'text', text: `Analyze this image and extract life memory nodes. ${content || ''}` },
      ],
    });
  } else {
    messages.push({ role: 'user', content });
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      system: SYSTEM_PROMPT,
      messages,
      max_tokens: 1024,
    }),
  });

  const data = await res.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(data?.error?.message || `Claude ${res.status}`);
  return data.content?.map((c) => c.text).join('') || '';
}

async function analyzeWithGemini(content: string, imageBase64?: string, mimeType?: string): Promise<string> {
  const key = getGeminiKey();
  if (!key) throw new Error('no_gemini_key');

  const parts: unknown[] = [];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } });
  }
  parts.push({ text: `${SYSTEM_PROMPT}\n\nUser input: ${content}` });

  const res = await fetch(`${GEMINI_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

/** Rule-based fallback when no AI key is available */
function analyzeFallback(content: string): string {
  const lower = content.toLowerCase();
  const nodes: object[] = [];

  // Object detection
  const objectMatch = content.match(/(?:记住|记得)?\s*(.+?)(?:在|放在|存在|位于)\s*(.+?)(?:里|中|$)/);
  if (objectMatch) {
    nodes.push({
      type: 'object',
      name: objectMatch[1].trim(),
      attributes: { location: objectMatch[2].trim() },
      relations: [],
      tags: ['手动记录'],
      confidence: 0.82,
      rawInput: content,
    });
  }

  // Person
  const personMatch = content.match(/([A-Z一-龥]{1,4})(?:的|的生日|的礼物)/);
  if (personMatch && nodes.length === 0) {
    nodes.push({
      type: 'person',
      name: personMatch[1],
      attributes: {},
      relations: [],
      tags: ['手动记录'],
      confidence: 0.75,
      rawInput: content,
    });
  }

  // Commitment
  if (lower.includes('提醒') || lower.includes('别忘') || lower.includes('记得')) {
    nodes.push({
      type: 'commitment',
      name: content.slice(0, 25),
      attributes: { detail: content },
      relations: [],
      tags: ['提醒'],
      confidence: 0.78,
      rawInput: content,
    });
  }

  // Health
  if (lower.includes('感冒') || lower.includes('发烧') || lower.includes('嗓子') || lower.includes('头疼') || lower.includes('不舒服')) {
    nodes.push({
      type: 'health_state',
      name: content.slice(0, 20),
      attributes: { status: 'recovering', detail: content },
      relations: [],
      tags: ['健康'],
      confidence: 0.8,
      rawInput: content,
    });
  }

  if (nodes.length === 0) {
    nodes.push({
      type: 'object',
      name: content.slice(0, 30),
      attributes: { note: content },
      relations: [],
      tags: ['记录'],
      confidence: 0.6,
      rawInput: content,
    });
  }

  const intent = lower.includes('提醒') ? 'REMINDER'
    : lower.includes('感冒') || lower.includes('嗓子') ? 'HEALTH_LOG'
    : 'MEMORY_CAPTURE';

  return JSON.stringify({ nodes, summary: `已记录：${content.slice(0, 30)}`, intent });
}

function extractJson(raw: string): string {
  // Strip markdown code fences if present
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  return match?.[1]?.trim() || raw.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      type: 'text' | 'image' | 'file';
      content: string;
      imageBase64?: string;
      mimeType?: string;
    };

    let raw = '';
    const isImage = body.type === 'image' && Boolean(body.imageBase64);
    const aiAllowed = isAnalyzeAiAllowed(req);

    if (aiAllowed) {
      try {
        raw = await analyzeWithClaude(body.content, isImage, body.imageBase64, body.mimeType);
      } catch {
        try {
          raw = await analyzeWithGemini(body.content, body.imageBase64, body.mimeType);
        } catch {
          raw = analyzeFallback(body.content);
        }
      }
    } else if (isImage) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ai_auth_required',
          summary: '登录或 Lab 模式后可自动识别图片。现在可以先保存为待确认图片线索。',
        },
        { status: 403 },
      );
    } else {
      raw = analyzeFallback(body.content);
    }

    const json = extractJson(raw);
    const result = JSON.parse(json) as { nodes: object[]; summary: string; intent: string };

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'parse_error';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-baohe-access-mode, x-nesio-stage5-secret',
    },
  });
}
