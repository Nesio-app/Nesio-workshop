/**
 * POST /api/portal/wardrobe-stylist — Pro 云造型师(衣橱穿搭·A)。
 * 输入用户衣橱单品(带 id)+ 今日天气/场合(+ 可选「不喜欢」偏好,供反馈学习 B),
 * 让模型像造型师一样从**现有单品**里挑一套协调好看的搭配 + 讲理由 + 给造型贴士。
 * 只返回 pieceIds(服务端钳制为衣橱里真实存在的 id,不信模型编造)。
 *
 * 分层:付费/云(guardAiRoute + requirePaidCloudAi)。免费/失败 → 客户端回落规则版
 * suggestOutfit(lib/portal/wardrobe),永不空手。对标 person-extract 的付费云范式。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface InItem { id?: unknown; name?: unknown; type?: unknown; warmth?: unknown; formality?: unknown; colors?: unknown }
export interface StylistResult { pieceIds: string[]; reason: string; tips: string[] }

const TYPE_ZH: Record<string, string> = { top: '上装', bottom: '下装', outer: '外套', dress: '连衣裙', shoes: '鞋', accessory: '配饰' };
const WARMTH_ZH: Record<string, string> = { '1': '薄', '2': '适中', '3': '保暖' };
const FORMAL_ZH: Record<string, string> = { casual: '休闲', smart: '通勤', formal: '正式' };

/** 钳制:pieceIds 只保留衣橱里真实存在的 id;文本截断。不信模型。 */
export function clampStylist(raw: unknown, validIds: ReadonlySet<string>): StylistResult {
  const obj = (raw && typeof raw === 'object') ? raw as { pieceIds?: unknown; reason?: unknown; tips?: unknown } : {};
  const ids: string[] = [];
  if (Array.isArray(obj.pieceIds)) {
    for (const x of obj.pieceIds) {
      const id = typeof x === 'string' ? x.trim() : '';
      if (id && validIds.has(id) && !ids.includes(id)) ids.push(id);
      if (ids.length >= 8) break;
    }
  }
  const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 300) : '';
  const tips: string[] = [];
  if (Array.isArray(obj.tips)) {
    for (const t of obj.tips) {
      const s = typeof t === 'string' ? t.trim().slice(0, 120) : '';
      if (s) tips.push(s);
      if (tips.length >= 3) break;
    }
  }
  return { pieceIds: ids, reason, tips };
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'wardrobe-stylist', { limit: 20, requirePaidCloudAi: true });
  if (guard) return guard;

  const body = await req.json().catch(() => null) as {
    items?: InItem[]; tempMinC?: unknown; tempMaxC?: unknown; precipProb?: unknown;
    occasion?: unknown; locale?: unknown; dislikes?: unknown;
  } | null;

  const rawItems = Array.isArray(body?.items) ? body!.items.slice(0, 80) : [];
  const items = rawItems
    .map((it) => ({
      id: typeof it?.id === 'string' ? it.id : '',
      name: typeof it?.name === 'string' ? it.name.slice(0, 40) : '',
      type: typeof it?.type === 'string' ? it.type : 'top',
      warmth: String(it?.warmth ?? '2'),
      formality: typeof it?.formality === 'string' ? it.formality : 'casual',
      colors: Array.isArray(it?.colors) ? (it!.colors as unknown[]).filter((c) => typeof c === 'string').join('/') : '',
    }))
    .filter((it) => it.id && it.name);
  if (items.length < 2) return NextResponse.json({ ok: false, error: 'too_few_items' }, { status: 400 });

  const validIds = new Set(items.map((it) => it.id));
  const isEn = String(body?.locale || 'zh').toLowerCase().startsWith('en');
  const tMin = Number(body?.tempMinC); const tMax = Number(body?.tempMaxC); const precip = Number(body?.precipProb);
  const occasion = String(body?.occasion || 'casual');
  const dislikes = Array.isArray(body?.dislikes) ? (body!.dislikes as unknown[]).filter((d) => typeof d === 'string').slice(0, 20) as string[] : [];

  const wardrobeList = items.map((it) =>
    `- id=${it.id} | ${it.name} | ${TYPE_ZH[it.type] || it.type} | ${WARMTH_ZH[it.warmth] || '适中'} | ${FORMAL_ZH[it.formality] || it.formality}${it.colors ? ` | ${it.colors}` : ''}`,
  ).join('\n');

  const weatherLine = Number.isFinite(tMin) && Number.isFinite(tMax)
    ? `${isEn ? 'Weather' : '天气'}: ${Math.round(tMin)}–${Math.round(tMax)}°C${Number.isFinite(precip) ? `, ${isEn ? 'rain' : '降水'} ${Math.round(precip)}%` : ''}`
    : (isEn ? 'Weather: unknown' : '天气:未知');
  const occLine = `${isEn ? 'Occasion' : '场合'}: ${FORMAL_ZH[occasion] || occasion}`;
  const dislikeLine = dislikes.length
    ? `\n${isEn ? 'Avoid (user disliked before)' : '避免(用户之前不喜欢)'}: ${dislikes.join('; ')}`
    : '';

  const prompt = isEn
    ? `You are a seasoned fashion stylist. From the user's wardrobe below (each item has an id), pick ONE coherent, good-looking outfit for today.
Rules: use only ids from the list; include at least a top+bottom (or a dress) plus shoes; add outer if cold; keep it season-coherent (never sweater+shorts), color-harmonious, and right for the occasion.
${weatherLine}. ${occLine}.${dislikeLine}
Wardrobe:
${wardrobeList}
Output ONLY JSON (no prose): {"pieceIds":["..."],"reason":"one natural sentence why it works","tips":["styling tip","styling tip"]}`
    : `你是资深服装造型师。下面是用户衣橱里的单品(每件有 id),请按今天的天气和场合,从中挑**一套协调好看**的搭配。
要求:只用列表里的 id;至少含上装+下装(或连衣裙)+ 鞋,冷天加外套;讲究季节一致(别毛衣配短裤)、色彩协调、廓形与场合匹配。
${weatherLine}。${occLine}。${dislikeLine}
衣橱:
${wardrobeList}
只输出 JSON(不要任何其他文字):{"pieceIds":["..."],"reason":"一句话说明为什么这么搭","tips":["造型贴士","造型贴士"]}`;

  try {
    const { text: raw } = await completeText({ prompt, maxTokens: 500, temperature: 0.5 });
    const result = clampStylist(parseJsonBlock<unknown>(raw), validIds);
    if (result.pieceIds.length === 0) return NextResponse.json({ ok: false, error: 'no_outfit' }, { status: 502 });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'ai_unavailable' }, { status: 502 });
  }
}
