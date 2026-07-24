/**
 * Alexa 语音召回的纯函数层(可单测,无副作用):
 * 云 signal 行 → 朗读片段 → LLM 提示词 / 无 LLM 确定性兜底 / 空结果诚实话术 / TTS 净化。
 *
 * 设计红线:每个异步动作都要有可见失败态 —— 这里 LLM 挂了也能用 fallbackRecallAnswer
 * 把命中的记忆原样念回,不静默变哑巴。英文(Alexa 无中文)。
 */

export interface RecallSnippet {
  title: string;
  source: string;
  when: string; // 已格式化的短日期,或 ''
  text: string; // 补充上下文(payload/evidence 摘要)
}

function shortDate(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  // 稳定、无本地化依赖:YYYY-MM-DD
  return new Date(t).toISOString().slice(0, 10);
}

function compactText(value: unknown, max = 180): string {
  let s = '';
  if (typeof value === 'string') s = value;
  else if (value && typeof value === 'object') {
    try { s = JSON.stringify(value); } catch { s = ''; }
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 云 signal 行 → 朗读片段(最多 take 条)。 */
export function rowsToSnippets(rows: Array<Record<string, unknown>>, take = 5): RecallSnippet[] {
  return rows.slice(0, take).map((row) => {
    const payloadText = compactText(row.payload);
    const evidenceRaw = row.evidence && typeof row.evidence === 'object'
      ? compactText((row.evidence as Record<string, unknown>).raw ?? row.evidence)
      : '';
    const text = [payloadText, evidenceRaw].filter(Boolean).join(' — ').slice(0, 220);
    return {
      title: compactText(row.title, 120) || '(untitled)',
      source: typeof row.source === 'string' ? row.source : 'memory',
      when: shortDate(row.captured_at) || shortDate(row.occurred_at),
      text,
    };
  });
}

/** 空结果:诚实说没找到,不编造。 */
export function emptyRecallAnswer(query: string): string {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 80);
  return q
    ? `I couldn't find anything saved about ${q}.`
    : `I couldn't find anything about that.`;
}

/** LLM 提示词:严格限定「只用给的记忆回答,没有就说没有」,一句话、口语、适合朗读。 */
export function buildRecallPrompt(query: string, snippets: RecallSnippet[]): string {
  const context = snippets
    .map((s, i) => `${i + 1}. [${s.source}${s.when ? `, ${s.when}` : ''}] ${s.title}${s.text ? ` — ${s.text}` : ''}`)
    .join('\n');
  return [
    `You are Nessa, a voice assistant reading back the user's own saved memories.`,
    `Answer the question using ONLY the memories below. Do not invent facts.`,
    `If the memories don't contain the answer, say you don't have it saved.`,
    `Reply in ONE short spoken English sentence — no markdown, no lists, no preamble.`,
    ``,
    `Question: ${query}`,
    ``,
    `Memories:`,
    context,
    ``,
    `Spoken answer:`,
  ].join('\n');
}

/**
 * 无 LLM(或 LLM 挂)时的确定性兜底:把最相关的一两条记忆原样念回。
 * 不假装理解,只做「我找到了这些」——仍比静默强。
 */
export function fallbackRecallAnswer(query: string, snippets: RecallSnippet[]): string {
  if (!snippets.length) return emptyRecallAnswer(query);
  const top = snippets[0];
  const detail = top.text ? `: ${top.text}` : '';
  const dateSuffix = top.when ? ` (from ${top.when})` : '';
  if (snippets.length === 1) {
    return sanitizeSpokenAnswer(`Here's what I have — ${top.title}${detail}${dateSuffix}.`);
  }
  return sanitizeSpokenAnswer(
    `I found ${snippets.length} related notes. The closest is ${top.title}${detail}${dateSuffix}.`,
  );
}

/** TTS 净化:去 markdown/换行/多空格,截断到语音友好的长度。 */
export function sanitizeSpokenAnswer(text: string, max = 500): string {
  const cleaned = (text || '')
    .replace(/[*_`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}
