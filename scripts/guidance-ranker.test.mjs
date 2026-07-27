/**
 * 行为契约:guidance-ranker 学习接线已退役(2026-07-27)。
 * Today 排序改回规则分 + Preference/cooling;ranker 文件可只读探测,但不再订反馈总线学权重。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ranker = fs.readFileSync(new URL('../lib/platform/guidance-engine/guidance-ranker.ts', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../lib/platform/guidance-engine/guidance-pipeline.ts', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../components/portal/LearningStatusPanel.tsx', import.meta.url), 'utf8');

assert.match(ranker, /RANKER_LEARNING_ENABLED\s*=\s*false/, 'ranker 学习开关关闭');
assert.doesNotMatch(pipeline, /rankerScore|recordShownFeatures/, 'pipeline 不再调 ranker 排序/暂存');
assert.match(pipeline, /ruleScore|getWeight/, 'pipeline 用规则分 + Preference');
assert.doesNotMatch(panel, /getRankerStats|已从你的 \$\{stats\.n\}|Learned from your \$\{stats/, 'LearningStatusPanel 不再用 ranker stats 夸张计数');
assert.match(panel, /偏好|cooling|冷却/, '面板改讲偏好/冷却真相');

console.log('guidance-ranker: OK (learning retired)');
