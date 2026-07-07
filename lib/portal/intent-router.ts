/**
 * Intent Router — classifies Tell Nesio input into actionable intents.
 * Rule-based MVP. LLM fallback can be added later via /api/portal/chat.
 */

export type IntentType =
  | 'MEMORY_CAPTURE'   // "记住 Linda 的娃娃在蓝盒子"
  | 'PHOTO_CAPTURE'    // input has image
  | 'THINKING'         // "为什么我最近..." / "分析一下"
  | 'PLANNING'         // "帮我安排" / "计划"
  | 'REMINDER'         // "提醒我" / "别忘了"
  | 'SHARE_PARSE'      // shared email/link/PDF
  | 'COMPANION_CHAT';  // everything else

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  extractedText: string;
  suggestedAction: string;
}

const MEMORY_PATTERNS = [/^记住/, /^remember/i, /在.{1,10}里$/, /位于/, /放在/, /存在/, /存到/];
const THINKING_PATTERNS = [/为什么/, /分析/, /why/i, /explain/i, /最近.*?(焦虑|难|累|压力)/];
const PLANNING_PATTERNS = [/帮我安排/, /帮我计划/, /schedule/i, /plan/i, /怎么安排/];
const REMINDER_PATTERNS = [/提醒我/, /别忘/, /记得/, /remind/i, /don't forget/i];
const SHARE_PATTERNS = [/^https?:\/\//, /\.pdf$/i, /邮件/, /email/i, /from:/i];

export function routeIntent(input: string, hasImage = false): IntentResult {
  if (hasImage) {
    return {
      intent: 'PHOTO_CAPTURE',
      confidence: 1.0,
      extractedText: input,
      suggestedAction: '识别物品并存入 Memory',
    };
  }

  const t = input.trim();
  const lower = t.toLowerCase();

  if (MEMORY_PATTERNS.some((p) => p.test(t))) {
    return { intent: 'MEMORY_CAPTURE', confidence: 0.92, extractedText: t, suggestedAction: '存入 Life Graph' };
  }
  if (REMINDER_PATTERNS.some((p) => p.test(t) || p.test(lower))) {
    return { intent: 'REMINDER', confidence: 0.88, extractedText: t, suggestedAction: '设置提醒' };
  }
  if (THINKING_PATTERNS.some((p) => p.test(t) || p.test(lower))) {
    return { intent: 'THINKING', confidence: 0.85, extractedText: t, suggestedAction: '进入分析模式' };
  }
  if (PLANNING_PATTERNS.some((p) => p.test(t) || p.test(lower))) {
    return { intent: 'PLANNING', confidence: 0.85, extractedText: t, suggestedAction: '规划安排' };
  }
  if (SHARE_PATTERNS.some((p) => p.test(t) || p.test(lower))) {
    return { intent: 'SHARE_PARSE', confidence: 0.9, extractedText: t, suggestedAction: '提取关键信息存入 Memory' };
  }

  return { intent: 'COMPANION_CHAT', confidence: 0.7, extractedText: t, suggestedAction: '和 Nesio 聊聊' };
}
