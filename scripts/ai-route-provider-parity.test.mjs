/**
 * 行为契约:AI 路由 provider 齐备(修「认知模型/主动卡/引导语言」窄读 bug 的回归护栏)。
 *
 * 根因:这些路由只读 ANTHROPIC/CLAUDE key、只调 Claude,无 Gemini 回落。部署若只配 Gemini,
 * 它们独独失败(认知模型显示「AI 未配置」),而走共享 completeText 的功能(拍一拍等)正常。
 *
 * 锁死:① 三个已修路由走共享客户端(aiProviderAvailable + completeText,不再直连 anthropic);
 *       ② 全局护栏 —— 任何 portal AI 路由若读 Anthropic/Claude key,必须同文件也有 Gemini 路径
 *          (resolveAiKey/aiProviderAvailable/completeText/GEMINI),不许 anthropic-only 无回落。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── ① 活跃 AI 路由:走共享客户端(living-model 已 410 退役,单独断言)──
for (const rel of [
  'app/api/portal/proactive/route.ts',
  'app/api/portal/guidance-language/route.ts',
]) {
  const src = read(rel);
  assert.ok(/from ['"]@\/lib\/portal\/ai-complete['"]/.test(src), `${rel} 引共享 AI 客户端`);
  assert.ok(/aiProviderAvailable\(\)/.test(src), `${rel} 用 aiProviderAvailable 认全 provider`);
  assert.ok(/completeText\(/.test(src), `${rel} 生成走 completeText(Claude→Gemini 回落)`);
  assert.ok(!/api\.anthropic\.com/.test(src), `${rel} 不再直连 anthropic`);
  assert.ok(!/const anthropicKey = envValue\('ANTHROPIC_API_KEY'\)/.test(src), `${rel} 不再 anthropic-only 门`);
}

{
  const lm = read('app/api/portal/living-model/route.ts');
  assert.match(lm, /status:\s*410/, 'living-model 退役 410,不再 completeText');
  assert.match(lm, /guardAiRoute/, 'living-model 仍 guardAiRoute');
}

// ── ② 全局护栏:遍历所有 portal route,anthropic 读 key 必须配 gemini 路径 ──
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}
const ANTHROPIC_KEY_READ = /(ANTHROPIC_API_KEY|CLAUDE_API_KEY)/;
const GEMINI_PATH = /resolveAiKey|aiProviderAvailable|completeText|GEMINI|GOOGLE_.*API_KEY|resolveAiKeys/;
const offenders = [];
for (const file of walk(path.join(root, 'app/api/portal'))) {
  const src = fs.readFileSync(file, 'utf8');
  if (ANTHROPIC_KEY_READ.test(src) && !GEMINI_PATH.test(src)) {
    offenders.push(path.relative(root, file));
  }
}
assert.deepEqual(offenders, [], `anthropic-only 无回落的 AI 路由(应为空):\n${offenders.join('\n')}`);

console.log('ai-route-provider-parity: OK');
