/**
 * Extraction — the single home for "turn raw input into Life Graph nodes".
 *
 * Three API routes previously kept their own prompts with drifting schemas
 * and confidence conventions (analyze: full rules; ingest: slim variant;
 * gmail: email variant). They now compose from the same blocks, and share
 * one JSON-fence parser instead of three copies of the same regex.
 *
 * Server-side only (used by API routes).
 */

// ── Shared schema blocks ──────────────────────────────────────────────────────

import { NODE_TYPES, renderAttributeSchemaLines } from '@/lib/portal/node-schema';

// Generated from lib/portal/node-schema.ts — the typed single source of
// truth — so prompt and code can't drift apart.
export const NODE_SCHEMA_BLOCK = `Node schema (return ONLY these fields):
{
  "type": ${NODE_TYPES.map((t) => `"${t}"`).join(' | ')},
  "name": "concise name in the OUTPUT LANGUAGE (translate the input if needed)",
  "attributes": { "key": "value" },  // only standard keys — no 'context' or internal fields
  "relations": [{ "targetId": "name", "relation": "relation type" }],
  "tags": ["tag1"],  // retrieval-only keywords, NEVER shown to the user — be generous, synonyms welcome (e.g. cup/glass/drinkware all fine)
  "confidence": 0.0-1.0,
  "rawInput": "original excerpt"
}

Standard attribute keys by type:
${renderAttributeSchemaLines()}

Confidence rubric: 0.9+ = explicitly stated fact; 0.7 = clearly inferred;
0.5 = plausible guess. Never fabricate — omit a node rather than invent fields.`;

export const CLASSIFICATION_RULES_BLOCK = `CRITICAL CLASSIFICATION RULES:
1. "明天X生日" / "X的生日是Y" → create TWO nodes:
   a) commitment: name="X 生日", attributes={dueDate: <ISO date>, reminder: true}, tags=["生日","提醒"]
   b) person: name="X" (if not already known)
   NOT a preference or object.

2. "X说要/答应/需要/要记得Y" → commitment node, name=the task Y, attributes={owner: X}

3. "记住/X在Y" → object node, name=X, attributes={location: Y}

4. Any meeting/appointment with time → event node with start ISO date

5. Health mentions (药/运动/体检/睡眠/饮食) → health_state node

6. Pure opinions/likes/preferences → preference node

7. Receipts/shopping: create object nodes for each purchased ITEM only. Do NOT create a place node for the store.

8. 证件照片/扫描件(护照/签证/驾照/身份证/居留卡)→ object 节点，subtype=passport|visa|license|id，
   attributes.expiry=证件到期日(ISO)。绝不要当 person 或 place。name 用「XX 护照/签证」这类，别含证件号。

9. 保修卡 / 含保修期的收据 / 电子产品说明书 → 对应 object 节点，subtype=warranty，
   attributes.purchaseDate=购买日(ISO)、expiry=保修截止日(购买日+保修期，能算就填 ISO)。

10. 兜底捕捉(永不丢 · 开放世界 Layer ①):以上规则都无法明确归类的输入,**绝不要跳过或丢弃**——
    仍产出一个 note 节点:name=对原文的一句话中性概括，rawInput=原文原样保留，
    tags=**慷慨**的检索关键词(把能想到的同义词/主题词/相关物都放进去，retrieval-only、不展示给用户)，
    confidence ≤0.5(标明这是低置信捕捉)。
    原则:分不出类 = 先低置信存下来(不打扰用户,但进主表、等以后翻得出/被激活),
    而不是因「不确定」而丢——把失败从「分错类的 error」降级成「暂时没提醒的 miss」。`;

// ── Canonical prompt (voice / text / image / file — the analyze route) ────────

export const EXTRACTION_SYSTEM_PROMPT = `You are Nesio's Life Graph extractor. Given user input (voice/text/image/file), extract structured life memory nodes.

${NODE_SCHEMA_BLOCK}

${CLASSIFICATION_RULES_BLOCK}

Also return:
- "summary": one sentence in the OUTPUT LANGUAGE
- "intent": "REMINDER" | "COMMITMENT" | "MEMORY_CAPTURE" | "HEALTH_LOG" | "EVENT_LOG" | "PREFERENCE"

Respond ONLY with valid JSON: { "nodes": [...], "summary": "...", "intent": "..." }
Do NOT include any field called "context". Do NOT invent information not in the input.
For image: only extract visibly present things. Never use instruction text as node name.
`;

