/**
 * 行为契约:第三方 LLM 子处理方披露(合规硬门槛,批次214)。
 * 隐私政策必须**明确列全**实际用到的 AI 子处理服务商(Anthropic/OpenAI/Google),
 * 且与 ai-complete.ts 里真正调用的三家一致(别只举例 Gemini、漏掉默认的 Claude)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const privacy = read('../app/privacy/page.tsx');
const ai = read('../lib/portal/ai-complete.ts');

// 三家实际在 ai-complete.ts 里被调用 → 政策必须都披露
assert.match(ai, /api\.anthropic\.com/, 'ai-complete 确实调 Anthropic');
assert.match(ai, /api\.openai\.com/, 'ai-complete 确实调 OpenAI');
assert.match(ai, /generativelanguage\.googleapis\.com/, 'ai-complete 确实调 Google Gemini');

for (const name of ['Anthropic', 'OpenAI', 'Google', 'Claude', 'Gemini', 'GPT']) {
  assert.ok(privacy.includes(name), `隐私政策披露 ${name}`);
}
assert.match(privacy, /子处理|sub-processor/i, '明确「子处理方」关系');
assert.match(privacy, /不用于训练|not used to train|not.*train their models/i, '声明默认不用于训练模型');
assert.match(privacy, /美国|US-based|United States/i, '披露数据出境(美国服务商)');
assert.match(privacy, /由你决定|your choice/i, '云端 AI 使用为用户选择(同意语义)');
// 别再退回「只举例 Gemini」的旧写法
assert.ok(!/例如 Google Gemini/.test(privacy), '不再只举例 Gemini(须列全三家)');

console.log('llm-subprocessor-disclosure: OK');
