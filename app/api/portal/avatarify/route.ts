/**
 * POST /api/portal/avatarify — 照片 → 重绘一张图。两种风格:
 *   · style='avatar'(默认,批次 95):app 主题色卡通头像贴纸;
 *   · style='garment'(2026-07-28,用户标注 PDF2 图16「AI 识别可以直接美化衣服,
 *     变为白色背景干净图」):把衣服照片洗成白底干净的单品图。
 *
 * 只加了个 style 参数、没另起一条路由 —— 鉴权 / 付费门 / 限流 / key 解析 / 双模型兜底 /
 * 成本上账这一整套都能直接复用,少一个要维护的花钱入口。
 * 图像生成走「会出图」的模型:Gemini 图像模型(免费层优先),OpenAI gpt-image-1 兜底。
 * 都要有效 key —— 无 key/失败诚实报错,绝不假装。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { readServerTier } from '@/lib/portal/auth/server-entitlement';
import { resolveAiKey } from '@/lib/portal/ai-keys';
import { envValue } from '@/lib/portal/env';
import { reportAiCall } from '@/lib/portal/ai-telemetry';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type RestyleKind = 'avatar' | 'garment';

// app 主题化提示词。
//
// 2026-07-29(用户标注「App Logo 和用户头像渲染风格割裂」):旧词要的是
// 「pastel blue and teal + 白色贴纸描边 + 星星小花云朵」—— 三处都和站内对不上:
//   ① 蓝青调是**旧**主题色。现在有 4 套可切换皮肤(灰粉/奶茶/雾蓝/苔绿),
//      指定任何一个具体色相都会和其中三套打架 → 改成低饱和中性暖调,四套皮肤都不冲突。
//   ② 星星/小花/云朵这类贴纸装饰是「2D 扁平卡通插画」观感的主要来源,
//      而品牌标记 NesioMark 是磨砂玻璃质感的水晶体 → 去掉装饰,背景改成一层
//      柔和径向渐变,呼应水晶的体积感,让两者站在同一种渲染语言里。
//   ③ 站内图标系统是细描边(strokeWidth 1.8),旧词却要 "clean bold line art" → 改细描边。
// 皮肤是用户可切的、生成图是静态的,所以头像只能取「和四套都相处得好」的中性解,
// 而不是去追某一套的强调色。
const STYLE_PROMPT =
  'Turn this portrait into a friendly cartoon avatar. Soft rounded illustration with thin, delicate line work ' +
  '(not bold outlines), gentle smile, subtle soft shading that gives a light sense of volume. ' +
  'Muted, low-saturation, warm-neutral color palette — soft greys, warm taupe and dusty rose — calm and minimal, ' +
  'no bright or vivid colors. Background is a single smooth radial gradient in the same muted palette: ' +
  'no stars, no flowers, no clouds, no stickers, no decorative props, no sticker outline. ' +
  "Keep the person's hairstyle, face shape and expression clearly recognizable. Head-and-shoulders framing. No text.";

// 衣橱单品图(图16):抠出这件衣服、放到纯白底上,像电商详情页那种干净图。
// 关键是**不许改衣服本身** —— 颜色/图案/版型都得是原来那件,否则衣橱里存的就不是你的衣服了。
const GARMENT_PROMPT =
  'Reproduce ONLY the clothing item from this photo as a clean product shot on a pure white background. ' +
  'Remove the person, hanger, background clutter and shadows. Center the garment, lay it flat or on an invisible mannequin, ' +
  'even soft lighting, no harsh shadow. ' +
  'CRITICAL: keep the exact same colour, pattern, print, texture and cut as the original garment — do not restyle, ' +
  'recolour, or redesign it. No text, no watermark, no props.';

function promptFor(style: RestyleKind): string {
  return style === 'garment' ? GARMENT_PROMPT : STYLE_PROMPT;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/** Gemini 图像生成(image-to-image):返回 { dataUrl } 或 { error }(透出真因)。 */
