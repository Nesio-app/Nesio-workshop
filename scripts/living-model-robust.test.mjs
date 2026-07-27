/**
 * 行为契约:living-model 已退役(2026-07-27 激进审计)。
 * 路由必须 410 + retired;不再花 token 生成 7 层模型。
 * 主认知面 = 多面镜月度信。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/living-model/route.ts', import.meta.url), 'utf8');
const lm = fs.readFileSync(new URL('../lib/platform/living-model.ts', import.meta.url), 'utf8');
const sheet = fs.readFileSync(new URL('../components/portal/InsightsSheet.tsx', import.meta.url), 'utf8');

assert.match(route, /status:\s*410/, 'living-model API 退役返回 410');
assert.match(route, /retired:\s*true/, '响应带 retired:true');
assert.doesNotMatch(route, /generateModel\(body\)/, '不再调用 generateModel 花 token');

assert.match(lm, /退役/, 'living-model 模块标注退役');
assert.match(lm, /return \{\}/, 'loadLivingModelFeedbacks 恒空(砍 nesio-lm-feedback)');

assert.match(sheet, /已退役|retired/i, 'Lab UI 展示退役说明');
assert.doesNotMatch(sheet, /LivingModelTab|fetchLivingModel|loadLivingModel/, 'InsightsSheet 不再挂 living-model 死代码');

console.log('living-model-robust: OK (retired)');
