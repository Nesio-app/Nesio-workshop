/**
 * POST /api/portal/wardrobe-tryon — C｜上身试穿预览(Pro 云、虚拟试穿)。
 * 输入:用户一张全身照 + 这套搭配各单品的照片,用会出图的多图模型
 * (Gemini 2.5 Flash Image / Nano Banana)合成「同一个人穿上这套」的照片。
 * 保留人物脸/身形/姿态,把衣服自然地穿上。
 *
 * 分层:付费/云(guardAiRoute + requirePaidCloudAi)。无图像 key / 失败诚实报错,绝不假装。
 * 隐私:全身照只在用户点「试穿」时随请求发送生成,服务端不落库(对标 avatarify)。
 * 复用 avatarify 的 Gemini 出图基建;多图 = 人物图 + 各衣服图并列送入。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { resolveAiKey } from '@/lib/portal/ai-keys';
import { envValue } from '@/lib/portal/env';
import { reportAiCall } from '@/lib/portal/ai-telemetry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_GARMENTS = 5;

interface ImgPart { base64: string; mime: string }
export interface TryonInput { person: ImgPart | null; garments: ImgPart[] }

const B64_MIN = 100; // 太短肯定不是真图

/** 钳制:人物图必需、衣服图 1..5、都得像样的 base64。不信客户端。 */
export function clampTryonInput(body: unknown): TryonInput {
  const b = (body && typeof body === 'object') ? body as { person?: unknown; garments?: unknown } : {};
  const toPart = (x: unknown): ImgPart | null => {
    if (!x || typeof x !== 'object') return null;
    const o = x as { base64?: unknown; mime?: unknown };
    const base64 = typeof o.base64 === 'string' ? o.base64 : '';
    if (base64.length < B64_MIN || base64.length > 8_000_000) return null;
    const mime = typeof o.mime === 'string' && /^image\/(png|jpe?g|webp)$/.test(o.mime) ? o.mime : 'image/jpeg';
    return { base64, mime };
  };
  const person = toPart(b.person);
  const garments = Array.isArray(b.garments)
    ? b.garments.map(toPart).filter((p): p is ImgPart => p !== null).slice(0, MAX_GARMENTS)
    : [];
  return { person, garments };
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

async function geminiTryon(key: string, input: TryonInput, isEn: boolean): Promise<{ dataUrl?: string; error?: string }> {
  const models = [envValue('GEMINI_IMAGE_MODEL'), 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'].filter(Boolean) as string[];
  const prompt = isEn
    ? 'Virtual try-on. The FIRST image is a photo of a person. Each following image is a clothing item. Generate ONE photorealistic image of the SAME person wearing ALL these clothing items together as a complete outfit. Keep their face, hairstyle, body shape, skin tone and pose recognizable. Fit the garments naturally with realistic folds and lighting. Plain neutral studio background. Full-body framing. No text.'
    : '虚拟试穿。第一张是一个人的照片,后面每张是一件衣服。请生成一张写实照片:同一个人把这些衣服作为一整套穿在身上。保留其脸型、发型、身形、肤色和姿态可辨认,衣服自然贴合、褶皱与光影真实。纯净中性影棚背景,尽量全身构图,不要文字。';
  const errs: string[] = [];
  for (const model of models) {
    const { signal, done } = withTimeout(55_000);
    try {
      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [{ text: prompt }];
      if (input.person) parts.push({ inline_data: { mime_type: input.person.mime, data: input.person.base64 } });
      for (const g of input.garments) parts.push({ inline_data: { mime_type: g.mime, data: g.base64 } });
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
        signal,
      });
      done();
      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }>;
        error?: { message?: string; status?: string };
      };
      if (!res.ok) { errs.push(`${model} ${res.status} ${data.error?.status || ''} ${(data.error?.message || '').slice(0, 60)}`.trim()); continue; }
      const rparts = data.candidates?.[0]?.content?.parts || [];
      for (const p of rparts) {
        const inline = p.inlineData || p.inline_data;
        const d = inline?.data;
        const mt = (inline as { mimeType?: string; mime_type?: string })?.mimeType || (inline as { mime_type?: string })?.mime_type || 'image/png';
        if (d) return { dataUrl: `data:${mt};base64,${d}` };
      }
      errs.push(`${model} 无图像返回`);
    } catch (err) {
      done();
      errs.push(`${model} ${err instanceof Error ? err.name : 'error'}`);
    }
  }
  return { error: errs.join(' · ') || 'gemini_no_image' };
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'wardrobe-tryon', { limit: 10, requirePaidCloudAi: true });
  if (guard) return guard;

  const input = clampTryonInput(await req.json().catch(() => ({})));
  if (!input.person) return NextResponse.json({ ok: false, error: 'no_person', message: '需要一张全身照才能试穿。' }, { status: 400 });
  if (input.garments.length === 0) return NextResponse.json({ ok: false, error: 'no_garments', message: '这套搭配还没有单品照片。' }, { status: 400 });

  // 试穿是多图合成,需要会出图的多图模型(Gemini image)。无 key 诚实报错。
  const geminiKey = resolveAiKey('gemini');
  if (!geminiKey) {
    return NextResponse.json(
      { ok: false, error: 'no_image_model', message: '还没有可用的图像生成配置(试穿需要 Gemini 图像 key)。' },
      { status: 503 },
    );
  }
  const isEn = (() => { try { return String((req.headers.get('accept-language') || '')).toLowerCase().startsWith('en'); } catch { return false; } })();
  const startedAt = Date.now();
  const g = await geminiTryon(geminiKey, input, isEn);
  try { reportAiCall('wardrobe-tryon', Boolean(g.dataUrl), startedAt, { provider: 'gemini', kind: 'image' }); } catch { /* 上账尽力 */ }
  if (!g.dataUrl) {
    const detail = (g.error || '').slice(0, 160);
    console.error('[wardrobe-tryon] generate_failed', detail);
    return NextResponse.json({ ok: false, error: 'generate_failed', message: `这次没生成成功:${detail || '模型忙或配额限制'}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, dataUrl: g.dataUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
