/**
 * POST /api/portal/person-extract — 「说一句 → 自动记进某人档案」(拍一拍入档 Phase 1·文本)。
 * 输入自然语言(「小美期末年级第一」「给爸爸买了降压药,每天一片,一个月量」),
 * AI 拆成要记在某人名下的分类记录 + 这条是关于谁。不是在记录某人信息就返回空。
 * 字段服务端钳制,不信模型。对标 inventory-extract(物品版)。
 *
 * 隐私口径(用户 2026-07 决定「全放开」):医疗/药物/健康也允许 AI 提取与后台分析。
 * 走 guardAiRoute(会话/密钥/限流);照片提取见后续块(需给共享 AI 客户端加视觉)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CATEGORIES = ['achievement', 'spending', 'location', 'medical', 'medication', 'health'] as const;
type Category = typeof CATEGORIES[number];
const CATEGORY_SET = new Set<string>(CATEGORIES);

interface RawRec { category?: unknown; title?: unknown; detail?: unknown; date?: unknown; amount?: unknown }
export interface ExtractedRecord { category: Category; title: string; detail?: string; date?: string; amount?: number }
export interface PersonExtractResult { personName: string; records: ExtractedRecord[] }

const PROMPT = `你是个人档案助手。把输入拆成「要记在某个人名下」的记录,只输出 JSON(不要任何其他文字):
{"personName":"这条是关于谁(人名/称呼,如「小美」「爸爸」;照片上有名字(如成绩单/处方上的姓名)就用它;没有留空字符串)",
 "records":[{"category":"成绩=achievement,消费=spending,位置=location,医疗=medical,药物=medication,健康=health",
   "title":"必填,简短一句(如「期末年级第一」「氨氯地平 每天一片」)",
   "detail":"补充(剂量/频次/疗程/科目分数/备注,没有就省略)",
   "date":"YYYY-MM-DD(提到日期才填,否则省略)",
   "amount":"消费金额,数字(仅 spending,提到才填)"}]}
药物类把药名放 title、剂量频次疗程放 detail。成绩单可拆成多条(总评一条 + 关注的单科)。
如果这不是在记录某人的信息(提问/闲聊/无关图),records 输出 []。
输入内容:`;
const IMAGE_HINT = '(下面附了一张照片,请从图片里识别要记录的信息;文字是补充说明)';

export function clampRecords(raw: unknown): PersonExtractResult {
  const obj = (raw && typeof raw === 'object') ? raw as { personName?: unknown; records?: unknown } : {};
  const personName = typeof obj.personName === 'string' ? obj.personName.trim().slice(0, 40) : '';
  const list = Array.isArray(obj.records) ? obj.records : [];
  const records: ExtractedRecord[] = [];
  for (const r of (list as RawRec[]).slice(0, 12)) {
    const category = typeof r?.category === 'string' && CATEGORY_SET.has(r.category) ? r.category as Category : null;
    const title = typeof r?.title === 'string' ? r.title.trim().slice(0, 80) : '';
    if (!category || !title) continue;
    const rec: ExtractedRecord = { category, title };
    if (typeof r.detail === 'string' && r.detail.trim()) rec.detail = r.detail.trim().slice(0, 200);
    if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date.trim())) rec.date = r.date.trim();
    if (category === 'spending' && typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0 && r.amount < 1_000_000) {
      rec.amount = Math.round(r.amount * 100) / 100;
    }
    records.push(rec);
  }
  return { personName, records };
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'person-extract', { limit: 20, requirePaidCloudAi: true });
  if (guard) return guard;
  const body = await req.json().catch(() => null) as { text?: unknown; image?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 800) : '';
  // 照片:data URL(data:image/...;base64,...);限 8MB base64,避免超大图打爆
  const image = typeof body?.image === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(body.image) && body.image.length < 8_000_000
    ? body.image : '';
  if (!text && !image) return NextResponse.json({ ok: false, error: 'no_input' }, { status: 400 });
  try {
    const prompt = image ? `${PROMPT}${IMAGE_HINT}\n${text}` : `${PROMPT}${text}`;
    const { text: raw } = await completeText({ prompt, maxTokens: 900, temperature: 0, ...(image ? { image } : {}) });
    const result = clampRecords(parseJsonBlock<unknown>(raw));
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'ai_unavailable' }, { status: 502 });
  }
}
