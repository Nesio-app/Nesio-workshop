/**
 * 行为契约:认知模型失败态三分 + 可点重试(设计批)。
 * 锁死:no-key(真没 key)/ ai-error(配了但这次没调通)/ network 三态分清,文案不再把
 * 「暂时失败」误报成「AI 未配置」;非 no-key 的失败给可点「重试」;失败态颜色用设计 token。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../components/portal/InsightsSheet.tsx', import.meta.url), 'utf8');

// ── 三态类型 ──
assert.ok(/'no-key' \| 'ai-error' \| 'network' \| null/.test(src), 'livingError 三态类型');
assert.ok((src.match(/'no-key' \| 'ai-error' \| 'network' \| null/g) || []).length >= 2, 'prop 与 state 都用三态');

// ── reason → 态 映射分清 ──
assert.ok(/data\.reason === 'no_api_key'[\s\S]{0,80}setLivingError\('no-key'\)/.test(src), 'no_api_key → no-key');
assert.ok(/data\.reason === 'api_error'[\s\S]{0,80}setLivingError\('ai-error'\)/.test(src), 'api_error → ai-error(不再并进 no-key)');
assert.ok(!/setLivingError\('ai'\)/.test(src), '旧的合并态 ai 已清除');

// ── 文案分清:no-key 讲「配 key」,ai-error 讲「重试」,不再统一「未配置」──
assert.ok(/error === 'no-key'[\s\S]{0,200}配一个 AI key|还没接上 AI/.test(src), 'no-key 文案讲接 AI/配 key');
assert.ok(/这次没生成出来/.test(src), 'ai-error 文案讲「这次没生成出来」而非「未配置」');

// ── 可点重试(非 no-key)──
assert.ok(/error !== 'no-key'[\s\S]{0,220}onRefresh\(\)/.test(src), '非 no-key 失败给可点重试(onRefresh)');
assert.ok(/'重试', 'Retry'/.test(src), '重试按钮文案');

// ── 颜色用 token(不硬编码)──
const bannerBlock = src.slice(src.indexOf('const errorBanner'), src.indexOf('const errorBanner') + 900);
assert.ok(/var\(--portal-accent/.test(bannerBlock), '重试按钮用 portal-accent token');
assert.ok(!/#[0-9a-fA-F]{3,6}/.test(bannerBlock), '失败态区块无硬编码色值');

console.log('cognition-error-state: OK');
