/**
 * POST /api/portal/inventory-extract — 问一问「像发消息一样记物品」。
 * 输入自然语言(「红色 Nike 鞋 42 码放鞋柜,两包 AA 电池」),AI 拆成物品清单;
 * 不是记物品的话返回空数组(客户端落回普通聊天)。字段服务端钳制,不信模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RawItem {
  name?: unknown; quantity?: unknown; location?: unknown; category?: unknown;
  tags?: unknown; price?: unknown; note?: unknown;
}

export interface ExtractedItem {
  name: string; quantity?: number; location?: string; category?: string;
  tags?: string[]; price?: number; note?: string;
}

const PROMPT = `你是收纳助手。把用户这句话拆成要记录的物品清单,输出 JSON 数组(不要任何其他文字)。
每项字段:name(必填,物品名,含颜色/型号等修饰)、quantity(数量,整数,默认不填)、
location(用户说了放哪才填,原话)、category(简短分类,如 衣物/电子/日用品/护肤)、
tags(0-4 个短标签)、price(用户提到价格才填,数字)、note(其余补充)。
如果这句话不是在记录物品(比如提问/找东西/闲聊),输出 []。
用户的话:`;

function clampItems(raw: unknown): ExtractedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedItem[] = [];
  for (const r of raw.slice(0, 10) as RawItem[]) {
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 60) : '';
    if (!name) continue;
    const item: ExtractedItem = { name };
    if (typeof r.quantity === 'number' && Number.isFinite(r.quantity)) item.quantity = Math.min(999, Math.max(1, Math.round(r.quantity)));
    if (typeof r.location === 'string' && r.location.trim()) item.location = r.location.trim().slice(0, 60);
    if (typeof r.category === 'string' && r.category.trim()) item.category = r.category.trim().slice(0, 20);
    if (Array.isArray(r.tags)) item.tags = r.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim().slice(0, 20)).slice(0, 4);
    if (typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 0 && r.price < 1_000_000) item.price = Math.round(r.price * 100) / 100;
    if (typeof r.note === 'string' && r.note.trim()) item.note = r.note.trim().slice(0, 120);
    out.push(item);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'inventory-extract', { limit: 20 });
  if (guard) return guard;
  const body = await req.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 800) : '';
  if (!text) return NextResponse.json({ ok: false, error: 'no_text' }, { status: 400 });
  try {
    const { text: raw } = await completeText({ prompt: `${PROMPT}${text}`, maxTokens: 800, temperature: 0 });
    const items = clampItems(parseJsonBlock<unknown>(raw));
    return NextResponse.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'ai_unavailable' }, { status: 502 });
  }
}
