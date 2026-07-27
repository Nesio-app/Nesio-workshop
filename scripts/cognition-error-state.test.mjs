/**
 * 行为契约:认知面失败态分清 + 可点重试(设计批)。
 * living-model 7 层已退役;主认知面 = MirrorLetterTab 多面镜月度信。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sheet = fs.readFileSync(new URL('../components/portal/InsightsSheet.tsx', import.meta.url), 'utf8');
const mirror = fs.readFileSync(new URL('../components/portal/insights/MirrorLetterTab.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(sheet, /livingError|LivingModelTab|fetchLivingModel/, 'InsightsSheet 不再挂 living-model 失败态');

// ── 多面镜:多态错误类型 ──
assert.match(mirror, /'auth' \| 'no-key' \| 'quota' \| 'ai-error' \| 'network'/, 'MirrorLetter 错误多态(含 quota)');

// ── reason → 态 映射分清 ──
assert.match(mirror, /data\.reason === 'no_api_key'[\s\S]{0,80}setError\('no-key'\)/, 'no_api_key → no-key');
assert.match(mirror, /data\.reason === 'api_error'[\s\S]{0,120}setError\('ai-error'\)/, 'api_error → ai-error');
assert.doesNotMatch(mirror, /setError\('ai'\)/, '旧的合并态 ai 已清除');

// ── 文案分清 ──
assert.match(mirror, /error === 'no-key'[\s\S]{0,200}配|AI key/, 'no-key 文案讲接 AI/配 key');
assert.match(mirror, /这次没写出来/, 'ai-error 文案讲「这次没写出来」');

// ── 可点重试/重写 ──
assert.match(mirror, /点重试|tap retry/i, '失败文案引导重试');
assert.match(mirror, /void generate\(\)/, '错误态可触发生成/重写');

console.log('cognition-error-state: OK (mirror letter)');
