/**
 * POST /api/portal/avatarify — 照片 → app 主题色卡通头像(批次 95)。
 *
 * 用户点名:上传照片,AI 生成与 app 蓝青主题协调的卡通贴纸形象,预览接受
 * 后设为头像。图像生成走「会出图」的模型:Gemini 图像模型(免费层优先),
 * OpenAI gpt-image-1 兜底。都要有效 key —— 无 key/失败诚实报错,绝不假装。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { resolveAiKey } from '@/lib/portal/ai-keys';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// app 主题化提示词:蓝青柔和贴纸风,保留人物特征与表情
const STYLE_PROMPT =
  'Turn this portrait into a friendly cartoon avatar sticker. Soft rounded illustration, clean bold line art, ' +
  'warm gentle smile. Pastel blue and teal color palette matching a calm, minimal app theme. White sticker outline. ' +
  'Simple decorative background with a few soft stars, tiny flowers and light clouds in the same blue-teal palette. ' +
  "Keep the person's hairstyle, face shape and expression clearly recognizable. Head-and-shoulders framing. No text.";

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/** Gemini 图像生成(image-to-image):返回 dataURL 或 null。 */
async function geminiAvatar(key: string, imageBase64: string, mimeType: string): Promise<string | null> {
  const models = [
    envValue('GEMINI_IMAGE_MODEL'),
    'gemini-2.5-flash-image',
    'gemini-2.0-flash-preview-image-generation',
  ].filter(Boolean) as string[];

  for (const model of models) {
    const { signal, done } = withTimeout(40_000);
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
              { text: STYLE_PROMPT },
            ],
          }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
        signal,
      });
      done();
      if (!res.ok) continue;
      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }>;
      };
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        const inline = p.inlineData || p.inline_data;
        const d = inline?.data;
        const mt = (inline as { mimeType?: string; mime_type?: string })?.mimeType || (inline as { mime_type?: string })?.mime_type || 'image/png';
        if (d) return `data:${mt};base64,${d}`;
      }
    } catch {
      done();
    }
  }
  return null;
}

/** OpenAI gpt-image-1 编辑(输入图 → 风格化):返回 dataURL 或 null。 */
async function openaiAvatar(key: string, imageBase64: string, mimeType: string): Promise<string | null> {
  const { signal, done } = withTimeout(40_000);
  try {
    const form = new FormData();
    const bytes = Buffer.from(imageBase64, 'base64');
    form.append('image', new Blob([bytes], { type: mimeType || 'image/png' }), 'input.png');
    form.append('model', 'gpt-image-1');
    form.append('prompt', STYLE_PROMPT);
    form.append('size', '1024x1024');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    done();
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch {
    done();
    return null;
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'avatarify', { limit: 10 });
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { imageBase64?: string; mimeType?: string };
  if (!body.imageBase64) {
    return NextResponse.json({ ok: false, error: 'no_image' }, { status: 400 });
  }

  const geminiKey = resolveAiKey('gemini');
  const openaiKey = resolveAiKey('openai');
  if (!geminiKey && !openaiKey) {
    return NextResponse.json(
      { ok: false, error: 'no_image_model', message: '还没有可用的图像生成配置。在 Vercel 配好 Gemini 或 OpenAI 图像 key 后即可生成卡通头像。' },
      { status: 503 },
    );
  }

  // Gemini 免费层优先(用户侧成本低),失败落 OpenAI gpt-image-1
  let dataUrl: string | null = null;
  if (geminiKey) dataUrl = await geminiAvatar(geminiKey, body.imageBase64, body.mimeType || 'image/jpeg');
  if (!dataUrl && openaiKey) dataUrl = await openaiAvatar(openaiKey, body.imageBase64, body.mimeType || 'image/jpeg');

  if (!dataUrl) {
    return NextResponse.json(
      { ok: false, error: 'generate_failed', message: '这次没生成成功(模型忙或配额限制),过一会儿再试一次。' },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, dataUrl });
}
