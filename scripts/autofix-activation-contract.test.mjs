/**
 * 契约:Claude Autofix 闭环的安全 + 诚实不变量。
 *
 * 它目前是"已就位但未端到端验证"的能力(未配 secret、从未真实触发)。这条契约不
 * 声称它能工作,而是守护:① 激活是 fail-closed(缺 secret 不静默假装工作,而是显式
 * ::warning:: 并跳过);② 实际修复步骤被激活门 gated;③ 只开 PR、永不直推 main;
 * ④ STATE.md 如实标注其未验证状态 —— 防止"漂亮图纸"被悄悄说成"已验证能力"。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const wf = read('.github/workflows/claude-autofix.yml');
const state = read('STATE.md');

// ① 激活门存在且 fail-closed:缺 secret → ready=false + 显式 warning(不静默)
assert.match(wf, /ready=true/, '必须有激活检查(检测 secret 是否配置)。');
assert.match(wf, /ready=false/, '未激活分支必须存在。');
assert.match(wf, /::warning::[^\n]*未激活/, '未激活时必须 emit ::warning::(醒目,不静默假装工作)。');

// ② 真正的修复步骤被激活门 gated(缺 secret 时不跑)
assert.match(
  wf,
  /uses: anthropics\/claude-code-action[\s\S]*?/,
  '必须使用 claude-code-action 执行修复。',
);
assert.match(
  wf,
  /Claude fix\n\s*if: steps\.key\.outputs\.ready == 'true'/,
  '修复步骤必须被 ready==true 门控(fail-closed:未激活不执行)。',
);

// ③ 红线:只开 PR,永不直推 main(在 prompt 里明确)
assert.match(wf, /只开 PR,永不直推 main/, '工作流必须要求只开 PR、不直推 main。');

// ④ STATE.md 如实标注未验证,不得把它说成已验证能力
assert.match(state, /修复闭环[^|]*未激活/, 'STATE.md 必须标注修复闭环未激活。');
assert.match(state, /未.*验证|未端到端验证|从未真实触发/, 'STATE.md 必须诚实标注其未经验证。');

console.log('autofix-activation-contract: OK');
