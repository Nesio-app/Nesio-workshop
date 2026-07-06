import { resolveAiKey } from '@/lib/portal/ai-keys';

const DEFAULT_MODELS = 'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-1.5-flash-8b';

export function getGoogleKey(): string | undefined {
  // 统一别名解析(与 ai-keys 一处收敛),不再各处手列别名。
  return resolveAiKey('gemini') || undefined;
}

export function getModelList(): string[] {
  return (process.env.GEMINI_MODEL || DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryDelayMs(msg: string): number | null {
  const m = msg.match(/retry in ([\d.]+)s/i);
  if (!m) return null;
  const sec = parseFloat(m[1]);
  if (!Number.isFinite(sec) || sec <= 0 || sec > 60) return null;
  return Math.ceil(sec * 1000) + 300;
}

function isQuotaError(msg: string): boolean {
  return /quota|rate limit|429|resource_exhausted/i.test(msg);
}

type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };

export async function geminiGenerate(opts: {
  system: string;
  userParts: GeminiPart[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const key = getGoogleKey();
  if (!key) throw new Error('AI not configured');

  const models = getModelList();
  let lastErr = 'No models tried';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: [{ role: 'user', parts: opts.userParts }],
            generationConfig: {
              maxOutputTokens: Math.min(Math.max(opts.maxTokens ?? 1024, 64), 4096),
              temperature: opts.temperature ?? 0.65,
            },
          }),
        });

        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          error?: { message?: string };
        };

        if (!res.ok) {
          lastErr = data?.error?.message || `HTTP ${res.status} for ${model}`;
          const delay = parseRetryDelayMs(lastErr);
          if (delay && attempt < 2) {
            await sleep(delay);
            continue;
          }
          break;
        }

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
        lastErr = `Empty response from ${model}`;
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    if (!isQuotaError(lastErr)) continue;
  }

  throw new Error(lastErr);
}

export function parseJsonFromText(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  return JSON.parse(cleaned);
}

export const HEALTH_AI_SYSTEM = `你是「溯 SÙ · 溯医」健康助手。用简体中文，语气温暖、具体、克制。

职责：解释血糖/TIR/HRV/睡眠/营养等指标；讨论用药与饮食模式；解读体检摘要；给出可执行的小建议。

原则：
- 不诊断疾病、不开药、不替代医生
- 引用用户数据时带数字；承认相关≠因果
- 默认 3–6 句话；用户要求详细时可展开
- 涉及危急症状提醒就医`;

export const FOOD_ANALYZE_SYSTEM = `你是营养与血糖管理助手。看餐食照片，估计碳水与对血糖的影响。
只返回一行 JSON，不要 markdown：
{"title":"识别到的食物（中文）","carbs":数字,"calories":数字,"tir_hint":"如 85%","advice":"30字内建议","emoji":"一个食物表情"}
看不清时合理估计，carbs/calories 用整数。`;

export const CHECKUP_ANALYZE_SYSTEM = `你是健康报告解读助手。阅读体检报告图片或文字，用白话总结。
只返回 JSON：
{"summary":"50字内摘要","ai":"120字内解读与建议","flags":["需关注项1","需关注项2"]}`;

export const INSIGHT_SYSTEM = `你是健康数据洞察助手。根据紧凑 JSON 摘要，写 2–3 句今日洞察（80–120字）。
不诊断；带 1 个具体数字；给 1 条可执行建议。`;
