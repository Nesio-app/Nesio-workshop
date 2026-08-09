/**
 * POST /api/portal/dictionary-lookup — 云 AI 英汉/汉英查词(可选兜底)或详情补全。
 * 入:{ query, locale?, mode?: 'lookup' | 'enrich' };出:{ ok, entry: DictEntry }。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';
import type { DictEntry, DictSense } from '@/lib/portal/dictionary/offline-lexicon';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function clampEntry(raw: unknown, query: string): DictEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const sensesRaw = Array.isArray(o.senses) ? o.senses : [];
  const senses: DictSense[] = sensesRaw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .slice(0, 6)
    .map((s) => ({
      pos: typeof s.pos === 'string' ? s.pos.slice(0, 12) : undefined,
      zh: typeof s.zh === 'string' ? s.zh.slice(0, 120) : '',
      en: typeof s.en === 'string' ? s.en.slice(0, 200) : undefined,
    }))
    .filter((s) => s.zh);

  const word = typeof o.word === 'string' ? o.word.trim().slice(0, 60) : query.trim().slice(0, 60);
  const headword = typeof o.headword === 'string' ? o.headword.trim().slice(0, 60) : word;
  const phonetic = typeof o.phonetic === 'string' ? o.phonetic.slice(0, 40) : undefined;
  const examples = Array.isArray(o.examples)
    ? o.examples
      .filter((ex): ex is Record<string, unknown> => Boolean(ex) && typeof ex === 'object')
      .slice(0, 4)
      .map((ex) => ({
        en: typeof ex.en === 'string' ? ex.en.slice(0, 120) : '',
        zh: typeof ex.zh === 'string' ? ex.zh.slice(0, 120) : '',
      }))
      .filter((ex) => ex.en && ex.zh)
    : undefined;
  const mnemonic = typeof o.mnemonic === 'string' ? o.mnemonic.trim().slice(0, 240) : undefined;
  const roots = typeof o.roots === 'string' ? o.roots.trim().slice(0, 200) : undefined;
  const collocations = Array.isArray(o.collocations)
    ? o.collocations
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => c.trim().slice(0, 80))
      .slice(0, 8)
    : undefined;

  // enrich 允许只有助记/例句而无 senses;lookup 必须有释义
  if (!senses.length && !examples?.length && !mnemonic && !roots && !collocations?.length) {
    return null;
  }

  return {
    word: word.toLowerCase(),
    headword,
    phonetic,
    senses: senses.length ? senses : [{ zh: headword }],
    examples,
    mnemonic: mnemonic || undefined,
    roots: roots || undefined,
    collocations: collocations?.length ? collocations : undefined,
  };
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'dictionary-lookup', { limit: 20 });
  if (guard) return guard;

  const body = await req.json().catch(() => null) as {
    query?: unknown; locale?: unknown; mode?: unknown;
  } | null;
  const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 80) : '';
  if (!query) {
    return NextResponse.json({ ok: false, error: 'query_required' }, { status: 400 });
  }
  if (!aiProviderAvailable()) {
    return NextResponse.json({ ok: false, error: 'ai_unavailable' }, { status: 503 });
  }

  const mode = body?.mode === 'enrich' ? 'enrich' : 'lookup';
  const locale = typeof body?.locale === 'string' && body.locale.toLowerCase().startsWith('en') ? 'en' : 'zh';

  const enrichPrompt = locale === 'en'
    ? `Enrich this bilingual dictionary entry for study. Input: "${query}"

Return ONLY valid JSON:
{
  "word": "normalized lowercase English headword",
  "headword": "display form",
  "phonetic": "IPA if English",
  "senses": [{ "pos": "n./v.", "zh": "Chinese definition", "en": "short gloss" }],
  "examples": [{ "en": "natural example", "zh": "Chinese translation" }],
  "mnemonic": "short memorable tip in Chinese or English",
  "roots": "etymology / affixes if useful, else omit",
  "collocations": ["common collocation 1", "…"]
}

Rules: 1-3 senses; 2-4 examples; mnemonic ≤ 1 sentence; max 6 collocations; be accurate.`
    : `为词典详情补全学习字段。输入:「${query}」

只返回合法 JSON:
{
  "word": "规范小写英文词形",
  "headword": "展示用词形",
  "phonetic": "英文 IPA,纯中文可省略",
  "senses": [{ "pos": "词性", "zh": "中文释义", "en": "英文 gloss" }],
  "examples": [{ "en": "例句", "zh": "中文" }],
  "mnemonic": "一句助记(中文优先)",
  "roots": "词根/词缀拆解(有则写)",
  "collocations": ["常见搭配1", "…"]
}

规则:1-3 条释义;2-4 条例句;助记一句;搭配最多 6 条;准确为主。`;

  const lookupPrompt = locale === 'en'
    ? `Look up this word or phrase for a bilingual English↔Chinese dictionary. Input: "${query}"

Return ONLY valid JSON (no markdown):
{
  "word": "normalized lowercase English headword (or pinyin/word for Chinese input)",
  "headword": "display form with correct capitalization",
  "phonetic": "IPA like /həˈləʊ/ for English words, omit if Chinese-only",
  "senses": [{ "pos": "n./v./adj. etc", "zh": "Chinese definition", "en": "short English gloss" }],
  "examples": [{ "en": "example sentence", "zh": "Chinese translation" }]
}

Rules: 1-4 senses max; be accurate; if unsure say so in en gloss; never invent obscure meanings.`
    : `为英汉/汉英词典查词。输入:「${query}」

只返回合法 JSON(不要 markdown):
{
  "word": "规范小写英文词形(中文输入则填对应英文或拼音)",
  "headword": "展示用词形(保留大小写/中文)",
  "phonetic": "英文 IPA 音标如 /həˈləʊ/,纯中文可省略",
  "senses": [{ "pos": "词性如 n./v.", "zh": "中文释义", "en": "简短英文解释" }],
  "examples": [{ "en": "例句", "zh": "例句中文" }]
}

规则:1-4 条释义;准确为主;不确定时在 en 里注明;不要编造生僻义。`;

  try {
    const { text } = await completeText({
      prompt: mode === 'enrich' ? enrichPrompt : lookupPrompt,
      system: locale === 'en'
        ? 'You are a concise bilingual dictionary. Return only JSON.'
        : '你是简洁的英汉词典。只返回 JSON。',
      maxTokens: mode === 'enrich' ? 900 : 600,
      temperature: 0.2,
      responseFormat: 'json',
      route: 'dictionary-lookup',
    });
    const parsed = parseJsonBlock<unknown>(text) ?? (() => {
      try { return JSON.parse(text); } catch { return null; }
    })();
    const entry = clampEntry(parsed, query);
    if (!entry) {
      return NextResponse.json({ ok: false, error: 'parse_failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, entry, source: 'ai', mode });
  } catch (err) {
    console.error('[dictionary-lookup]', err instanceof Error ? err.message : err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 120) : 'ai_failed',
    }, { status: 502 });
  }
}