/**
 * 输出语言指令 —— 追加到 system prompt 末尾(末尾指令权重高,压过示例里的中文)。
 * 让 name/summary/tags 跟随 UI 语言,而不是永远中文(英文用户看到中文 = bug)。
 */
export function languageDirective(locale?: string): string {
  const en = (locale || 'zh').toLowerCase().startsWith('en');
  return en
    ? '\n\nOUTPUT LANGUAGE: English. Every "name", "summary", and every value in "tags" MUST be written in natural English, even when the user input, image, or file content is in another language. Do NOT output any Chinese.'
    : '\n\n输出语言:简体中文。所有 name / summary / tags 一律用简体中文。';
}

/** 带语言指令的抽取 system prompt(analyze / 拍照 / 说一句 / 分享 共用)。 */
export function buildExtractionSystemPrompt(locale?: string): string {
  return EXTRACTION_SYSTEM_PROMPT + languageDirective(locale);
}

// ── Source-hinted variant (the ingest route: shortcuts / reminders / exports) ─

export const SOURCE_HINTS: Record<string, string> = {
  reminder: '这是来自 Apple 提醒事项的待办。提取为 commitment 节点，标注截止日期。',
  keep: '这是来自 Keep 的运动健康数据。提取为 health_state 节点（运动类型、时长、卡路里）。',
  wechat_reading: '这是来自微信读书的阅读数据。提取为 preference 节点（书名、作者、进度、笔记）。',
  toggl: '这是来自 Toggl 的时间记录。提取为 event 节点（项目、任务、时长）。',
  shortcuts: '这是来自 iOS 快捷指令的数据。根据内容判断类型。',
  generic: '根据内容判断最合适的节点类型。',
};

export function buildSourceExtractionPrompt(source: string, content: string): string {
  const hint = SOURCE_HINTS[source] || SOURCE_HINTS.generic;
  return `你是 Nesio 的数据解析器。${hint}

将以下数据提取为结构化生活记忆节点。

${NODE_SCHEMA_BLOCK}

${CLASSIFICATION_RULES_BLOCK}

输出 JSON：{ "nodes": [...], "summary": "一句中文总结" }
只输出 JSON，不要其他文字。

数据（来源：${source}）：
${content.slice(0, 6000)}`;
}

// ── Email batch variant (the gmail route) ─────────────────────────────────────

export function buildEmailExtractionPrompt(emailTexts: string): string {
  return `你是 Nesio 的邮件解析器。从邮件中提取有意义的生活记忆节点。

只提取：预约/约会、承诺、重要日期、人名、地点。
忽略：广告、营销、订阅推广、自动通知、验证码。

分类铁律：
- 会议 / 约会 / 日程邀请（含时间的 meeting、invite、日程、预约）→ 一个 event 节点，name=会议主题，attributes.date=ISO 时间。
  绝不要把会议的组织者 / 发件人单独提成 person 节点 —— 那是「谁发的」，不是一条值得记的人物记忆。
- 只有当邮件本身是在「介绍 / 认识一个新的人」（简历、引荐、新同事介绍）时，才提 person 节点。
- 承诺 / 要做的事 → commitment；单纯的重要日期 → event。
- 机票 / 行程确认（航班、值机、e-ticket、boarding、行程单）→ 一个 event 节点，subtype=flight，
  name=「城市→城市 航班号」。attributes 必须抽：start=起飞时间（ISO，带时区偏移，别用收件时间）、
  flightNo=航班号、from/to=始发/到达机场或城市、pnr=订座编号（有才填）。抽不到起飞时间就别标 flight。

${NODE_SCHEMA_BLOCK}

每封邮件最多 2 个节点。attributes 里保留 date（ISO）、location、source（发件人）。
输出纯 JSON 数组（不是对象），不要任何其他文字。

邮件内容：
${emailTexts.slice(0, 5000)}`;
}

// ── Shared JSON parsing ───────────────────────────────────────────────────────

/**
 * Parse a model response that may be wrapped in \`\`\`json fences or contain
 * leading/trailing prose. Returns null when nothing parseable is found.
 */
export function parseJsonBlock<T>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim();
  const candidates = [fenced, raw.trim()];
  // Last resort: first {...} or [...] region in the text
  const braceMatch = raw.match(/[[{][\s\S]*[\]}]/)?.[0];
  if (braceMatch) candidates.push(braceMatch);
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c) as T; } catch { /* try next */ }
  }
  return null;
}