async function geminiAvatar(key: string, imageBase64: string, mimeType: string, prompt: string): Promise<{ dataUrl?: string; error?: string }> {
  // GA 的 gemini-2.5-flash-image(Nano Banana)优先;preview 别名兜底。旧的
  // 2.0-preview-image-generation 已下线(用户实测 404),不再排队,免得错误信息只剩它。
  const models = [
    envValue('GEMINI_IMAGE_MODEL'),
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-image-preview',
  ].filter(Boolean) as string[];

  const errs: string[] = [];
  for (const model of models) {
    const { signal, done } = withTimeout(40_000);
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
          // Google 规范:文本在前,IMAGE 也要列出才会回图
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal,
      });
      done();
      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }>;
        error?: { message?: string; status?: string };
      };
      if (!res.ok) { errs.push(`${model} ${res.status} ${data.error?.status || ''} ${(data.error?.message || '').slice(0, 60)}`.trim()); continue; }
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
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
  // 逐模型错误全带上(旧实现只留最后一个,诊断时看不出 2.5 到底试没试)
  return { error: errs.join(' · ') || 'gemini_no_image' };
}

/** OpenAI gpt-image-1 编辑(输入图 → 风格化):返回 dataURL 或 null。 */
async function openaiAvatar(key: string, imageBase64: string, mimeType: string, prompt: string): Promise<{ dataUrl?: string; error?: string }> {
  const { signal, done } = withTimeout(40_000);
  try {
    const form = new FormData();
    const bytes = Buffer.from(imageBase64, 'base64');
    form.append('image', new Blob([bytes], { type: mimeType || 'image/png' }), 'input.png');
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    done();
    const data = await res.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!res.ok) return { error: `openai ${res.status} ${(data.error?.message || '').slice(0, 80)}`.trim() };
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? { dataUrl: `data:image/png;base64,${b64}` } : { error: 'openai 无图像返回' };
  } catch (err) {
    done();
    return { error: `openai ${err instanceof Error ? err.name : 'error'}` };
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'avatarify', { limit: 10 });
  if (guard) return guard;

  // 获取当前用户的付费状态
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || null;
  const userTier = await readServerTier(accessToken);
  const canUsePaidCloudAi = userTier === 'pro';

  const body = await req.json().catch(() => ({})) as { imageBase64?: string; mimeType?: string; style?: RestyleKind };
  const style: RestyleKind = body.style === 'garment' ? 'garment' : 'avatar';
  const prompt = promptFor(style);
  if (!body.imageBase64) {
    return NextResponse.json({ ok: false, error: 'no_image' }, { status: 400 });
  }

  // 免费用户无图像生成,返回本地兜底(错误提示用户升级,200不402)
  if (!canUsePaidCloudAi) {
    return NextResponse.json(
      { ok: false, error: 'pro_required', message: '需要订阅才能使用卡通头像生成功能。' },
      { status: 200 },
    );
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
  const errs: string[] = [];
  let dataUrl: string | undefined;
  const startedAt = Date.now();
  let aiSucceeded = false;

  if (geminiKey) {
    const g = await geminiAvatar(geminiKey, body.imageBase64, body.mimeType || 'image/jpeg', prompt);
    dataUrl = g.dataUrl;
    if (g.error) errs.push(g.error);
    if (dataUrl) aiSucceeded = true;
  }
  if (!dataUrl && openaiKey) {
    const o = await openaiAvatar(openaiKey, body.imageBase64, body.mimeType || 'image/jpeg', prompt);
    dataUrl = o.dataUrl;
    if (o.error) errs.push(o.error);
    if (dataUrl) aiSucceeded = true;
  }

  if (!dataUrl) {
    reportAiCall('avatarify', false, startedAt);
    const detail = errs.join(' · ').slice(0, 160);
    console.error('[avatarify] generate_failed', style, detail);
    return NextResponse.json(
      { ok: false, error: 'generate_failed', message: `这次没生成成功:${detail || '模型忙或配额限制'}` },
      { status: 502 },
    );
  }

  reportAiCall('avatarify', true, startedAt);
  return NextResponse.json({ ok: true, dataUrl });
}
