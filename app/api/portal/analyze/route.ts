/**
 * /api/portal/analyze
 * Unified AI analysis endpoint for Tell Nesio captures.
 * Accepts: { type: 'image' | 'text' | 'file' | 'ask', content: string, mimeType?: string }
 * Returns: { nodes: LifeNodeInput[], summary: string, intent: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GEMINI_MODEL_FALLBACKS } from '@/lib/portal/ai-provider-chain.mjs';
import { createSignal } from '@/lib/life-domain/create-signal';
import { normalizePhotoToSignal, normalizeVoiceToSignal } from '@/lib/life-domain/normalizers';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionSystemPrompt, buildImageExtractionSystemPrompt, languageDirective, parseJsonBlock } from '@/lib/extraction/extraction';
import { isRateLimited, isPortalRequestAuthorized } from '@/lib/portal/api-auth';
import { resolveAiKey } from '@/lib/portal/ai-keys';
import { envValue } from '@/lib/portal/env';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
// Gemini 模型链共读单一数据源 ai-provider-chain.mjs(2.5 全系都带视觉);
// gemini-1.5-flash 已 404 退役,gemini-2.0-flash 免费层 limit:0(批次 44 撤出)。
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function getAnthropicKey(): string | undefined {
  return (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)?.trim();
}

function getGeminiKey(): string | undefined {
  return resolveAiKey('gemini') || undefined;
}

function getOpenAIKey(): string | undefined {
  return (process.env.OpenAI_KEY || process.env.OPENAI_API_KEY)?.trim();
}

async function isAnalyzeAiAllowed(req: NextRequest): Promise<boolean> {
  const stage5Secret = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const providedStage5Secret = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  if (stage5Secret && providedStage5Secret === stage5Secret) return true;

  // 本地/实验 env-flag 旁路(不需要 secret;仅本地实验开)。
  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  const labEnabled = envValue('BAOHE_PERSONAL_LAB_AI_ENABLED').toLowerCase() === 'true';
  if (labEnabled && accessMode === 'personal_lab') return true;

  // 安全(denial-of-wallet 收口):**验真会话**,不再只看 cookie 存在。isPortalRequestAuthorized 会向
  // Supabase 验 access token / HMAC 验签 refresh|openid / 认 Stage5 secret / 无 Supabase 的本地部署放行。
  // 伪造 cookie 拿不到有效 token → 拒。access 过期时 cookie 同步失效 → 落 refresh 签名分支,合法用户不误伤
  // (与全仓 30+ guardAiRoute 路由同款成熟路径)。
  return isPortalRequestAuthorized(req);
}

// Canonical extraction prompt — shared with ingest/gmail via lib/extraction
const SYSTEM_PROMPT = EXTRACTION_SYSTEM_PROMPT;

// 衣橱:拍一件衣服 → 结构化属性(付费/云;客户端已用 canUsePaidCloudAi 门控)。
// 输出仍是通用 {nodes:[{name, attributes}], summary},客户端读 nodes[0].attributes 预填,
// 缺字段用户手改 —— 永不盲信。
function buildClothingPrompt(uiLocale?: string): string {
  const isEn = (uiLocale || 'zh').toLowerCase().startsWith('en');
  return `You are a wardrobe assistant. The image is ONE clothing item. Identify it and return ONLY valid JSON, no markdown fences:
{
  "summary": "${isEn ? 'one short sentence naming the item' : '一句话描述这件衣服'}",
  "nodes": [{
    "name": "${isEn ? 'short item name, e.g. \"navy oxford shirt\"' : '简短名字,如「藏青牛津衬衫」'}",
    "attributes": {
      "garmentType": "one of: top | bottom | outer | dress | shoes | accessory",
      "warmth": 1,                     // 1 thin, 2 medium, 3 warm
      "formality": "one of: casual | smart | formal",
      "colors": "${isEn ? 'comma-separated colors' : '逗号分隔的颜色词'}",
      "material": "${isEn ? 'main fabric if visible, else empty' : '可见的主要材质,看不出留空'}"
    }
  }]
}
RULES: garmentType/warmth/formality MUST use the exact allowed values. Guess reasonably from the photo. Output ${isEn ? 'English' : 'Chinese'} for name/colors/material.`;
}

const ASK_SYSTEM_PROMPT = `You are Nesio, a personal life assistant embedded in a user's memory app.
The user message is JSON: {"query": "...", "candidates": [...memory nodes...], "totalNodeCount": N}

YOUR JOB:
1. Answer the question directly in natural Chinese (1-4 sentences, warm and conversational)
2. Cite which specific memory nodes support your answer
3. For count/aggregate queries (多少/总共/所有/花了多少/哪些): compute stats from ALL provided candidates
4. If the question requires current world info (news, weather, stocks, real-time data): set webSearchNeeded: true

RETURN ONLY valid JSON, no markdown fences:
{
  "answer": "直接、自然的中文回答",
  "matches": [
    {"id": "node_id", "name": "节点名称", "reason": "一句话说明为什么引用这条"}
  ],
  "aggregations": [
    {"label": "统计标签", "value": "数值或文字"}
  ],
  "webSearchNeeded": false
}

RULES:
- Only use information from provided nodes. Never invent facts.
- If nothing matches: answer = "暂时没有记录这方面的信息。" and matches = []
- aggregations only needed for numeric count/sum questions
- answer must be under 100 Chinese characters
- Citations should reference the ACTUAL node id from the candidates list
`;

async function analyzeWithClaude(content: string, isImage: boolean, imageBase64?: string, mimeType?: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
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

  const res = await fetchWithTimeout(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      system: systemPrompt,
      messages,
      max_tokens: 1024,
    }),
  }, 10_000);

  const data = await res.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(data?.error?.message || `Claude ${res.status}`);
  return data.content?.map((c) => c.text).join('') || '';
}

// 批次 90(用户实锤识别 30s):给每个 provider fetch 套超时闸 —— 没有它,
// 一个卡住的请求能吃掉整个 30s maxDuration,后面的 provider 都没机会跑。
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function logAiProviderFailure(provider: string, detail: string) {
  console.warn('[portal-analyze] provider_failed', {
    provider,
    detail,
  });
}

async function analyzeWithGemini(content: string, imageBase64?: string, mimeType?: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  const key = getGeminiKey();
  if (!key) throw new Error('no_gemini_key');

  const parts: unknown[] = [];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } });
  }
  parts.push({ text: `${systemPrompt}\n\nUser input: ${content}` });

  const configuredModel = envValue('GEMINI_MODEL');
  const models = Array.from(new Set([configuredModel, ...GEMINI_MODEL_FALLBACKS].filter(Boolean)));
  let lastError = 'Gemini unavailable';

  for (const model of models) {
    // 批次 90:限流重试等待 2s→0.6s(免费层限流是每分钟窗口,长等无意义,
    // 只白白吃掉 30s 预算);超时 8s 一档。
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchWithTimeout(`${GEMINI_BASE_URL}/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      }, 10_000);

      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string; status?: string };
      };
      if (res.ok) {
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        if (text) return text;
        lastError = `Gemini ${model} empty_response`;
        logAiProviderFailure('gemini', lastError);
        break;
      }
      // 429 速率限制:短等一次即换下一个模型(别在同一限流模型上耗时)
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      lastError = `Gemini ${model} ${res.status}${data.error?.status ? ` ${data.error.status}` : ''}`;
      logAiProviderFailure('gemini', lastError);
      break;
    }
    // 如果这个 model 成功过（text 已 return），不会走到这里
  }

  throw new Error(lastError);
}

async function analyzeWithOpenAI(content: string, isImage: boolean, imageBase64?: string, mimeType?: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  const key = getOpenAIKey();
  if (!key) throw new Error('no_openai_key');

  const prompt = `${systemPrompt}\n\nUser input: ${content}`;
  const userContent: unknown[] = isImage && imageBase64
    ? [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`,
            detail: 'low',
          },
        },
      ]
    : [{ type: 'text', text: prompt }];

  const res = await fetchWithTimeout(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: envValue('OPENAI_VISION_MODEL') || envValue('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.2,
      max_tokens: 900,
    }),
  }, 10_000);

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; type?: string };
  };
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}${data.error?.type ? ` ${data.error.type}` : ''}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

/** Gemini with Google Search Grounding — for questions needing real-world info */
async function askWithGeminiWebSearch(query: string, uiLocale?: string): Promise<{ answer: string; searchUsed: boolean }> {
  const key = getGeminiKey();
  if (!key) throw new Error('no_gemini_key');

  const isEn = (uiLocale || 'zh').toLowerCase().startsWith('en');
  const prompt = isEn ? `Answer concisely in English: ${query}` : `请用中文简洁回答：${query}`;
  // 批次 44:2.0-flash 免费层 limit:0 必 429;搜索 grounding 换 2.5-flash(全系支持)
  const res = await fetch(`${GEMINI_BASE_URL}/gemini-2.5-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tools: [{ google_search: {} }],
      contents: [{ parts: [{ text: prompt }], role: 'user' }],
    }),
  });

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { webSearchQueries?: string[] };
    }>;
    error?: { message?: string };
  };

  if (!res.ok) throw new Error(`Gemini-search ${res.status}: ${data.error?.message || ''}`);

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  const searchUsed = (data.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
  return { answer: text, searchUsed };
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
  // Shared fence-stripping parser (lib/extraction); re-stringify to keep
  // this function's string-based contract for downstream JSON.parse calls.
  const parsed = parseJsonBlock<unknown>(raw);
  return parsed !== null ? JSON.stringify(parsed) : raw.trim();
}

export const maxDuration = 30;
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      type: 'text' | 'image' | 'file' | 'ask';
      content: string;
      imageBase64?: string;
      mimeType?: string;
      uiLocale?: string;
      mode?: 'clothing';
    };

    let raw = '';
    const isImage = body.type === 'image' && Boolean(body.imageBase64);
    const aiAllowed = await isAnalyzeAiAllowed(req);
    // 输出语言跟随 UI(英文用户不该拿到中文 name/summary/tags)。
    const isEn = (body.uiLocale || 'zh').toLowerCase().startsWith('en');
    // 衣橱识别用专属 prompt(结构化属性);其余走通用抽取。默认路径不变。
    // 2026-07-28(标注 图8/图9):拍照走图片专用 prompt —— 通用抽取会把「桌上一支笔」判成
    // 「没有生命图谱条目」返回空 nodes,于是刚存过的东西再拍一次也认不出来。
    const extractionPrompt = (isImage && body.mode === 'clothing')
      ? buildClothingPrompt(body.uiLocale)
      : isImage
        ? buildImageExtractionSystemPrompt(body.uiLocale)
        : buildExtractionSystemPrompt(body.uiLocale);

    // 有鉴权但之前无限流:单个会话可无节流刷最贵的视觉/grounding 调用(每请求最多 4 次外部 AI)。
    if (aiAllowed && isRateLimited(req, 'analyze', { limit: 20 })) {
      return NextResponse.json({ ok: false, error: 'rate_limited', retryAfterMs: 30_000 }, { status: 429 });
    }

    if (!aiAllowed) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ai_auth_required',
          summary: '登录或 Lab 模式后可使用 Nesio 分析。',
        },
        { status: 403 },
      );
    }

    if (body.type === 'ask') {
      let parsedQuery = '';
      try {
        const parsed = JSON.parse(body.content) as { query?: string };
        parsedQuery = parsed.query || '';
      } catch { /* ok */ }

      const askPrompt = ASK_SYSTEM_PROMPT + languageDirective(body.uiLocale);
      try {
        raw = await analyzeWithClaude(body.content, false, undefined, undefined, askPrompt);
      } catch {
        try {
          raw = await analyzeWithGemini(body.content, undefined, undefined, askPrompt);
        } catch {
          return NextResponse.json({ ok: false, error: 'ai_search_unavailable' }, { status: 503 });
        }
      }
      const askJson = extractJson(raw);
      const askResult = JSON.parse(askJson) as {
        matches?: object[];
        answer?: string;
        aggregations?: Array<{ label: string; value: string | number }>;
        webSearchNeeded?: boolean;
      };

      // 网络搜索（仅当 AI 判断需要且有 query 时）
      let webAnswer = '';
      let webSearchUsed = false;
      if (askResult.webSearchNeeded && parsedQuery) {
        try {
          const ws = await askWithGeminiWebSearch(parsedQuery, body.uiLocale);
          webAnswer = ws.answer;
          webSearchUsed = ws.searchUsed;
        } catch {
          // 网络搜索失败，仍使用记忆回答
        }
      }

      const memAnswer = askResult.answer || '';
      const webPrefix = isEn ? '🌐 From the web: ' : '🌐 来自网络：';
      const finalAnswer = webAnswer
        ? `${memAnswer}${memAnswer ? '\n\n' : ''}${webPrefix}${webAnswer}`
        : memAnswer;

      return NextResponse.json({
        ok: true,
        matches: askResult.matches || [],
        answer: finalAnswer,
        aggregations: askResult.aggregations || [],
        webSearchUsed,
      });
    }

    if (aiAllowed) {
      const providerErrors: string[] = [];
      const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'unknown_error');
      try {
        raw = await analyzeWithClaude(body.content, isImage, body.imageBase64, body.mimeType, extractionPrompt);
      } catch (claudeError) {
        providerErrors.push(`claude: ${errMsg(claudeError)}`);
        logAiProviderFailure('claude', errMsg(claudeError));
        try {
          raw = await analyzeWithGemini(body.content, body.imageBase64, body.mimeType, extractionPrompt);
        } catch (geminiError) {
          providerErrors.push(`gemini: ${errMsg(geminiError)}`);
          logAiProviderFailure('gemini', errMsg(geminiError));
          try {
            raw = await analyzeWithOpenAI(body.content, isImage, body.imageBase64, body.mimeType, extractionPrompt);
          } catch (openAiError) {
            providerErrors.push(`openai: ${errMsg(openAiError)}`);
            logAiProviderFailure('openai', errMsg(openAiError));
            if (isImage) {
              return NextResponse.json(
                {
                  ok: false,
                  error: 'ai_image_unavailable',
                  summary: '图片识别暂时不可用。可以先保存为待确认图片线索。',
                  providerErrors,
                },
                { status: 503 },
              );
            }
            raw = analyzeFallback(body.content);
          }
        }
      }
    } else {
      raw = analyzeFallback(body.content);
    }

    const json = extractJson(raw);
    const result = JSON.parse(json) as { nodes: object[]; summary: string; intent: string };
    const firstNode = Array.isArray(result.nodes) ? result.nodes[0] as Record<string, unknown> | undefined : undefined;
    const signalInput = body.type === 'image'
      ? normalizePhotoToSignal({
          title: typeof firstNode?.name === 'string' ? firstNode.name : result.summary || (isEn ? 'Photo clue' : '图片线索'),
          summary: result.summary,
          tags: isEn ? ['Snap', 'AI'] : ['拍一下', 'AI识别'],
        })
      : normalizeVoiceToSignal({
          text: body.content || result.summary || (isEn ? 'Note' : '记录'),
          tags: [result.intent || 'MEMORY_CAPTURE'],
        });
    const signal = createSignal(signalInput);
    // ⑧ 云写入统一由客户端 ingestLifeNode 负责(与 Gmail/Notion 等所有入口一致)。
    //   此前这里服务端再写一次云信号 → 同一次捕获在云端产生两条,已去掉双写。
    return NextResponse.json({ ok: true, ...result, signals: [signal], signalIds: [signal.id] });
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
