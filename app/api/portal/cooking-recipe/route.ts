/**
 * POST /api/portal/cooking-recipe — Pro 云生成菜谱(美食)。
 * 输入:食材 + 菜系 id(+ 可选自定义要求);输出钳制后的 Recipe JSON。
 * 对标 eat-well generateRecipe / 食见 AI 菜谱创作;密钥只在服务端。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';
import { CUISINES } from '@/lib/cooking/food-catalog';
import { buildRecipeGeneratePrompt, clampGeneratedRecipe, pickRecipeTips, formatTechniqueNotes, type TechniqueTip } from '@/lib/cooking/recipe-generate';
import tipsData from '@/public/data/cooking/tips.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'cooking-recipe', { limit: 12, requirePaidCloudAi: true });
  if (guard) return guard;

  const body = await req.json().catch(() => null) as {
    ingredients?: unknown;
    cuisineId?: unknown;
    customPrompt?: unknown;
    locale?: unknown;
  } | null;

  const ingredients = Array.isArray(body?.ingredients)
    ? (body!.ingredients as unknown[]).filter((x) => typeof x === 'string').map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
    : [];
  if (ingredients.length < 1) {
    return NextResponse.json({ ok: false, error: 'ingredients_required' }, { status: 400 });
  }

  const cuisineId = typeof body?.cuisineId === 'string' ? body.cuisineId.trim() : 'chuan';
  const cuisine = CUISINES.find((c) => c.id === cuisineId) || CUISINES[0];
  if (!cuisine) {
    return NextResponse.json({ ok: false, error: 'cuisine_missing' }, { status: 500 });
  }

  const customPrompt = typeof body?.customPrompt === 'string' ? body.customPrompt : '';
  const locale = typeof body?.locale === 'string' ? body.locale : 'zh';
  // 技法 grounding:本地语料确定性选摘(≤2 篇×700字),选不中就不带,不为凑数花 token。
  const techniqueTips = pickRecipeTips((tipsData as { tips?: TechniqueTip[] }).tips ?? [], { ingredients, customPrompt });
  const prompt = buildRecipeGeneratePrompt({ cuisine, ingredients, customPrompt, locale, techniqueNotes: formatTechniqueNotes(techniqueTips) });

  try {
    const { text } = await completeText({
      prompt,
      system: locale.toLowerCase().startsWith('en')
        ? 'You are a professional chef. Return only valid JSON for one recipe. No markdown.'
        : '你是专业厨师。只返回一道菜的合法 JSON,不要 markdown 或其它文字。',
      maxTokens: 1200,
      temperature: 0.7,
      route: 'cooking-recipe',
      responseFormat: 'json',
    });
    const parsed = parseJsonBlock<unknown>(text) ?? (() => {
      try { return JSON.parse(text); } catch { return null; }
    })();
    const recipe = clampGeneratedRecipe(parsed, cuisine.name, ingredients);
    if (!recipe) {
      return NextResponse.json({ ok: false, error: 'parse_failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, recipe, cuisineId: cuisine.id });
  } catch (err) {
    console.error('[cooking-recipe]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
  }
}
