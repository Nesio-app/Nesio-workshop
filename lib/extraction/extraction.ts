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
  "name": "concise Chinese name (translate if needed)",
  "attributes": { "key": "value" },  // only standard keys — no 'context' or internal fields
  "relations": [{ "targetId": "name", "relation": "relation type" }],
  "tags": ["tag1"],
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

7. Receipts/shopping: create object nodes for each purchased ITEM only. Do NOT create a place node for the store.`;

// ── Canonical prompt (voice / text / image / file — the analyze route) ────────

export const EXTRACTION_SYSTEM_PROMPT = `You are Nesio's Life Graph extractor. Given user input (voice/text/image/file), extract structured life memory nodes.

${NODE_SCHEMA_BLOCK}

${CLASSIFICATION_RULES_BLOCK}

Also return:
- "summary": one Chinese sentence
- "intent": "REMINDER" | "COMMITMENT" | "MEMORY_CAPTURE" | "HEALTH_LOG" | "EVENT_LOG" | "PREFERENCE"

Respond ONLY with valid JSON: { "nodes": [...], "summary": "...", "intent": "..." }
Do NOT include any field called "context". Do NOT invent information not in the input.
For image: only extract visibly present things. Never use instruction text as node name.
`;

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
